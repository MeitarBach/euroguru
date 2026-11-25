"""EuroGuru watchlists: keep the Live tab's watchlists in step with the fantasy league's teams.

Commands (from the repo root, system python3, standard library only, like generate.py):
  select-sql               SQL that reads the account's watchlists (save the result as round-NN/before.json)
  build --round N          round-NN/rosters.json (what the official site shows) -> EuroGuru keys,
                           checked, merged into before.json -> after.json + update.sql + a report
  restore-sql --round N    SQL that writes before.json back (the undo)

Files (social/watchlists/, gitignored - names of real people live only here):
  league.json              the league, the Supabase row, and which watchlist follows which team
  round-NN/rosters.json    each team's lineup as read off the site (the agent writes it)
  round-NN/before.json     the account's watchlists before (the backup)
  round-NN/after.json      the watchlists to write; update.sql writes them

A watchlist (frontend/src/hooks/useWatchGroups.js) is {id, name, color, keys, bench, captain,
coach}: `keys` every player ("id:<PlayerID>"), `bench` the subset on the bench with the 6th
man first, `captain` a starter, `coach` "coach:<CoachID>". The account copy is
user_settings.settings.liveGroups (lib/prefs.js) - the app pulls it on sign-in and on focus.
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

SKILL = Path(__file__).resolve().parent
REPO = SKILL.parents[2]
sys.path.insert(0, str(REPO / ".claude" / "skills" / "euroguru-social"))
import generate as g  # noqa: E402

ROOT = REPO / "social" / "watchlists"
LEAGUE = ROOT / "league.json"
VALID = {(2, 1, 2), (1, 2, 2), (2, 2, 1), (1, 3, 1), (3, 1, 1)}  # G-F-C


def league():
    if not LEAGUE.exists():
        sys.exit(f"{LEAGUE.relative_to(REPO)} is missing - see SKILL.md for its shape")
    return json.loads(LEAGUE.read_text())


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def cmd_select_sql(args):
    cfg = league()
    uid = cfg.get("settings_user_id")
    if uid:
        print(f"select user_id, settings->'liveGroups' as groups from public.user_settings where user_id = {sql_text(uid)};")
        return
    names = [t["watchlist"] for t in cfg["teams"] if t["watchlist"] != "My team"][:3]
    cond = "\n  and ".join(f"settings->'liveGroups' @> {sql_text(json.dumps([{'name': n}]))}" for n in names)
    print(f"select user_id, settings->'liveGroups' as groups from public.user_settings\nwhere {cond};")


class Pool:
    """The prod API's players and coaches, found by 'Surname CLUB' as the site shows them."""

    def __init__(self):
        self.rows = g.stats(100)
        self.coaches = g.api_get(f"/coaches?season={g.SEASON}")
        self.name_of = {r["PlayerKey"]: r["PlayerName"] for r in self.rows}
        self.pos_of = {r["PlayerKey"]: r["position"] for r in self.rows}
        self.coach_name = {f"coach:{c['CoachID']}": c["CoachName"] for c in self.coaches}

    @staticmethod
    def split(spec):
        parts = spec.strip().rsplit(" ", 1)
        if len(parts) != 2 or not parts[1].isupper():
            sys.exit(f"{spec!r}: write players as 'Surname CLUB', e.g. 'Horton-Tucker FBT'")
        return parts[0], parts[1]

    def player(self, spec):
        who, club = self.split(spec)
        # 'M. Wright' carries an initial (for a shared surname); 'Fodzo Dada' is all surname.
        initial, key = g.name_parts(who) if "." in who else ("", g.name_parts("X " + who)[1])

        def same(r, exact):
            i, s = g.name_parts(r["PlayerName"])
            return r["Team"] == club and (s == key if exact else key in s) and (not initial or i == initial)
        hits = [r for r in self.rows if same(r, True)]
        if not hits:  # a longer surname on the feed ("Clark III")
            hits = [r for r in self.rows if same(r, False)]
        if len(hits) != 1:
            sys.exit(f"{spec!r} matches {[(h['PlayerName'], h['Team']) for h in hits] or 'nobody'} - "
                     f"add the initial ('M. Wright MIL') or check the club code")
        return hits[0]["PlayerKey"]

    def coach(self, spec):
        sur, club = self.split(spec)
        hits = [c for c in self.coaches if c["Team"] == club
                and g.name_parts(c["CoachName"])[1] == g.name_parts("X " + sur)[1]]
        if len(hits) != 1:
            sys.exit(f"coach {spec!r} matches {[c['CoachName'] for c in hits] or 'nobody'}")
        return f"coach:{hits[0]['CoachID']}"


