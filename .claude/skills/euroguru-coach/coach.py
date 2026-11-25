"""EuroGuru coach: runs one EuroLeague Fantasy Challenge team, round after round.

Commands (from the repo root, standard library only, like generate.py):
  status                 where we are: round, turns, lock, trades, next unlimited window
  plan   [--round N]     trades (<= 4, or all in an unlimited window), lineup, captain plan
                         and the between-turn rules for the coming round -> round-NN/plan.md
  turn   [--round N]     after a turn: real FPT so far + expected for the rest -> the subs and
         [--after K]     armband move that maximise the round -> round-NN/turn-K.md
  review [--round N]     a finished round: real score by role, price changes, team value ->
                         LOG.md, and state.json moves on to the next round
  commit plan|turn       after the moves are entered (and saved) on the official site: write
         [--round N]     the planned squad / lineup into state.json

State lives in social/coach/ (gitignored): state.json (the team as it is on the official
site), LOG.md (every round's moves and why), round-NN/ (plan, turn notes, screenshots).

The model is generate.py's expected FPT (squad_pool("expected"): availability x season
average shrunk to price; it won the 2025-26 backtest at every budget), with this round's
winner's bonus in place of the club's usual one (captain_scores' rule), plus the coach's
judgement in state.json "overrides" ({name: {fpt, until, why}}) for what the model can't
see (a new arrival, a player back from injury).
"""
import argparse
import itertools
import json
import random
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SKILL = Path(__file__).resolve().parent
REPO = SKILL.parents[2]
sys.path.insert(0, str(REPO / ".claude" / "skills" / "euroguru-social"))
import generate as g  # noqa: E402

OUT = REPO / "social" / "coach"
STATE = OUT / "state.json"
LOG = OUT / "LOG.md"
IL = ZoneInfo("Asia/Jerusalem")
PARIS = g.PARIS

ROLE_W = {"captain": 2.0, "starter": 1.0, "sixth": 1.0, "bench": 0.5}
RANK = {"captain": 3, "starter": 2, "sixth": 1, "bench": 0}
VALID = {(2, 1, 2), (1, 2, 2), (2, 2, 1), (1, 3, 1), (3, 1, 1)}
HORIZON_W = (1.0, 0.6, 0.35)   # this round, the next, the one after
TRADE_MARGIN = 1.0             # horizon FPT a trade must add (model noise + keeping a trade)
MIN_GAMES = 5                  # players need this many games (overrides exempt)
MIN_AVAIL = 0.6                # ... and this share of their club's last 5 games
SIGMA = 8.5                    # a player's game-to-game spread (research/expected_model)
SIMS = 1500
GAME_LEN = timedelta(hours=2, minutes=15)


# --- state --------------------------------------------------------------------------

def load_state():
    return json.loads(STATE.read_text())


def save_state(state):
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")


def il(dt):
    return dt.astimezone(IL).strftime("%a %d %b %H:%M")


def num(x):
    return f"{x:.1f}"


# --- the world: schedule, model, coaches ------------------------------------------

