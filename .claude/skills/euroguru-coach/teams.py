"""EuroGuru teams: after every save on the official site, mirror the official teams into
EuroGuru's My Teams (public.teams), so the app's live scores, Watch Rooms and look-backs
use the lineups that really count.

Commands (from the repo root, system python3, standard library only, like coach.py):
  select-sql                       SQL that reads the mapped EuroGuru teams. Save the result as
                                   round-NN/teams/<tag>-before.json (the backup).
  build --round N --tag TAG        official lineups -> checked SQL + a report.
                                   StringUtils comes from state.json (run `coach.py commit` first);
                                   every other team from round-NN/teams/<tag>-official.json.
  restore-sql --round N --tag TAG  SQL that puts <tag>-before.json back (the undo).

TAG names the save: `plan` (before a round), `t1`, `t2` (after that turn).

Config: social/coach/teams.json (gitignored) says which EuroGuru team mirrors which official
team. A lineup is {keys, bench (6th man first), captain, coach}, as in frontend/src/lib/teams.js.
While a round is on, the database's teams_guard (supabase/migrations/*_round_subs.sql) only
accepts subs and the armband, and nobody whose game has started may move up. `build` checks the
same rules and skips, with the reason, any team the database would refuse.
"""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SKILL = Path(__file__).resolve().parent
REPO = SKILL.parents[2]
sys.path.insert(0, str(REPO / ".claude" / "skills" / "euroguru-social"))
sys.path.insert(0, str(REPO / ".claude" / "skills" / "euroguru-watchlists"))
import generate as g  # noqa: E402
from watchlists import Pool, VALID  # noqa: E402  ('Surname CLUB' -> key, as the site prints names)

COACH = REPO / "social" / "coach"
CONFIG = COACH / "teams.json"
STATE = COACH / "state.json"
ROLE = ("bench", "6th", "starter", "captain")


def config():
    if not CONFIG.exists():
        sys.exit(f"{CONFIG.relative_to(REPO)} is missing - see SKILL.md, 'Mirror into EuroGuru'")
    return json.loads(CONFIG.read_text())


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def jsonb(obj):
    return sql_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False)) + "::jsonb"


def folder(rnd):
    return COACH / f"round-{rnd:02d}" / "teams"


def cmd_select_sql(args):
    ids = ", ".join(sql_text(t["team_id"]) for t in config()["euroguru"])
    print("select t.id, t.owner, t.name, t.lineup,\n"
          "  (select row_to_json(w) from public.locked_round() w) as round_window\n"
          f"from public.teams t where t.id in ({ids}) order by t.created_at;")


# ------------------------------------------------------------------ official lineups

def from_state(pool, rnd):
    """StringUtils as coach.py committed it - the lineup just saved and checked on the site."""
    st = json.loads(STATE.read_text())
    if st["round"] != rnd:
        sys.exit(f"state.json is at Round {st['round']}, not {rnd} - run `coach.py commit plan|turn` first")
    club = {p["name"]: p["club"] for p in st["squad"]}

    def key(name):
        hits = [r["PlayerKey"] for r in pool.rows if r["PlayerName"] == name and r["Team"] == club[name]]
        if len(hits) != 1:
            sys.exit(f"state.json: {name} ({club[name]}) matches {len(hits)} players on the API")
        return hits[0]
    lu, c = st["lineup"], st["coach"]
    coach = [x for x in pool.coaches if x["CoachName"] == c["name"] and x["Team"] == c["club"]]
    if len(coach) != 1:
        sys.exit(f"state.json: coach {c['name']} ({c['club']}) matches {len(coach)} coaches on the API")
    return {"five": [key(n) for n in lu["starters"]], "captain": key(lu["captain"]), "sixth": key(lu["sixth"]),
            "bench": [key(n) for n in lu["bench"]], "coach": f"coach:{coach[0]['CoachID']}"}


def from_site(pool, team, known):
    """A team as read off the site. A player is 'Surname CLUB' (any player) or just the
    surname ('Vezenkov', 'M. Wright') when he was already in the EuroGuru team - `known`, its
    keys and coach before - which is always so while a round is on (no transfers)."""
    by_surname = {}
    for k in known:
        name = pool.name_of.get(k) or pool.coach_name.get(k)
        if name:
            by_surname.setdefault(g.name_parts(name)[1], []).append(k)

    def key(spec, coach=False):
        parts = spec.strip().rsplit(" ", 1)
        if len(parts) == 2 and parts[1].isupper() and parts[1].isalpha():
            return pool.coach(spec) if coach else pool.player(spec)
        who = spec.strip()
        initial, sur = g.name_parts(who) if "." in who else ("", g.name_parts("X " + who)[1])
        hits = [k for k in by_surname.get(sur, [])
                if k.startswith("coach:") == coach
                and (not initial or g.name_parts(pool.name_of.get(k, ""))[0] == initial)]
        if len(hits) != 1:
            sys.exit(f"{team['team']}: {spec!r} is {'ambiguous' if hits else 'not in its EuroGuru team yet'} - "
                     f"write it as 'Surname CLUB' (the club code on the jersey)")
        return hits[0]
    return {"five": [key(s) for s in team["starters"]], "captain": key(team["captain"]),
            "sixth": key(team["sixth"]), "bench": [key(s) for s in team["bench"]],
            "coach": key(team["coach"], coach=True)}