def cmd_build(args):
    cfg = league()
    folder = ROOT / f"round-{args.round:02d}"
    rosters = json.loads((folder / "rosters.json").read_text())
    before = json.loads((Path(args.current) if args.current else folder / "before.json").read_text())
    if not isinstance(before, list):
        sys.exit("before.json must be the liveGroups array as the select returned it")
    pool = Pool()
    by_name = {gr["name"]: gr for gr in before}
    new = {}
    for t in rosters["teams"]:
        wl = t["watchlist"]
        if wl not in by_name:
            sys.exit(f"no watchlist named {wl!r} on the account - ask the user which one follows {t.get('team')}")
        starters = [pool.player(s) for s in t["starters"]]
        captain = pool.player(t["captain"])
        sixth = pool.player(t["sixth"])
        bench = [pool.player(s) for s in t["bench"]]
        keys = starters + [sixth] + bench
        pos = Counter(pool.pos_of[k] for k in keys)
        five = Counter(pool.pos_of[k] for k in starters)
        problems = []
        if len(set(keys)) != 10:
            problems.append(f"{len(set(keys))} different players, not 10")
        if (pos["G"], pos["F"], pos["C"]) != (4, 4, 2):
            problems.append(f"squad is {pos['G']}G-{pos['F']}F-{pos['C']}C, not 4-4-2")
        if (five["G"], five["F"], five["C"]) not in VALID:
            problems.append(f"starting five {five['G']}-{five['F']}-{five['C']} is not a formation")
        if captain not in starters:
            problems.append("the captain is not a starter")
        if problems:
            sys.exit(f"{wl} ({t.get('team')}): " + "; ".join(problems) + " - re-read the lineup on the site")
        new[wl] = {**by_name[wl], "keys": keys, "bench": [sixth] + bench, "captain": captain,
                   "coach": pool.coach(t["coach"])}
    after = [new.get(gr["name"], gr) for gr in before]
    (folder / "after.json").write_text(json.dumps(after, indent=1, ensure_ascii=False) + "\n")
    uid = cfg.get("settings_user_id")
    if not uid:
        sys.exit("league.json has no settings_user_id - run select-sql first and record the row's user_id")
    sql = update_sql(after, uid)
    (folder / "update.sql").write_text(sql)
    report(pool, rosters, before, new, cfg)
    print(f"\n-> {(folder / 'after.json').relative_to(REPO)}, {(folder / 'update.sql').relative_to(REPO)} "
          f"({len(sql)} chars) - run update.sql with the Supabase MCP execute_sql")


def update_sql(groups, uid):
    payload = json.dumps(groups, separators=(",", ":"), ensure_ascii=False)
    return (f"update public.user_settings\n"
            f"set settings = jsonb_set(settings, '{{liveGroups}}', {sql_text(payload)}::jsonb),\n"
            f"    updated_at = now()\n"
            f"where user_id = {sql_text(uid)}\n"
            f"returning user_id, updated_at, (select string_agg(x->>'name' || ':' || jsonb_array_length(x->'keys'), ', ')\n"
            f"  from jsonb_array_elements(settings->'liveGroups') x) as summary;\n")


def cmd_restore_sql(args):
    """The SQL that puts round-NN/before.json back - the undo."""
    before = json.loads((ROOT / f"round-{args.round:02d}" / "before.json").read_text())
    print(update_sql(before, league()["settings_user_id"]))


def report(pool, rosters, before, new, cfg):
    name = lambda k: pool.name_of.get(k, pool.coach_name.get(k, k))  # noqa: E731
    team_of = {t["watchlist"]: t.get("team", t["watchlist"]) for t in rosters["teams"]}
    old = {gr["name"]: gr for gr in before}
    print(f"Round {rosters['round']} · {len(new)} watchlists\n")
    print("| Watchlist | Team | Captain | 6th man | Coach | In | Out |")
    print("|---|---|---|---|---|---|---|")
    for wl, gr in new.items():
        ins = [name(k) for k in gr["keys"] if k not in old[wl]["keys"]]
        outs = [name(k) for k in old[wl]["keys"] if k not in gr["keys"]]
        print(f"| {wl} | {team_of[wl]} | {name(gr['captain'])} | {name(gr['bench'][0])} | {name(gr['coach'])} | "
              f"{', '.join(ins) or '-'} | {', '.join(outs) or '-'} |")
    owned = Counter(k for gr in new.values() for k in gr["keys"])
    print("\nShared players: " + ", ".join(f"{name(k)} {n}/{len(new)}" for k, n in owned.most_common() if n >= 3))
    print("Captains: " + ", ".join(f"{name(k)} x{n}" for k, n in Counter(gr["captain"] for gr in new.values()).most_common()))
    print("Coaches: " + ", ".join(f"{name(k)} x{n}" for k, n in Counter(gr["coach"] for gr in new.values()).most_common()))
    mine = new.get("My team")
    if mine:
        for wl, gr in new.items():
            if wl == "My team":
                continue
            only_them = [name(k) for k in gr["keys"] if k not in mine["keys"]]
            only_me = [name(k) for k in mine["keys"] if k not in gr["keys"]]
            print(f"vs {wl}: they have {', '.join(only_them) or '-'}; only we have {', '.join(only_me) or '-'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["select-sql", "build", "restore-sql"])
    ap.add_argument("--round", type=int)
    ap.add_argument("--current", help="build: the watchlists before (default round-NN/before.json)")
    args = ap.parse_args()
    if args.cmd in ("build", "restore-sql") and not args.round:
        sys.exit(f"{args.cmd} needs --round")
    {"select-sql": cmd_select_sql, "build": cmd_build, "restore-sql": cmd_restore_sql}[args.cmd](args)


if __name__ == "__main__":
    main()