class World:
    def __init__(self, state, verbose=True):
        self.state = state
        self.games = g.schedule()
        self.played = g.results()
        self.last = g.last_finished_round(self.games) or 0
        self.next = g.next_round(self.games)
        self.pool = g.squad_pool("expected", played=self.played)
        self.rating = g.club_ratings(self.played)
        self.coach_pts = g.coach_rounds(self.played)
        self.inj = g.injuries()
        gm, wn = Counter(), Counter()
        for _, home, away, margin in self.played:
            gm[home] += 1
            gm[away] += 1
            wn[home if margin > 0 else away] += 1
        self.base_win = {c: wn[c] / gm[c] for c in gm}
        self._outlook = {}
        self.by_name = {p["name"]: p for p in self.pool}
        # The coach's judgement over the model, while it lasts.
        for name, o in (state.get("overrides") or {}).items():
            p = self.by_name.get(name)
            if p and o.get("until", 0) >= self.next:
                p["fpt"], p["avail"], p["override"] = o["fpt"], (5, 5), o.get("why", "")
        for p in self.pool:
            a, b = p.get("avail", (0, 0))
            p["thin"] = (p["games"] < MIN_GAMES or not b or a / b < MIN_AVAIL) and "override" not in p

    # club -> this round's game: win chance, coach points, opponent, turn, tip-off
    def outlook(self, rnd):
        if rnd not in self._outlook:
            fx = sorted((x for x in self.games if x["round"] == rnd), key=lambda x: x["tipoff"])
            days = sorted({x["tipoff"].astimezone(PARIS).date() for x in fx})
            out = {}
            for x in fx:
                edge = self.rating.get(x["home"], 0.0) - self.rating.get(x["away"], 0.0) + g.HOME_EDGE
                ph, wh = g.coach_outlook(edge)
                pa, wa = g.coach_outlook(-edge)
                turn = days.index(x["tipoff"].astimezone(PARIS).date()) + 1
                common = dict(turn=turn, tip=x["tipoff"], code=x["code"], played=x["played"])
                out[x["home"]] = dict(win=wh, coach=ph, opp=x["away"], home=True, margin=edge, **common)
                out[x["away"]] = dict(win=wa, coach=pa, opp=x["home"], home=False, margin=-edge, **common)
            self._outlook[rnd] = out
        return self._outlook[rnd]

    def turns(self, rnd):
        """[(turn, first tip-off, last tip-off, games)] for a round."""
        fx = sorted((x for x in self.games if x["round"] == rnd), key=lambda x: x["tipoff"])
        days = sorted({x["tipoff"].astimezone(PARIS).date() for x in fx})
        out = []
        for i, d in enumerate(days, 1):
            gs = [x for x in fx if x["tipoff"].astimezone(PARIS).date() == d]
            out.append((i, gs[0]["tipoff"], gs[-1]["tipoff"], gs))
        return out

    def exp(self, p, rnd):
        """Expected FPT in a round: the model with that game's winner's bonus; 0 = no game or OUT."""
        o = self.outlook(rnd).get(p["team"])
        if not o or p["out"]:
            return 0.0
        return p["fpt"] * (1 + 0.1 * o["win"]) / (1 + 0.1 * self.base_win.get(p["team"], 0.5))

    def horizon(self, p, rnd):
        return sum(w * self.exp(p, rnd + k) for k, w in enumerate(HORIZON_W))

    def coaches(self, rnd):
        cs = g.coach_pool(self.coach_pts, self.rating,
                          [(x["home"], x["away"]) for x in self.games if x["round"] == rnd])
        for c in cs:
            c["exp"] = c["proj"]
            c["hz"] = sum(w * self.outlook(rnd + k).get(c["team"], {}).get("coach", 0.0)
                          for k, w in enumerate(HORIZON_W))
        return cs

    def player(self, name):
        p = self.by_name.get(name)
        return p if p is not None else g.find_player(self.pool, name)

    def coach(self, coaches, name):
        hit = [c for c in coaches if c["name"] == name] or \
              [c for c in coaches if g.name_parts(c["name"])[1] == g.name_parts(name)[1]]
        if len(hit) != 1:
            sys.exit(f"coach {name!r} matches {[c['name'] for c in hit] or 'nobody'}")
        return hit[0]

    def unlimited(self, rnd):
        t = self.state["trades"]
        return (rnd - 1) in set(t["unlimited_after_rounds"]) or rnd > 38 and t.get("postseason_unlimited")


# --- lineups and the turn rules ------------------------------------------------------

def formation_ok(players):
    c = Counter(p["pos"] for p in players)
    return (c["G"], c["F"], c["C"]) in VALID