def check(name, pool, lu):
    """An official lineup must be a legal one; if not, it was misread."""
    keys = lu["five"] + [lu["sixth"]] + lu["bench"]
    pos = Counter(pool.pos_of[k] for k in keys)
    five = Counter(pool.pos_of[k] for k in lu["five"])
    problems = []
    if len(set(keys)) != 10:
        problems.append(f"{len(set(keys))} different players, not 10")
    if (pos["G"], pos["F"], pos["C"]) != (4, 4, 2):
        problems.append(f"squad is {pos['G']}G-{pos['F']}F-{pos['C']}C, not 4-4-2")
    if (five["G"], five["F"], five["C"]) not in VALID:
        problems.append(f"starting five {five['G']}-{five['F']}-{five['C']} is not a formation")
    if lu["captain"] not in lu["five"]:
        problems.append("the captain is not a starter")
    if problems:
        sys.exit(f"{name}: " + "; ".join(problems) + " - re-read it on the site")


# ------------------------------------------------------------------------ the sync

def rank(lineup, key):
    """The database's public.lineup_rank: captain 3, starter 2, sixth man 1, bench 0."""
    if lineup.get("captain") == key:
        return 3
    bench = lineup.get("bench") or []
    if key not in bench:
        return 2
    return 1 if bench[0] == key else 0


def same_roles(a, b):
    """Every player in the same role, the same coach. The order of the bench after the
    sixth man doesn't count - they all score half."""
    ab, bb = a.get("bench") or [], b.get("bench") or []
    return (sorted(a.get("keys") or []) == sorted(b.get("keys") or []) and a.get("captain") == b.get("captain")
            and a.get("coach") == b.get("coach") and ab[:1] == bb[:1] and sorted(ab[1:]) == sorted(bb[1:]))


def arrange(old, lu):
    keys = lu["five"] + [lu["sixth"]] + lu["bench"]
    if sorted(old.get("keys") or []) == sorted(keys):
        keys = old["keys"]  # the same players: keep their order, change only the roles
    return {"keys": keys, "bench": [lu["sixth"]] + lu["bench"], "captain": lu["captain"], "coach": lu["coach"]}


def started_clubs(rnd):
    """Euroleague codes of the clubs whose game in round `rnd` has tipped off."""
    now = datetime.now(timezone.utc)
    return {c for gm in g.schedule() if gm["round"] == rnd and gm["tipoff"] <= now for c in (gm["home"], gm["away"])}


def refusal(old, new, win, club_of, started, name):
    """Why the database would refuse this change while a round is on, or None."""
    if not win:
        return None
    if sorted(old.get("keys") or []) != sorted(new["keys"]) or old.get("coach") != new["coach"]:
        return (f"it needs transfers, and while Round {win['round']} is on EuroGuru takes only subs and the "
                f"armband (until {win['unlock_at']}) - sync it after the round")
    up = [name(k) for k in new["keys"] if rank(new, k) > rank(old, k)
          and g.DUNKEST_TO_EL.get(club_of.get(k), club_of.get(k)) in started]
    return f"{', '.join(up)} already played and would move up - EuroGuru refuses that" if up else None


def changes(old, new, name):
    out = []
    ins = [name(k) for k in new["keys"] if k not in (old.get("keys") or [])]
    outs = [name(k) for k in (old.get("keys") or []) if k not in new["keys"]]
    if ins or outs:
        out.append(f"in {', '.join(ins) or '-'}; out {', '.join(outs) or '-'}")
    out += [f"{name(k)} {ROLE[rank(old, k)]}->{ROLE[rank(new, k)]}" for k in new["keys"]
            if k in (old.get("keys") or []) and rank(old, k) != rank(new, k)]
    if old.get("coach") != new["coach"]:
        out.append(f"coach {name(old.get('coach'))} -> {name(new['coach'])}")
    return out


