# utils/defense_vs_position.py
"""
Defense vs position: how many fantasy points each team gives up to guards, forwards
and centers, and what that means for the round ahead.

Two artefacts, the same split as cr_history:

  * ``defense_vs_position_{season}.csv`` is a **derived rollup**, rebuilt from scratch
    by rebuild_defense_vs_position() on every data run - one row per (round, defending
    team, attacking team, position). Losing or corrupting it costs nothing.
  * dvp_payload() turns the rollup, the schedule and the merged player frame into the
    Matchups tab's response for one round.

Every number in a round's payload is built from the rounds *before* it. That makes
each round an honest backtest once its games are played: the projections for round N
never saw round N, so comparing them with what happened says whether the signal is
worth anything. The "did it work?" cards are exactly that comparison.

This replaces a fetcher that copied Dunkest's own table. It was hardcoded to a past
season and nothing ever read its output.
"""

import threading

import pandas as pd

from .s3_utils import list_bucket, load_from_s3, save_to_s3

PREFIX = "defense_vs_position"
POSITIONS = ["G", "F", "C"]

ROLLUP_COLUMNS = [
    "Season", "Round", "DefTeam", "DefName", "AttTeam", "Position",
    "FPT", "Minutes", "Players", "Points",
]

# Who counts toward a player projection. A bench player's average swings on a handful
# of minutes, which the opponent multiplier would only amplify.
MIN_GAMES = 2
MIN_MINUTES = 15

# How far the opponent has to move a group's expectation before the validation counts
# it as a "strong" call. ±15% is roughly the gap between a top-5 and a median defense.
STRONG_SIGNAL = 0.15

# Club names arrive in capitals ("FC BARCELONA"); these stay that way when the rest is
# title-cased.
_UPPER_WORDS = {"FC", "BC", "LDLC", "ASVEL", "AS", "AEK", "CSKA", "UNICS"}


def rollup_key(season):
    return f"{PREFIX}_{season}.csv"


def team_display_name(name):
    def word(w):  # "VITORIA-GASTEIZ" -> "Vitoria-Gasteiz"
        return w if w in _UPPER_WORDS else "-".join(part.capitalize() for part in w.split("-"))
    return " ".join(word(w) for w in str(name or "").split())


# --------------------------------------------------------------------------- rollup


def build_rollup(df, season):
    """
    The merged player frame -> FPT allowed per (round, defending team, position).

    A row is what AttTeam's players at Position scored against DefTeam in Round. A
    player with no position (unpriced) or no opponent (no fixture match) cannot be
    placed, so is left out - the merge already reports how many of those there are.
    """
    if df is None or df.empty:
        return pd.DataFrame(columns=ROLLUP_COLUMNS)

    played = df[df["GameCode"].notna()].copy()
    played = played[
        played["Opponent"].notna()
        & played["Round"].notna()
        & played["position"].isin(POSITIONS)
    ]
    if played.empty:
        return pd.DataFrame(columns=ROLLUP_COLUMNS)

    for col in ("Score", "MinutesPlayed", "Points"):
        played[col] = pd.to_numeric(played[col], errors="coerce").fillna(0)

    rollup = (
        played.groupby(["Round", "Opponent", "OpponentName", "TeamCode", "position"])
        .agg(FPT=("Score", "sum"), Minutes=("MinutesPlayed", "sum"),
             Players=("PlayerName", "nunique"), Points=("Points", "sum"))
        .reset_index()
        .rename(columns={"Opponent": "DefTeam", "OpponentName": "DefName",
                         "TeamCode": "AttTeam", "position": "Position"})
    )
    rollup["Season"] = str(season)
    rollup["Round"] = rollup["Round"].astype(int)
    rollup["FPT"] = rollup["FPT"].round(1)
    rollup["Minutes"] = rollup["Minutes"].round(2)
    return rollup[ROLLUP_COLUMNS].sort_values(
        ["Round", "DefTeam", "Position"], ignore_index=True
    )


