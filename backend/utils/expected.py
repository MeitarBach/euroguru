# utils/expected.py
"""
What every player and coach is expected to score next round - My Teams' numbers.

Players are valued one of three ways (the `method`), the model below being "model":
- "form": the Recommendations tab's Exp Weighted FPT - the exponentially weighted mean
  of his last games, with the viewer's alpha and games window - moved by his next
  opponent's defense at his position at the viewer's matchup weight
  (defense_vs_position.matchup_factors). The default in My Teams.
- "average": his average FPT per game played this season.
- "model": the backtested valuation below.
Coaches are valued the same way whichever method the players use.

Ported from the social skill's team builds (.claude/skills/euroguru-social/generate.py,
squad_pool("expected") and coach_pool), which chose this valuation by backtest: every
2025-26 regular-season round from 4 on, plus 2026 so far, the exact best squad under
each formula (data before the round only), scored on what then happened.

A player's expected FPT = the chance he plays x his season average pulled toward what
his price implies:
- the chance he plays is the share of his club's last AVAIL_GAMES games he played,
  counted from his first game this season;
- the pull: as if he had played SHRINK_GAMES more games at the level a line through
  every regular's (price, average) gives his price.
At 105 CR the best squads on it averaged 134 a round, against 123 on season averages
and 126 on the Recommendations form. Penalising inconsistency, matchups and recent form
at full weight all cost points. Even so, its best squads came in about 18 under their
projection (the best-looking players are the luckiest), so read a team's total as an
upper-leaning estimate.

A coach scores on his club's result alone (utils/coaches.py), so he is valued on his
club's next game: each club's rating is points better than an average club on a
neutral floor, from this season's margins, and a game's expected margin is the gap in
ratings plus the home edge, give or take MARGIN_SD.

The margins come from the stored player rows (each club's points summed per round), not
from Euroleague's results feed, so nothing on a request path leaves the bucket. Checked
on 2026's first nine rounds: 87 of 90 games match the official margin exactly; the rest
miss a player row.
"""

import math
import statistics
import threading

import pandas as pd

# Coaches: calibrated on the 2024-25 and 2025-26 regular seasons, predicting each round
# from the ones before it - home clubs win by 3.3 on average, a predicted margin misses
# by about 12, and shrinking as if every club had 7 more average games predicts best.
HOME_EDGE = 3.3
MARGIN_SD = 12.0
RATING_SHRINK = 7
# Players: see the module docstring.
SHRINK_GAMES = 6
AVAIL_GAMES = 5
REGULAR_GAMES = 3  # games a player needs to count toward the price line


def coach_points(margin):
    """A coach's FPT for his club's result - the table in utils/coaches.py."""
    if margin > 0:
        return 25 if margin >= 21 else 20 if margin >= 11 else 10
    return -20 if margin <= -21 else -10 if margin <= -11 else -5


# The coach scoring table as margin bands: (low, high, points), a margin of 11 being
# anything from 10.5 to 20.5 once the normal curve is laid over whole points.
COACH_BANDS = [(-math.inf, -20.5, -20), (-20.5, -10.5, -10), (-10.5, 0, -5),
               (0, 10.5, 10), (10.5, 20.5, 20), (20.5, math.inf, 25)]


def coach_outlook(margin):
    """(expected coach points, chance of a win, {points: chance}) when the club's margin
    is expected to be `margin`, give or take MARGIN_SD: the chance of each band of the
    scoring table, and their points weighted by those chances."""
    def below(x):
        return 0.5 * (1 + math.erf((x - margin) / (MARGIN_SD * math.sqrt(2))))
    dist = {pts: below(hi) - below(lo) for lo, hi, pts in COACH_BANDS}
    return sum(pts * p for pts, p in dist.items()), 1 - below(0), dist


def club_ratings(played):
    """Points better than an average club on a neutral floor: each club's margins with the
    home edge taken out and the opponent's rating added back, shrunk toward 0."""
    clubs = {c for _, home, away, _ in played for c in (home, away)}
    rating = dict.fromkeys(clubs, 0.0)
    for _ in range(100):
        for club in clubs:
            total, n = 0.0, 0
            for _, home, away, margin in played:
                if club == home:
                    total, n = total + margin - HOME_EDGE + rating[away], n + 1
                elif club == away:
                    total, n = total - margin + HOME_EDGE + rating[home], n + 1
            rating[club] = total / (n + RATING_SHRINK)
        if rating:
            mean = sum(rating.values()) / len(rating)
            rating = {c: v - mean for c, v in rating.items()}
    return rating


def played_games(df):
    """[(round, home, away, home margin)] for every stored game, Euroleague codes."""
    rows = df.dropna(subset=["Round", "TeamCode"])
    points = rows.groupby(["Round", "TeamCode"])["Points"].sum()
    games = rows[rows["IsHome"] == True][["Round", "TeamCode", "Opponent"]].drop_duplicates()  # noqa: E712
    out = []
    for g in games.itertuples(index=False):
        home, away = (g.Round, g.TeamCode), (g.Round, g.Opponent)
        if home in points.index and away in points.index:
            out.append((int(g.Round), g.TeamCode, g.Opponent, float(points[home] - points[away])))
    return out