def best_roles(squad, value, turn_of, done, current=None):
    """The roles that maximise the round: `value[i]` is a real FPT for players whose turn
    is done (turn_of[i] <= done) and an expected one for the rest. A player who has played
    can only move down from his `current` role (captain > starter > sixth > bench); with
    done=0 everyone is free. Returns (score, starters, captain, sixth, bench) as indexes."""
    n = len(squad)
    played = [turn_of[i] <= done for i in range(n)]
    rank = [RANK[current[i]] if current else 3 for i in range(n)]
    best = None
    for S in itertools.combinations(range(n), 5):
        if not formation_ok([squad[i] for i in S]):
            continue
        if any(played[i] and rank[i] < RANK["starter"] for i in S):
            continue
        caps = [i for i in S if not played[i] or rank[i] == RANK["captain"]]
        if not caps:
            continue
        ci = max(caps, key=lambda i: value[i])
        rest = [i for i in range(n) if i not in S]
        sixes = [i for i in rest if not played[i] or rank[i] >= RANK["sixth"]]
        si = max(sixes, key=lambda i: value[i]) if sixes else None
        score = sum(value[i] for i in S) + value[ci] + (value[si] if si is not None else 0.0) \
            + 0.5 * sum(value[i] for i in rest if i != si)
        if current:  # on a tie, keep the lineup as it is - no moves for nothing
            kept = roles_of(n, S, ci, si)
            score += 1e-4 * sum(kept[i] == current[i] for i in range(n))
        if best is None or score > best[0] + 1e-9:
            best = (score, S, ci, si, [i for i in rest if i != si])
    return best


def roles_of(n, S, ci, si):
    roles = ["bench"] * n
    for i in S:
        roles[i] = "starter"
    roles[ci] = "captain"
    if si is not None:
        roles[si] = "sixth"
    return roles


def simulate(squad, mu, turn_of, roles, sims=SIMS, seed=11):
    """Expected round score of a starting lineup: (if the moves are made after the first
    turn, if nothing is touched). Scores ~ normal(mean/avail, spread), DNP with 1-avail."""
    rnd = random.Random(seed)
    n = len(squad)
    av = []
    for p in squad:
        a, b = p.get("avail", (1, 1))
        av.append(a / b if b else 0.0)
    est = [mu[i] / av[i] if av[i] > 0 else 0.0 for i in range(n)]
    w = [ROLE_W[r] for r in roles]
    first = min(turn_of)
    moved = still = 0.0
    for _ in range(sims):
        y = [rnd.gauss(est[i], min(SIGMA, 0.45 * est[i] + 3)) if rnd.random() < av[i] else 0.0 for i in range(n)]
        still += sum(w[i] * y[i] for i in range(n))
        v = [y[i] if turn_of[i] == first else mu[i] for i in range(n)]
        _, S, ci, si, bench = best_roles(squad, v, turn_of, first, roles)
        moved += sum(y[i] for i in S) + y[ci] + (y[si] if si is not None else 0.0) + 0.5 * sum(y[i] for i in bench)
    return moved / sims, still / sims


def lineup_plan(world, squad, rnd):
    """The starting lineup for a round, organised by turn (the user's rule): as many
    first-turn players on the floor as a formation allows - a player who has played can
    only move down, so they start - and the later turns on the bench, the best of them as
    6th man. The armband goes on a first-turn starter. After the first turn the ones who
    disappointed make room for the later players (rules_after_first_turn, `turn`).
    Among the fives that start the most first-turn players, the best in the simulation wins."""
    o = world.outlook(rnd)
    mu = [world.exp(p, rnd) for p in squad]
    turn_of = [o.get(p["team"], {}).get("turn", 99) for p in squad]
    first, n = min(turn_of), len(squad)
    fives = [S for S in itertools.combinations(range(n), 5) if formation_ok([squad[i] for i in S])]
    most = max(sum(turn_of[i] == first for i in S) for S in fives)
    fives = sorted((S for S in fives if sum(turn_of[i] == first for i in S) == most),
                   key=lambda S: -sum(mu[i] for i in S))[:6]
    options = []
    for S in fives:
        rest = [i for i in range(n) if i not in S]
        firsts = [i for i in S if turn_of[i] == first] or list(S)
        six = max([i for i in rest if turn_of[i] == first] or rest, key=lambda i: mu[i])
        for c in sorted(firsts, key=lambda i: -mu[i])[:2]:
            roles = roles_of(n, S, c, six)
            moved, still = simulate(squad, mu, turn_of, roles, sims=600)
            options.append((moved, still, roles))
    options.sort(key=lambda x: (-round(x[0], 1), -x[1]))
    moved, still, roles = options[0]
    moved, still = simulate(squad, mu, turn_of, roles)
    return {"roles": roles, "mu": mu, "turn": turn_of, "moved": moved, "still": still}