def rebuild_defense_vs_position(season, candidates):
    """
    Regenerate defense_vs_position_{season}.csv from the season's merged frame.

    Run after stats, prices and schedule are all fetched: position comes from the CR
    merge and the opponent from the schedule, so an earlier run would place nobody.
    Raises rather than writing an empty file, which would blank the whole tab.
    """
    from .data_processing import load_and_merge_data

    df = load_and_merge_data(candidates, include_injuries=False, season=season)
    rollup = build_rollup(df, season)
    if rollup.empty:
        raise RuntimeError(f"No placeable games for {season}; not writing an empty rollup.")

    key = rollup_key(season)
    save_to_s3(key, rollup)
    print(f"Defense vs position: {key} <- {len(rollup)} rows, "
          f"rounds {rollup['Round'].min()}-{rollup['Round'].max()}, "
          f"{rollup['DefTeam'].nunique()} teams")
    return rollup


# --------------------------------------------------------------------------- payload


def _rounds_state(rollup, schedule):
    """
    (current round, rounds that can be shown).

    A round is shown as the one in progress while it still has games without data, and
    the next one takes over once every fixture of the latest round is stored. Data
    presence decides, not the schedule's Played flag: the page can only use games the
    data run has fetched, and the flag is only as fresh as the last schedule fetch.
    Round 1 has nothing before it to build from, so the earliest round on offer is 2.
    """
    sched_rounds = sorted(int(r) for r in pd.to_numeric(schedule["Round"], errors="coerce").dropna().unique())
    if rollup.empty:
        return (sched_rounds[0] if sched_rounds else 1), []

    latest = int(rollup["Round"].max())
    fixtures = schedule[pd.to_numeric(schedule["Round"], errors="coerce") == latest]
    stored = set(rollup.loc[rollup["Round"] == latest, "DefTeam"])
    complete = all(h in stored for h in fixtures["HomeCode"])
    current = latest + 1 if complete and latest + 1 in sched_rounds else latest
    return current, list(range(2, current + 1))


def _team_tables(base):
    """Per-team FPT allowed (per game, per 36) and own output per position, from base rounds."""
    games = base.groupby("DefTeam")["Round"].nunique()
    att_games = base.groupby("AttTeam")["Round"].nunique()

    allowed = base.groupby(["DefTeam", "Position"])[["FPT", "Minutes"]].sum()
    scored = base.groupby(["AttTeam", "Position"])["FPT"].sum()

    league = {}
    total_games = int(games.sum())
    for p in POSITIONS:
        rows = base[base["Position"] == p]
        fpt, mins = rows["FPT"].sum(), rows["Minutes"].sum()
        league[p] = {
            "pg": float(round(fpt / total_games, 1)) if total_games else 0.0,
            "p36": float(round(fpt / mins * 36, 1)) if mins else 0.0,
        }
    return games, att_games, allowed, scored, league


