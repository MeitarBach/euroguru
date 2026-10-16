"""
Check that a fetch landed in the dev bucket correctly, before it is promoted.

    python verify.py snapshot      # before the fetch: remember what dev holds
    python verify.py check         # after it: what is new, and is it right
    python verify.py check --local-api   # also ask the local API (localhost:8000)

Run from backend/ with its venv (it imports the backend's own S3 and data code).
`check` exits non-zero on any FAIL and prints TOP_SCORER=<name> for the browser step.
"""

import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request

sys.path.insert(0, os.getcwd())

from run_dev_fetch import CURRENT_SEASON  # noqa: E402
from utils.data_fetchers import latest_round  # noqa: E402
from utils.s3_utils import load_from_s3  # noqa: E402
from utils.defense_vs_position import rollup_key  # noqa: E402

SEASON = CURRENT_SEASON
STATS = f"player_stats_{SEASON}.csv"
FANTASY = f"player_stats_fantasy_{SEASON}.csv"
SCHEDULE = f"schedule_{SEASON}.csv"
DVP = rollup_key(SEASON)
STATE = os.path.join(tempfile.gettempdir(), "euroguru-data-snapshot.json")
LOCAL_API = "http://localhost:8000/api"

# The boxscore API refuses requests without a browser-like User-Agent (403).
UA = {"User-Agent": "Mozilla/5.0"}


def _quiet_load(name):
    """load_from_s3 prints a line per file; keep the report readable."""
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        return load_from_s3(name)