def cmd_build(args):
    cfg = config()
    here = folder(args.round)
    before = json.loads((Path(args.before) if args.before else here / f"{args.tag}-before.json").read_text())
    if not isinstance(before, list):
        sys.exit("before.json must be the array of rows the select returned")
    pool = Pool()
    club_of = {r["PlayerKey"]: r["Team"] for r in pool.rows}
    name = lambda k: pool.name_of.get(k) or pool.coach_name.get(k) or str(k)  # noqa: E731
    mirror = {t["team_id"]: t for t in cfg["euroguru"]}
    if {t["id"] for t in before} != set(mirror):
        sys.exit("before.json doesn't hold exactly the teams in teams.json - run select-sql again")

    read = here / f"{args.tag}-official.json"
    site = {t["team"]: t for t in json.loads(read.read_text())["teams"]} if read.exists() else {}
    official = {}
    for team, src in cfg["official"].items():
        if src.get("from") == "state.json":
            official[team] = from_state(pool, args.round)
        elif team in site:
            known = {k for t in before if mirror[t["id"]]["mirrors"] == team
                     for k in (t["lineup"].get("keys") or []) + [t["lineup"].get("coach")] if k}
            official[team] = from_site(pool, site[team], known)
        else:
            continue
        check(team, pool, official[team])

    win = next((t["round_window"] for t in before if t.get("round_window")), None)
    started = started_clubs(win["round"]) if win else set()
    after, writes, synced, lines = [], [], [], []
    for t in before:
        m, old = mirror[t["id"]], t["lineup"]
        label = f"{t['name']} ({m['account']}) <- {m['mirrors']}"
        if m["mirrors"] not in official:
            lines.append(f"{label}: SKIPPED - {m['mirrors']} wasn't read this time")
            after.append(t)
            continue
        new = arrange(old, official[m["mirrors"]])
        why = refusal(old, new, win, club_of, started, name)
        if why:
            lines.append(f"{label}: SKIPPED - {why}")
            after.append(t)
            continue
        if same_roles(old, new):
            lines.append(f"{label}: already in step")
            new = old
        else:
            lines.append(f"{label}: " + "; ".join(changes(old, new, name)))
            writes.append((t, old, new))
        synced.append((t, new))
        after.append({**t, "lineup": new})

    here.mkdir(parents=True, exist_ok=True)
    (here / f"{args.tag}-after.json").write_text(json.dumps(after, indent=1, ensure_ascii=False) + "\n")
    sql = update_sql(writes, synced, win)
    (here / f"{args.tag}-update.sql").write_text(sql)
    state = f"Round {win['round']} is on: subs and the armband only" if win else "no round on: anything goes"
    print(f"EuroGuru teams · Round {args.round} · {args.tag} · {state}\n")
    print("\n".join(lines))
    rel = (here / f"{args.tag}-update.sql").relative_to(REPO)
    print(f"\n-> {rel}: {len(writes)} to write - run it with the Supabase MCP execute_sql; "
          f"every row must come back synced = true" if writes else f"\n-> nothing to write ({rel} only checks)")


def update_sql(writes, synced, win):
    out = ["begin;"]
    for t, old, new in writes:  # only if nothing changed it since the backup
        out.append(f"update public.teams set lineup = {jsonb(new)}\n"
                   f"  where id = {sql_text(t['id'])} and owner = {sql_text(t['owner'])} and lineup = {jsonb(old)};")
    out.append("commit;")
    if not synced:
        return "\n".join(out) + "\n"
    values = ",\n  ".join(f"({sql_text(t['id'])}::uuid, {jsonb(new)})" for t, new in synced)
    round_row = (f"(select tr.lineup = t.lineup from public.team_rounds tr where tr.team_id = t.id "
                 f"and tr.season = {int(win['season'])} and tr.round = {int(win['round'])})" if win else "null")
    out.append(f"with want(id, lineup) as (values\n  {values})\n"
               f"select t.name, t.lineup = w.lineup as synced, t.lineup->>'captain' as captain,\n"
               f"  t.lineup->'bench'->>0 as sixth, {round_row} as round_row_matches\n"
               f"from want w join public.teams t on t.id = w.id order by t.name;")
    return "\n".join(out) + "\n"


def cmd_restore_sql(args):
    """The SQL that puts <tag>-before.json back. While a round is on the database still
    refuses moving up a player who has played, so mid-round an undo can come back partial."""
    before = json.loads((folder(args.round) / f"{args.tag}-before.json").read_text())
    print("begin;")
    for t in before:
        print(f"update public.teams set lineup = {jsonb(t['lineup'])} "
              f"where id = {sql_text(t['id'])} and owner = {sql_text(t['owner'])};")
    print("commit;")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["select-sql", "build", "restore-sql"])
    ap.add_argument("--round", type=int)
    ap.add_argument("--tag", help="plan (before a round) or t1, t2 (after that turn)")
    ap.add_argument("--before", help="build: the teams before (default round-NN/teams/<tag>-before.json)")
    args = ap.parse_args()
    if args.cmd != "select-sql" and not (args.round and args.tag):
        sys.exit(f"{args.cmd} needs --round and --tag")
    {"select-sql": cmd_select_sql, "build": cmd_build, "restore-sql": cmd_restore_sql}[args.cmd](args)


if __name__ == "__main__":
    main()