def rules_after_first_turn(squad, plan):
    """Plain-language thresholds for the moves after the first turn."""
    mu, turn_of, roles = plan["mu"], plan["turn"], plan["roles"]
    first = min(turn_of)
    later = sorted((i for i in range(len(squad)) if turn_of[i] > first), key=lambda i: -mu[i])
    lines = []
    cap = roles.index("captain")
    if turn_of[cap] == first and later:
        j = later[0]  # anyone who hasn't played can be moved into the five and take the armband
        lines.append(f"Armband: {squad[cap]['name']} keeps it only with **{mu[j]:.0f}+** FPT; "
                     f"otherwise it goes to **{squad[j]['name']}** (T{turn_of[j]}, expected {num(mu[j])}), "
                     f"moved into the five first.")
    early = [i for i in range(len(squad)) if turn_of[i] == first and roles[i] in ("captain", "starter", "sixth")]
    if later and early:
        lines.append(f"Floor for the next turn: a T{first} starter who scored less than the later player who "
                     f"would take his spot drops to the bench (keeps 50%) and that player comes up. The five "
                     f"must stay a legal formation (change it first in the formation box). `coach.py turn` "
                     f"gives the exact set.")
        lines.append("Later-turn options: " + ", ".join(
            f"{squad[i]['name']} ({squad[i]['pos']}, T{turn_of[i]}, {num(mu[i])})" for i in later) + ".")
    lines.append("Before each later turn: injury/lineup news - a later-turn player ruled out stays on the bench.")
    return lines


# --- trades ---------------------------------------------------------------------------

def squad_from_state(world, state):
    squad = [world.player(p["name"]) for p in state["squad"]]
    return squad


def trade_search(world, state, rnd, max_trades):
    """The best squad reachable with up to `max_trades` changes (the coach counts as one),
    on horizon value: this round and the next two (HORIZON_W), each with its own win chance.
    Every set of sells is tried and the rest is generate.best_squad's exact optimum."""
    coaches = world.coaches(rnd)
    squad = squad_from_state(world, state)
    coach = world.coach(coaches, state["coach"]["name"])
    budget = round(sum(p["cr"] for p in squad) + coach["cr"] + state.get("bank", 0.0), 1)
    for p in world.pool:
        p["value"] = world.horizon(p, rnd)
        if p["thin"]:
            p["out"] = p["out"] or p not in squad
    for c in coaches:
        c["proj"] = c["hz"]
    items = squad + [coach]
    results = []
    seen = set()
    for k in range(0, (11 if max_trades >= 11 else max_trades) + 1):
        if max_trades >= 11 and k not in (0, 11):
            continue
        for sell in itertools.combinations(items, k):
            keep = [p for p in squad if all(p is not s for s in sell)]
            cs = coaches if any(coach is s for s in sell) else [coach]
            t = g.best_squad(world.pool, cs, budget, keep, 0.0, 1)
            if not t:
                continue
            new = [*t["starters"], t["sixth"], *t["bench"]]
            key = (frozenset(p["name"] for p in new), t["coach"]["name"])
            if key in seen:
                continue
            seen.add(key)
            ins = [p for p in new if all(p is not q for q in squad)]
            outs = [p for p in squad if all(p is not q for q in new)]
            coach_change = t["coach"] is not coach
            n_trades = len(ins) + int(coach_change)
            if n_trades > max_trades:
                continue
            results.append({"objective": t["objective"], "trades": n_trades, "squad": new, "coach": t["coach"],
                            "ins": ins, "outs": outs, "coach_change": coach_change, "cost": t["cost"]})
    base = next(r for r in results if r["trades"] == 0) if any(r["trades"] == 0 for r in results) else None
    for r in results:
        r["score"] = r["objective"] - TRADE_MARGIN * r["trades"]
    results.sort(key=lambda r: -r["score"])
    return results, base, budget, coach