def _get_json(url, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={
        **UA, **(headers or {}), **({"Content-Type": "application/json"} if body else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _fantasy_keys(df):
    return sorted({f"{int(r)}:{p}" for r, p in zip(df["GameCode"], df["PlayerID"])})


def snapshot():
    stats, fantasy = _quiet_load(STATS), _quiet_load(FANTASY)
    state = {
        "games": sorted(int(g) for g in stats["GameCode"].unique()) if not stats.empty else [],
        "stats_rows": len(stats),
        "fantasy_rows": len(fantasy),
        "fantasy_round": latest_round(fantasy),
        "fantasy_keys": _fantasy_keys(fantasy) if not fantasy.empty else [],
    }
    with open(STATE, "w") as f:
        json.dump(state, f)
    print(f"Snapshot of dev ({SEASON}): games up to {max(state['games'], default=0)}, "
          f"{state['stats_rows']} stat rows, fantasy round {state['fantasy_round']}, "
          f"{state['fantasy_rows']} fantasy rows -> {STATE}")


class Report:
    def __init__(self):
        self.failed = False

    def line(self, status, name, detail):
        if status == "FAIL":
            self.failed = True
        print(f"  {status:<4}  {name:<18} {detail}")


def check_boxscores(rep, stats, new_games):
    """Every stored player line of every new game equals the official boxscore."""
    for gc in new_games:
        try:
            box = _get_json(f"https://live.euroleague.net/api/Boxscore?gamecode={gc}&seasoncode=E{SEASON}")
        except Exception as e:
            rep.line("FAIL", f"boxscore {gc}", f"could not fetch the official boxscore: {e}")
            continue
        official = {p["Player_ID"].strip(): p for t in box.get("Stats", []) for p in t["PlayersStats"]}
        stored = stats[stats["GameCode"] == gc]
        problems = []
        for _, row in stored.iterrows():
            p = official.get(str(row["PlayerID"]).strip())
            if p is None:
                problems.append(f"{row['PlayerName']} not in boxscore")
            elif p["Valuation"] != row["PIR"] or p["Points"] != row["Points"]:
                problems.append(f"{row['PlayerName']} PIR {row['PIR']} vs {p['Valuation']}")
        missing = set(official) - {str(x).strip() for x in stored["PlayerID"]}
        problems += [f"{official[m]['Player']} missing" for m in missing]
        teams = " vs ".join(stored["Team"].unique())
        if problems:
            rep.line("FAIL", f"boxscore {gc}", f"{teams}: " + "; ".join(problems[:5]))
        else:
            rep.line("PASS", f"boxscore {gc}", f"{teams}: {len(stored)} players match")


def check_schedule(rep, stats, schedule, new_games):
    played = set(int(g) for g in schedule.loc[schedule["Played"] == True, "GameCode"])  # noqa: E712
    stored = set(int(g) for g in stats["GameCode"].unique())
    top = max(stored, default=0)
    not_marked = [g for g in new_games if g not in played]
    gaps = sorted(g for g in played if g <= top and g not in stored)
    beyond = sorted(g for g in played if g > top)
    if not_marked:
        rep.line("FAIL", "schedule", f"stored but not played per schedule: {not_marked}")
    if gaps:
        rep.line("FAIL", "schedule", f"played but missing from the stats file: {gaps}")
    if beyond:
        rep.line("WARN", "schedule", f"played but not fetched yet: {beyond} (re-run the fetch later)")
    if not (not_marked or gaps or beyond):
        rep.line("PASS", "schedule", f"all {len(played)} played games stored")


def check_fantasy(rep, fantasy, schedule, before):
    """New fantasy rows exist, and FPT = PIR (+10% of |PIR| for winners) team by team."""
    old = set(before["fantasy_keys"])
    keys = _fantasy_keys(fantasy)
    new = fantasy[[k not in old for k in (f"{int(r)}:{p}" for r, p in zip(fantasy["GameCode"], fantasy["PlayerID"]))]]
    rounds = sorted(int(r) for r in new["GameCode"].unique())
    if new.empty:
        rep.line("PASS", "fantasy", f"no new fantasy rows (latest round {latest_round(fantasy)})")
        return new
    rep.line("PASS", "fantasy", f"{len(new)} new rows, round(s) {rounds}, {len(keys)} total")

    for rnd in rounds:
        rows = fantasy[fantasy["GameCode"] == rnd]
        winners, bad = [], []
        for team, g in rows.groupby("Team"):
            g = g[g["PIR"] != 0]  # 0 PIR scores 0 either way
            loss = ((g["FPT"] - g["PIR"]).abs() <= 0.05).all()
            win = ((g["FPT"] - (g["PIR"] + 0.1 * g["PIR"].abs())).abs() <= 0.05).all()
            if win and not loss:
                winners.append(team)
            elif not loss:
                bad.append(team)
        played = int(((schedule["Round"] == rnd) & (schedule["Played"] == True)).sum())  # noqa: E712
        if bad:
            rep.line("FAIL", f"FPT round {rnd}", f"FPT is neither PIR nor PIR+10% for {bad}")
        elif len(winners) != played:
            rep.line("WARN", f"FPT round {rnd}",
                     f"{len(winners)} teams have the win bonus, {played} games played "
                     "(fine if a game ended live without a final yet)")
        else:
            rep.line("PASS", f"FPT round {rnd}", f"win bonus on {len(winners)} winners of {played} games")
    return new


def check_dvp(rep, fantasy, schedule):
    """The Matchups rollup was rebuilt from this run: every stored round, both sides of every game."""
    dvp = _quiet_load(DVP)
    if dvp.empty:
        rep.line("FAIL", "dvp", f"{DVP} missing - the 'Rebuilding Defense vs Position' step failed")
        return
    stored = sorted(int(r) for r in fantasy["GameCode"].dropna().unique())
    rounds = sorted(int(r) for r in dvp["Round"].unique())
    if rounds != stored:
        rep.line("FAIL", "dvp", f"rollup rounds {rounds} != stored fantasy rounds {stored} (stale rollup)")
        return
    # A game counted for one side only means a broken opponent join for the other.
    one_sided = []
    for rnd in rounds:
        defending = set(dvp.loc[dvp["Round"] == rnd, "DefTeam"])
        for g in schedule[schedule["Round"] == rnd].itertuples():
            if (g.HomeCode in defending) != (g.AwayCode in defending):
                one_sided.append(f"R{rnd} {g.HomeCode}-{g.AwayCode}")
    if one_sided:
        rep.line("FAIL", "dvp", f"games with only one side in the rollup: {one_sided}")
        return
    odd = []
    for p, rows in dvp.groupby("Position"):
        p36 = rows["FPT"].sum() / rows["Minutes"].sum() * 36 if rows["Minutes"].sum() else 0
        if not 5 <= p36 <= 40:
            odd.append(f"{p} {p36:.1f}")
    if odd:
        rep.line("WARN", "dvp", f"league FPT/36 allowed looks off: {odd}")
    else:
        rep.line("PASS", "dvp", f"rounds {rounds[0]}-{rounds[-1]}, {dvp['DefTeam'].nunique()} teams, "
                                f"{len(dvp)} rows")


def check_local_api(rep, top_name, top_round):
    try:
        d = _get_json(f"{LOCAL_API}/player?" + urllib.parse.urlencode({"name": top_name, "season": SEASON}))
        rounds = [g.get("Round") for g in d.get("games", [])]
        if top_round in rounds:
            rep.line("PASS", "local API", f"/api/player {top_name} has round {top_round}")
        else:
            rep.line("FAIL", "local API", f"/api/player {top_name} rounds {rounds}, no {top_round}")
        s = _get_json(f"{LOCAL_API}/stats", {"season": SEASON, "position": "All", "min_cr": 0,
                                             "max_cr": 100, "last_x_games": 100})
        rows = s if isinstance(s, list) else s.get("data", s.get("players", []))
        rep.line("PASS" if rows else "FAIL", "local API", f"/api/stats returns {len(rows)} players")
        m = _get_json(f"{LOCAL_API}/defense-vs-position?" + urllib.parse.urlencode({"season": SEASON}))
        rep.line("PASS" if len(m.get("teams", [])) == 20 else "FAIL", "local API",
                 f"/api/defense-vs-position round {m.get('round')}: {len(m.get('teams', []))} teams")
    except Exception as e:
        rep.line("FAIL", "local API", f"not reachable ({e}) - is uvicorn running on :8000?")


def check(local_api=False):
    if not os.path.exists(STATE):
        print("No snapshot - run `verify.py snapshot` before the fetch.")
        return 2
    with open(STATE) as f:
        before = json.load(f)
    stats, fantasy, schedule = _quiet_load(STATS), _quiet_load(FANTASY), _quiet_load(SCHEDULE)
    rep = Report()

    games = sorted(int(g) for g in stats["GameCode"].unique())
    new_games = [g for g in games if g not in set(before["games"])]
    print(f"Dev, season {SEASON}: games 1-{max(games, default=0)}, "
          f"{len(new_games)} new: {new_games or 'none'}\n")

    for name, now, was in (("stats rows", len(stats), before["stats_rows"]),
                           ("fantasy rows", len(fantasy), before["fantasy_rows"])):
        rep.line("FAIL" if now < was else "PASS", name, f"{was} -> {now}")

    check_boxscores(rep, stats, new_games)
    check_schedule(rep, stats, schedule, new_games)
    new_fantasy = check_fantasy(rep, fantasy, schedule, before)
    check_dvp(rep, fantasy, schedule)

    # The same "does every season load and render" check promote.py runs.
    import contextlib
    import io
    from promote import check_dev
    with contextlib.redirect_stdout(io.StringIO()):
        ok, lines = check_dev()
    rep.line("PASS" if ok else "FAIL", "app loads", "every season (promote.py check_dev)")
    if not ok:
        print("\n".join(lines))

    top = new_fantasy if not new_fantasy.empty else fantasy[fantasy["GameCode"] == latest_round(fantasy)]
    top = top.sort_values("FPT", ascending=False)
    if not top.empty:
        print("\nTop FPT in the new data:")
        for _, r in top.head(5).iterrows():
            print(f"  R{int(r['GameCode'])}  {r['PlayerName']:<16} {r['Team']:<4} {r['FPT']:>5.1f} FPT  "
                  f"({int(r['Points'])} pts, {r['CR']} CR)")
        lead = top.iloc[0]
        if local_api:
            print()
            check_local_api(rep, lead["PlayerName"], int(lead["GameCode"]))
        print(f"\nTOP_SCORER={lead['PlayerName']}")
        print(f"TOP_ROUND={int(lead['GameCode'])}")

    print("\nRESULT: " + ("FAIL - do not promote" if rep.failed else "PASS"))
    return 1 if rep.failed else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "snapshot":
        snapshot()
    elif cmd == "check":
        sys.exit(check(local_api="--local-api" in sys.argv))
    else:
        print(__doc__)
        sys.exit(2)