def next_round(df, schedule):
    """(round, [(home, away)]): the first round with a fixture not stored yet."""
    stored = set(zip(pd.to_numeric(df["Round"], errors="coerce"), df["TeamCode"]))
    sched = schedule.assign(Round=pd.to_numeric(schedule["Round"], errors="coerce")).dropna(subset=["Round"])
    pending = sched[[(r, h) not in stored for r, h in zip(sched["Round"], sched["HomeCode"])]]
    if pending.empty:
        return None, []
    rnd = int(pending["Round"].min())
    games = sched[sched["Round"] == rnd]
    return rnd, list(zip(games["HomeCode"], games["AwayCode"]))


def player_values(df):
    """PlayerKey -> {fpt, avail: [played, of], injury}, every priced player."""
    from .data_processing import calculate_player_averages, filter_by_cr_and_position

    pool = calculate_player_averages(filter_by_cr_and_position(df, 0, 100, "All"), 100)
    if pool.empty:
        return {}
    avg = pd.to_numeric(pool["Average_Score"], errors="coerce").fillna(0.0)
    games = pd.to_numeric(pool["GamesPlayed"], errors="coerce").fillna(0)
    cr = pd.to_numeric(pool["CR"], errors="coerce")

    # What a price buys this season: a line through every regular's (price, average).
    regular = (games >= REGULAR_GAMES) & cr.notna()
    if regular.sum() >= 2:
        slope, icept = statistics.linear_regression(cr[regular].tolist(), avg[regular].tolist())
    else:
        slope, icept = 0.0, float(avg.mean()) if len(avg) else 0.0

    rows = df.dropna(subset=["GameCode", "Round"])
    mine = rows.groupby("PlayerKey")["Round"].agg(lambda r: set(int(x) for x in r))
    club_rounds = rows.groupby("TeamCode")["Round"].agg(lambda r: set(int(x) for x in r))
    injury = df.dropna(subset=["PlayerKey"]).groupby("PlayerKey")["InjuryStatus"].first() \
        if "InjuryStatus" in df.columns else pd.Series(dtype=object)

    out = {}
    for i, p in enumerate(pool.itertuples(index=False)):
        key = getattr(p, "PlayerKey", None)
        if key is None or pd.isna(key):
            continue
        played = mine.get(key, set())
        team = getattr(p, "TeamCode", None)
        since = sorted(r for r in club_rounds.get(team, set()) if played and r >= min(played))[-AVAIL_GAMES:]
        hit = sum(r in played for r in since)
        avail = hit / len(since) if since else 0.0
        n = len(played)
        price = cr.iloc[i]
        implied = icept + slope * price if pd.notna(price) else avg.iloc[i]
        est = (n * avg.iloc[i] + SHRINK_GAMES * implied) / (n + SHRINK_GAMES)
        status = injury.get(key)
        out[key] = {
            "fpt": round(float(avail * est), 2),
            "avail": [hit, len(since)],
            "injury": str(status) if status is not None and pd.notna(status) and str(status).strip() else None,
        }
    return out


def coach_values(coaches, played, fixtures):
    """
    "coach:<id>" -> {likely, chance, dist, proj, win, opp, home, margin}.

    A coach can only score one of six numbers, so his outlook is the chance of each
    (`dist`, points as strings -> chance) and the one he most likely scores (`likely`,
    with its `chance`) - what My Teams counts, since a probability-weighted 6.3 is a
    score no coach can make. `proj` is that weighted mean, kept for comparison. A club
    with no game scores 0, for certain.
    """
    rating = club_ratings(played)
    nxt = {}
    for home, away in fixtures:
        edge = rating.get(home, 0.0) - rating.get(away, 0.0) + HOME_EDGE
        nxt[home], nxt[away] = (away, True, edge), (home, False, -edge)
    out = {}
    for c in coaches:
        opp, home, margin = nxt.get(c.get("TeamCode"), (None, None, 0.0))
        if opp:
            proj, win, dist = coach_outlook(margin)
            likely = max(dist, key=dist.get)
        else:
            proj, win, dist, likely = 0.0, 0.0, {0: 1.0}, 0
        out[f"coach:{c['CoachID']}"] = {
            "likely": likely, "chance": round(dist[likely], 3),
            "dist": {str(pts): round(p, 3) for pts, p in dist.items()},
            "proj": round(proj, 2), "win": round(win, 3), "opp": opp,
            "home": home, "margin": round(margin, 1),
        }
    return out


def average_values(df, model):
    """PlayerKey -> {fpt, avail, injury}: his average per game played this season. The
    chance he plays and his injury come from `model` (player_values), for the badges."""
    from .data_processing import calculate_player_averages, filter_by_cr_and_position

    pool = calculate_player_averages(filter_by_cr_and_position(df, 0, 100, "All"), 100)
    out = {}
    for p in pool.itertuples(index=False):
        key = getattr(p, "PlayerKey", None)
        if key is None or pd.isna(key):
            continue
        avg = pd.to_numeric(getattr(p, "Average_Score", None), errors="coerce")
        base = model.get(key, {})
        out[key] = {"fpt": round(float(avg), 2) if pd.notna(avg) else None,
                    "avail": base.get("avail"), "injury": base.get("injury")}
    return out