# --- commands ---------------------------------------------------------------------------

def current_round(world):
    """The round in progress (first tip-off passed, last game not over), else the next one."""
    now = datetime.now(timezone.utc)
    for rnd in sorted({x["round"] for x in world.games}):
        fx = [x for x in world.games if x["round"] == rnd]
        start, end = min(x["tipoff"] for x in fx), max(x["tipoff"] for x in fx) + GAME_LEN
        if start <= now <= end + timedelta(hours=1):
            return rnd
    return world.next


def cmd_status(args):
    state = load_state()
    world = World(state)
    rnd = args.round or current_round(world)
    now = datetime.now(timezone.utc)
    print(f"Team {state['team']['name']} · state at Round {state['round']} · value {state['value']} · bank {state['bank']}")
    print(f"Last finished round {world.last}; {'in progress' if rnd != world.next or now >= min(x['tipoff'] for x in world.games if x['round'] == rnd) else 'next'}: Round {rnd}")
    for k, first, lastt, gs in world.turns(rnd):
        mine = [p["name"] for p in state["squad"] if world.outlook(rnd).get(world.player(p["name"])["team"], {}).get("turn") == k]
        print(f"  T{k}: {il(first)} -> last tip {il(lastt)} IL · {len(gs)} games · ours: {', '.join(mine) or '-'}")
    unl = world.unlimited(rnd + 1)
    print(f"Round {rnd + 1}: {'UNLIMITED trades' if unl else str(state['trades']['per_round']) + ' trades'}; "
          f"unlimited windows after rounds {state['trades']['unlimited_after_rounds']}")
    out = [p["name"] for p in squad_from_state(world, state) if p["out"]]
    print(f"Injury report hits in our squad: {', '.join(out) or 'none'}")


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def cmd_plan(args):
    state = load_state()
    world = World(state)
    rnd = args.round or world.next
    unlimited = args.unlimited or world.unlimited(rnd)
    max_trades = 11 if unlimited else (args.max_trades if args.max_trades is not None else state["trades"]["per_round"])
    results, base, budget, coach = trade_search(world, state, rnd, max_trades)
    best = results[0]
    squad, new_coach = best["squad"], best["coach"]
    plan = lineup_plan(world, squad, rnd)
    roles, mu, turn_of = plan["roles"], plan["mu"], plan["turn"]
    o = world.outlook(rnd)
    coaches = world.coaches(rnd)
    c_now = world.coach(coaches, new_coach["name"])
    turns = world.turns(rnd)
    lock = turns[0][1]
    md = [f"# Round {rnd} plan · {state['team']['name']}", "",
          f"Lock **{il(lock)} IL** · " + " · ".join(f"T{k} {il(f)}" for k, f, _, _ in turns),
          f"Budget {num(budget)} CR (squad + coach + bank) · trades allowed: {'unlimited' if unlimited else max_trades}", ""]
    md += ["## Trades", ""]
    if best["trades"] == 0:
        md.append("None - no change adds the margin (" + num(TRADE_MARGIN) + " horizon FPT per trade).")
    for p in best["outs"]:
        md.append(f"- OUT {p['name']} ({p['pos']}, {p['club']}, {num(p['cr'])} CR, horizon {num(world.horizon(p, rnd))})")
    for p in best["ins"]:
        md.append(f"- IN  {p['name']} ({p['pos']}, {p['club']}, {num(p['cr'])} CR, horizon {num(world.horizon(p, rnd))})"
                  + (f" · override: {p['override']}" if p.get("override") else ""))
    if best["coach_change"]:
        md.append(f"- COACH {coach['name']} -> {new_coach['name']} ({num(new_coach['cr'])} CR)")
    gain = best["objective"] - (base["objective"] if base else 0.0)
    md += ["", f"Horizon value {num(best['objective'])} ({'+' if gain >= 0 else ''}{num(gain)} vs no trades) · cost {num(best['cost'])} CR", ""]
    md += ["Next best options:", ""]
    for r in results[1:4]:
        md.append(f"- {r['trades']} trades, horizon {num(r['objective'])}: out "
                  + ", ".join(p["name"] for p in r["outs"]) + (" + coach" if r["coach_change"] else "")
                  + " / in " + ", ".join(p["name"] for p in r["ins"]) + (f" + {r['coach']['name']}" if r["coach_change"] else ""))
    md += ["", "## Lineup", "", "| Role | Player | Pos | Club | CR | Turn | Game | Expected |", "|---|---|---|---|---|---|---|---|"]
    order = sorted(range(len(squad)), key=lambda i: (-RANK[roles[i]], turn_of[i], -mu[i]))
    for i in order:
        p = squad[i]
        x = o.get(p["team"], {})
        game = f"{'vs' if x.get('home') else 'at'} {x.get('opp', '-')} ({x.get('win', 0):.0%})" if x else "no game"
        md.append(f"| {roles[i].capitalize()} | {p['name']} | {p['pos']} | {p['club']} | {num(p['cr'])} | T{turn_of[i]} | {game} | {num(mu[i])} |")
    cx = o.get(c_now["team"], {})
    md.append(f"| Coach | {c_now['name']} | HC | {c_now['club']} | {num(c_now['cr'])} | T{cx.get('turn', '-')} | "
              f"{'vs' if cx.get('home') else 'at'} {cx.get('opp', '-')} ({cx.get('win', 0):.0%}) | {c_now['exp']:+.1f} |")
    md += ["", f"Expected **{num(plan['moved'] + c_now['exp'])}** with the moves below, "
           f"{num(plan['still'] + c_now['exp'])} if nothing is touched (read ~18 lower as a typical week).", "",
           "## Between turns", ""]
    md += [f"{i + 1}. {line}" for i, line in enumerate(rules_after_first_turn(squad, plan))]
    hits = [p["name"] for p in squad if world.inj.get(g.name_parts(p["name"]))]
    md += ["", f"Injury report (now): {', '.join(hits) or 'none of ours'}. Check again right before the lock.", ""]
    md += ["## Coach outlook (next rounds)", "", "| Coach | Club | CR | " + " | ".join(f"R{rnd + k}" for k in range(5)) + " |",
           "|---|---|---|" + "---|" * 5]
    for c in sorted(coaches, key=lambda c: -c["hz"])[:6]:
        md.append(f"| {c['name']} | {c['club']} | {num(c['cr'])} | " + " | ".join(
            f"{world.outlook(rnd + k).get(c['team'], {}).get('coach', 0.0):+.1f}" for k in range(5)) + " |")
    path = write(OUT / f"round-{rnd:02d}" / "plan.md", "\n".join(md) + "\n")
    data = {"round": rnd, "budget": budget, "bank": round(budget - best["cost"], 1),
            "squad": [{"name": p["name"], "pos": p["pos"], "club": p["club"], "cr": p["cr"]} for p in squad],
            "coach": {"name": new_coach["name"], "club": new_coach["club"], "cr": new_coach["cr"]},
            "lineup": {"starters": [squad[i]["name"] for i in range(len(squad)) if roles[i] in ("starter", "captain")],
                       "captain": squad[roles.index("captain")]["name"],
                       "sixth": squad[roles.index("sixth")]["name"],
                       "bench": [squad[i]["name"] for i in range(len(squad)) if roles[i] == "bench"]},
            "projected": round(plan["moved"] + c_now["exp"], 1), "projected_no_changes": round(plan["still"] + c_now["exp"], 1),
            "trades": best["trades"], "outs": [p["name"] for p in best["outs"]], "ins": [p["name"] for p in best["ins"]],
            "coach_change": best["coach_change"]}
    write(OUT / f"round-{rnd:02d}" / "plan.json", json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print("\n".join(md))
    print(f"\n-> {path.relative_to(REPO)}")


def finished_turns(world, rnd, after=None):
    turns = world.turns(rnd)
    if after is not None:
        return after, turns
    now = datetime.now(timezone.utc)
    done = 0
    for k, first, lastt, gs in turns:
        if all(x["played"] for x in gs) or now >= lastt + GAME_LEN:
            done = k
    return done, turns


def cmd_turn(args):
    state = load_state()
    world = World(state)
    rnd = args.round or current_round(world)
    done, turns = finished_turns(world, rnd, args.after)
    if done == 0:
        sys.exit(f"Round {rnd}: no turn finished yet (T1 starts {il(turns[0][1])} IL)")
    if done >= len(turns):
        sys.exit(f"Round {rnd}: every turn is over - run review")
    squad = squad_from_state(world, state)
    lu = state["lineup"]
    current = []
    for p in squad:
        n = p["name"]
        current.append("captain" if n == lu["captain"] else "starter" if n in lu["starters"] else
                       "sixth" if n == lu["sixth"] else "bench")
    o = world.outlook(rnd)
    turn_of = [o.get(p["team"], {}).get("turn", 99) for p in squad]
    games_done = [x for k, _, _, gs in turns if k <= done for x in gs]
    roster = g.stats(100)
    real = {r["PlayerName"]: r["fpt"] for r in g.round_scores(games_done, None, roster)}
    value, shown = [], []
    for i, p in enumerate(squad):
        if turn_of[i] <= done:
            v = real.get(p["name"], 0.0)
            shown.append(f"{v:.1f} (T{turn_of[i]}, {'played' if p['name'] in real else 'DNP'})")
        else:
            v = world.exp(p, rnd)
            shown.append(f"{v:.1f} expected (T{turn_of[i]})")
        value.append(v)
    now_score = sum(ROLE_W[current[i]] * value[i] for i in range(len(squad)))
    score, S, ci, si, bench = best_roles(squad, value, turn_of, done, current)
    roles = roles_of(len(squad), S, ci, si)
    moves = []
    if roles[ci] == "captain" and current[ci] != "captain":
        moves.append(f"Armband -> **{squad[ci]['name']}**")
    for i, p in enumerate(squad):
        if current[i] != roles[i] and not (roles[i] == "captain" and current[i] == "starter"):
            if not (current[i] == "captain" and roles[i] == "starter"):
                moves.append(f"{p['name']}: {current[i]} -> {roles[i]}")
    nxt = turns[done][1]
    md = [f"# Round {rnd} · after T{done} · {state['team']['name']}", "",
          f"Next turn T{done + 1} starts **{il(nxt)} IL** - make the moves before it.", "",
          "| Player | Now | Value | Move to |", "|---|---|---|---|"]
    for i, p in enumerate(squad):
        md.append(f"| {p['name']} | {current[i]} | {shown[i]} | {roles[i] if roles[i] != current[i] else '='} |")
    md += ["", f"Round as it stands: **{num(now_score)}** (real so far + expected) -> **{num(score)}** with the moves "
           f"(+{num(score - now_score)}), coach not included.", "",
           "Moves: " + ("; ".join(moves) if moves else "none - keep the lineup."), ""]
    hits = [p["name"] for i, p in enumerate(squad) if turn_of[i] > done and world.inj.get(g.name_parts(p["name"]))]
    md.append(f"Injury report for players still to play: {', '.join(hits) or 'clear'}.")
    path = write(OUT / f"round-{rnd:02d}" / f"turn-{done}.md", "\n".join(md) + "\n")
    data = {"round": rnd, "after": done,
            "lineup": {"starters": [squad[i]["name"] for i in S], "captain": squad[ci]["name"],
                       "sixth": squad[si]["name"] if si is not None else None,
                       "bench": [squad[i]["name"] for i in bench]},
            "score_now": round(now_score, 1), "score_moves": round(score, 1), "moves": moves}
    write(OUT / f"round-{rnd:02d}" / f"turn-{done}.json", json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print("\n".join(md))
    print(f"\n-> {path.relative_to(REPO)}")


def cmd_review(args):
    state = load_state()
    world = World(state)
    rnd = args.round or world.last
    squad = squad_from_state(world, state)
    lu = state["lineup"]
    roster = g.stats(100)
    real = {r["PlayerName"]: r["fpt"] for r in g.round_scores(world.games, rnd, roster)}
    rows, total = [], 0.0
    for p in squad:
        n = p["name"]
        role = "captain" if n == lu["captain"] else "starter" if n in lu["starters"] else "sixth" if n == lu["sixth"] else "bench"
        v = real.get(n)
        pts = ROLE_W[role] * (v or 0.0)
        total += pts
        rows.append((role, n, v, pts))
    cname = state["coach"]["name"]
    coaches = world.coaches(world.next)
    c = world.coach(coaches, cname)
    cpts = world.coach_pts.get(c["team"], {}).get(rnd, 0)
    total += cpts
    old = {q["name"]: q["cr"] for q in state["squad"]}
    moves = [(p["name"], old.get(p["name"], p["cr"]), p["cr"]) for p in squad]
    value = round(sum(p["cr"] for p in squad) + c["cr"] + state.get("bank", 0.0), 1)
    hist = next((h for h in state["history"] if h["round"] == rnd), None)
    md = [f"### Round {rnd} result", "", f"**{num(total)} FPT** (official site may differ by rounding)"
          + (f" · projected {hist['projected']}" if hist else ""), "",
          "| Role | Player | FPT | Counts |", "|---|---|---|---|"]
    for role, n, v, pts in sorted(rows, key=lambda r: -RANK[r[0]]):
        md.append(f"| {role} | {n} | {'DNP' if v is None else num(v)} | {num(pts)} |")
    md.append(f"| coach | {cname} | | {cpts:+d} |")
    changed = ", ".join(f"{n} {a:.1f}->{b:.1f}" for n, a, b in moves if abs(a - b) > 1e-9)
    md += ["", f"Prices: {changed or 'unchanged (refresh the data first if the round just ended)'}",
           f"Team value now **{value}** (was {state.get('value')})", ""]
    text = "\n".join(md) + "\n"
    with LOG.open("a") as fh:
        fh.write("\n" + text)
    if hist:
        hist["actual"] = round(total, 1)
    for q in state["squad"]:
        q["cr"] = world.player(q["name"])["cr"]
    state["coach"]["cr"] = c["cr"]
    state["value"] = value
    state["round"] = rnd + 1
    save_state(state)
    print(text)


def cmd_commit(args):
    state = load_state()
    rnd = args.round or state["round"]
    folder = OUT / f"round-{rnd:02d}"
    if args.what == "plan":
        data = json.loads((folder / "plan.json").read_text())
        state["squad"] = [{**p, "since": next((q["since"] for q in state["squad"] if q["name"] == p["name"]), rnd)}
                          for p in data["squad"]]
        state["coach"] = {**data["coach"], "since": state["coach"]["since"] if state["coach"]["name"] == data["coach"]["name"] else rnd}
        state["lineup"] = data["lineup"]
        state["bank"] = data["bank"]
        state["round"] = rnd
        state["history"] = [h for h in state["history"] if h["round"] != rnd] + [
            {"round": rnd, "projected": data["projected"], "projected_no_changes": data["projected_no_changes"],
             "actual": None, "rank": None, "value_before": state.get("value")}]
    else:
        turns = sorted(folder.glob("turn-*.json"))
        if not turns:
            sys.exit(f"no turn-*.json in {folder}")
        state["lineup"] = json.loads(turns[-1].read_text())["lineup"]
    save_state(state)
    print(f"state.json <- {args.what} of Round {rnd}: captain {state['lineup']['captain']}, sixth {state['lineup']['sixth']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["status", "plan", "turn", "review", "commit"])
    ap.add_argument("what", nargs="?", choices=["plan", "turn"], help="commit: what to write into state.json")
    ap.add_argument("--round", type=int)
    ap.add_argument("--after", type=int, help="turn: the turn just finished (default: from the clock)")
    ap.add_argument("--max-trades", type=int, help="plan: trades allowed (default: state's per-round limit)")
    ap.add_argument("--unlimited", action="store_true", help="plan: treat this round as an unlimited window")
    args = ap.parse_args()
    {"status": cmd_status, "plan": cmd_plan, "turn": cmd_turn, "review": cmd_review, "commit": cmd_commit}[args.cmd](args)


if __name__ == "__main__":
    main()