def dvp_payload(season, round_number, merged_df, rollup, schedule):
    """
    The Matchups tab for one round. See the module docstring for the backtest rule.

    Returns None when the round cannot be shown (before round 2, or past the current
    one), so the endpoint can answer 400 with the rounds that can.
    """
    current, available = _rounds_state(rollup, schedule)
    R = current if round_number is None else int(round_number)
    if R not in available:
        return None

    base = rollup[rollup["Round"] < R]
    this_round = rollup[rollup["Round"] == R]
    games, att_games, allowed, scored, league = _team_tables(base)

    names = (rollup.drop_duplicates("DefTeam").set_index("DefTeam")["DefName"]
             .map(team_display_name).to_dict())

    played = merged_df[merged_df["GameCode"].notna()].copy()
    played["Round"] = pd.to_numeric(played["Round"], errors="coerce")
    played["Score"] = pd.to_numeric(played["Score"], errors="coerce")
    before = played[played["Round"] < R]

    # --- teams
    teams, factor = [], {}
    for code in sorted(games.index):
        n = int(games[code])
        team = {"code": code, "name": names.get(code, code), "games": n, "pos": {}, "off": {}}
        for p in POSITIONS:
            fpt, mins = (allowed.loc[(code, p)] if (code, p) in allowed.index else (0.0, 0.0))
            p36 = float(round(fpt / mins * 36, 1)) if mins else 0.0
            series = base[(base["DefTeam"] == code) & (base["Position"] == p)]
            team["pos"][p] = {
                "pg": float(round(fpt / n, 1)) if n else 0.0,
                "p36": p36,
                "rounds": [{"round": int(r.Round), "vs": r.AttTeam, "fpt": round(float(r.FPT), 1)}
                           for r in series.sort_values("Round").itertuples()],
            }
            factor[(code, p)] = p36 / league[p]["p36"] if league[p]["p36"] else 1.0
            ag = int(att_games.get(code, 0))
            team["off"][p] = round(float(scored.get((code, p), 0.0)) / ag, 1) if ag else 0
        top = before[before["Opponent"] == code].nlargest(3, "Score")
        team["top"] = [{"player": t.PlayerName, "team": t.TeamCode, "pos": t.position,
                        "fpt": round(float(t.Score), 1), "round": int(t.Round)}
                       for t in top.itertuples()]
        teams.append(team)

    for m in ("pg", "p36"):  # 1 = softest, the best matchup
        for p in POSITIONS:
            ranked = sorted(teams, key=lambda t: -t["pos"][p][m])
            for i, t in enumerate(ranked, 1):
                t["pos"][p][f"rank_{m}"] = i

    # --- fixtures of round R
    sched = schedule[pd.to_numeric(schedule["Round"], errors="coerce") == R]
    team_points = played[played["Round"] == R].groupby("TeamCode")["Points"].sum()
    stored = set(this_round["DefTeam"])
    fixtures, actual_group = [], {}
    for g in sched.sort_values(["Date", "GameCode"]).itertuples():
        fx = {"game_code": int(g.GameCode), "date": str(g.Date) if pd.notna(g.Date) else None,
              "time": getattr(g, "StartTime", None) if pd.notna(getattr(g, "StartTime", None)) else None,
              "home": g.HomeCode, "away": g.AwayCode, "played": g.HomeCode in stored}
        if fx["played"]:
            fx["score"] = {t: int(team_points.get(t, 0)) for t in (g.HomeCode, g.AwayCode)}
            fx["actual"] = {}
            for me in (g.HomeCode, g.AwayCode):
                rows = this_round[this_round["AttTeam"] == me]
                fx["actual"][me] = {p: round(float(rows.loc[rows["Position"] == p, "FPT"].sum()), 1)
                                    for p in POSITIONS}
                actual_group[me] = fx["actual"][me]
        fixtures.append(fx)

    opponent = {}
    for fx in fixtures:
        opponent[fx["home"]], opponent[fx["away"]] = fx["away"], fx["home"]
    team_index = {t["code"]: t for t in teams}

    # --- player matchup boost
    from .data_processing import calculate_player_averages

    avgs = calculate_player_averages(before, 100) if not before.empty else pd.DataFrame()
    actual_player = played[played["Round"] == R].groupby("PlayerName")["Score"].sum()
    played_teams = {t for fx in fixtures if fx["played"] for t in (fx["home"], fx["away"])}
    picks = []
    for a in avgs.itertuples():
        team, p = getattr(a, "TeamCode", None), a.position
        if team not in opponent or p not in POSITIONS or opponent[team] not in team_index:
            continue
        if (a.GamesPlayed or 0) < MIN_GAMES or (a.Average_Minutes or 0) < MIN_MINUTES:
            continue
        f = factor[(opponent[team], p)]
        avg = float(a.Average_Score or 0)
        act = None
        if team in played_teams:  # did not play counts as zero, as it does in the game
            act = round(float(actual_player.get(a.PlayerName, 0.0)), 1)
        injury = getattr(a, "InjuryStatus", "")
        picks.append({
            "player": a.PlayerName, "team": team, "pos": p,
            "cr": None if pd.isna(a.CR) else float(a.CR), "fpt": round(avg, 1),
            "vs": opponent[team], "factor": round(float(f), 3), "projected": round(float(avg * f), 1),
            "actual": act, "injury": injury if isinstance(injury, str) else "",
        })
    picks.sort(key=lambda x: -x["projected"])

    return {
        "season": str(season),
        "round": R,
        "current_round": current,
        "rounds_available": available,
        "based_on": [int(base["Round"].min()), int(base["Round"].max())] if not base.empty else None,
        "games": int(games.sum() // 2),
        "player_lines": int(len(before)),
        "league": league,
        "teams": teams,
        "fixtures": fixtures,
        "picks": picks,
        "validation": _validation(fixtures, team_index, factor, picks, actual_group),
    }


def _validation(fixtures, team_index, factor, picks, actual_group):
    """
    How the matchup adjustment did on round R's played games, against doing nothing.

    "Doing nothing" is the team's own average (for a position group) or the player's
    season average; the adjustment multiplies it by the opponent's factor. Smaller
    error and better-than-chance direction calls are what would make this worth
    trusting. None until a game of the round is stored.
    """
    done = [fx for fx in fixtures if fx["played"]]
    if not done:
        return None

    cells = []
    for fx in done:
        for me, opp in ((fx["home"], fx["away"]), (fx["away"], fx["home"])):
            if me not in team_index or opp not in team_index:
                continue
            for p in POSITIONS:
                base = team_index[me]["off"][p]
                cells.append((base, base * factor[(opp, p)], actual_group[me][p]))
    players = [(x["fpt"], x["projected"], x["actual"]) for x in picks if x["actual"] is not None]

    def mae(rows, i):
        return round(float(sum(abs(r[i] - r[2]) for r in rows)) / len(rows), 2) if rows else None

    def hits(rows):
        return sum(1 for b, a, act in rows if (a - b) * (act - b) > 0)

    strong = [c for c in cells if c[0] and abs(c[1] / c[0] - 1) >= STRONG_SIGNAL]
    return {
        "games_done": len(done),
        "games_total": len(fixtures),
        "players": len(players),
        "player_mae_base": mae(players, 0),
        "player_mae_adj": mae(players, 1),
        "groups": len(cells),
        "group_mae_base": mae(cells, 0),
        "group_mae_adj": mae(cells, 1),
        "direction_hits": hits(cells),
        "strong_n": len(strong),
        "strong_hits": hits(strong),
    }


# --------------------------------------------------------------------------- serving


_payload_cache = {}
_payload_lock = threading.Lock()
_PAYLOAD_MAX_ENTRIES = 16


def defense_vs_position_payload(season, round_number, merged_df, index=None):
    """
    The API response, cached against the rollup and schedule it was built from.

    The rollup is rebuilt by the same data run that changes the stats, so its
    LastModified covers them too. Raises FileNotFoundError when the rollup has not
    been built for the season yet.
    """
    index = index if index is not None else list_bucket()
    key, sched_key = rollup_key(season), f"schedule_{season}.csv"
    if key not in index or sched_key not in index:
        raise FileNotFoundError(f"{key} or {sched_key} is not in the bucket yet")

    cache_key = (season, round_number, index[key], index[sched_key])
    with _payload_lock:
        if cache_key in _payload_cache:
            return _payload_cache[cache_key]

    rollup = load_from_s3(key)
    schedule = load_from_s3(sched_key)
    payload = dvp_payload(season, round_number, merged_df, rollup, schedule)

    with _payload_lock:
        if cache_key not in _payload_cache and len(_payload_cache) >= _PAYLOAD_MAX_ENTRIES:
            _payload_cache.pop(next(iter(_payload_cache)))
        _payload_cache[cache_key] = payload
    return payload