def form_values(df, model, matchups, alpha, last_x_games, weight_matchup):
    """
    PlayerKey -> {fpt, base, opp, factor, avail, injury}: the Recommendations tab's Exp
    Weighted FPT over his last `last_x_games` games at `alpha` (`base`), times his next
    opponent's factor at `weight_matchup` (`fpt`). `matchups` is matchup_factors' map;
    a player whose club has no fixture there keeps his form as it is. None for a priced
    player who has not played yet.
    """
    from .data_processing import filter_by_cr_and_position
    from .defense_vs_position import matchup_multiplier
    from .recommendations import exp_weighted_form, recent_rows

    rows = filter_by_cr_and_position(df, 0, 100, "All").dropna(subset=["PlayerKey"])
    out = {}
    for key, games in rows.groupby("PlayerKey"):
        recent = recent_rows(games, last_x_games)
        base = exp_weighted_form(recent, alpha)
        team = recent["TeamCode"].iloc[0] if "TeamCode" in recent else None
        position = recent["position"].iloc[0] if "position" in recent else None
        opp, factors = matchups.get(team, (None, {}))
        factor = factors.get(position) if opp else None
        fpt = base * matchup_multiplier(factor, weight_matchup) if base is not None else None
        info = model.get(key, {})
        out[key] = {
            "fpt": round(fpt, 2) if fpt is not None else None,
            "base": round(base, 2) if base is not None else None,
            "opp": opp, "factor": round(factor, 3) if factor is not None else None,
            "avail": info.get("avail"), "injury": info.get("injury"),
        }
    return out


METHODS = ("form", "average", "model")

# The bucket's state and everything built from it alone, one season at a time: the
# merged frame, the round ahead, the coaches and the model's values. Each method's
# values are cached beside it, per setting - "form" has one entry per slider position,
# so only the last few are kept.
_base = {}
_values = {}
_VALUES_MAX = 32
_cache_lock = threading.Lock()


def _base_for(season, get_df, index):
    """The shared part of every payload, rebuilt when anything in the bucket changes -
    the stats, prices, injuries, schedule, coaches and matchup rollup it reads all live
    there. `get_df` is only called on a miss (the merged frame is a fresh copy)."""
    from .coaches import coaches_payload
    from .s3_utils import load_from_s3

    sched_key = f"schedule_{season}.csv"
    if sched_key not in index:
        raise FileNotFoundError(f"{sched_key} is not in the bucket yet")
    stamp = (season, tuple(sorted((k, str(v)) for k, v in index.items())))
    with _cache_lock:
        if _base.get("stamp") == stamp:
            return _base
    df = get_df()
    try:
        coaches = coaches_payload(season, index)
    except FileNotFoundError:
        coaches = []
    rnd, fixtures = next_round(df, load_from_s3(sched_key))
    base = {
        "stamp": stamp,
        "season": season,
        "df": df,
        "index": index,
        "round": rnd,
        "coaches": coach_values(coaches, played_games(df), fixtures),
        "model": player_values(df),
    }
    with _cache_lock:
        _base.clear()
        _base.update(base)
        _values.clear()
        return _base


def cached_expected_payload(season, get_df, index, method="model", alpha=0.85, last_x_games=5,
                            weight_matchup=None):
    """{season, round, method, players, coaches} for one method and its settings (alpha,
    last_x_games and weight_matchup only matter to "form")."""
    from .defense_vs_position import DEFAULT_MATCHUP_WEIGHT, matchup_factors

    if method not in METHODS:
        raise ValueError(f"Unknown method {method!r}")
    if weight_matchup is None:
        weight_matchup = DEFAULT_MATCHUP_WEIGHT
    base = _base_for(season, get_df, index)
    key = (method,) if method != "form" else (method, round(alpha, 3), int(last_x_games), round(weight_matchup, 3))
    with _cache_lock:
        players = _values.get((base["stamp"], key))
    if players is None:
        if method == "model":
            players = base["model"]
        elif method == "average":
            players = average_values(base["df"], base["model"])
        else:
            with _cache_lock:
                factors = _values.get((base["stamp"], "matchups"))
            if factors is None:
                _, factors = matchup_factors(season, base["df"], base["round"], base["index"])
            players = form_values(base["df"], base["model"], factors, alpha, last_x_games, weight_matchup)
            with _cache_lock:
                _values[(base["stamp"], "matchups")] = factors
        with _cache_lock:
            if len(_values) >= _VALUES_MAX:
                _values.pop(next(iter(_values)))
            _values[(base["stamp"], key)] = players
    return {
        "season": season,
        "round": base["round"],
        "method": method,
        "players": players,
        "coaches": base["coaches"],
    }
