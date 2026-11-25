---
name: euroguru-coach
description: Coaches the user's EuroLeague Fantasy Challenge team (StringUtils) to win the overall ranking, round after round. Plans each round's trades (4 a round, all 11 in the unlimited windows), the lineup with a turn-by-turn captain plan, makes the between-turn subs and armband moves, enters everything on the official site in the user's Chrome, mirrors the official teams into EuroGuru's My Teams after every save, and logs every move and why in social/coach/LOG.md. Use when the user runs /euroguru-coach, pings "coach" / "your turn" / "T1 is over", or asks to plan the round, make the trades, set the captain, do the subs, or review how the team did.
---

# EuroGuru coach

I run one team on the official game, **StringUtils**
(https://euroleaguefantasy.euroleaguebasketball.net/10/fantasy/2916120/team), with full
autonomy over trades, lineup, captain and coach. The goal is **1st place overall**. The
user pings me at the times I give. Each ping I work out where we are, decide, enter the
moves in their signed-in Chrome, mirror the teams into EuroGuru, log them, and say when to
ping next.

**Hard rules**
- Never field a player who is OUT. A GTD (game-time decision) player goes to the bench
  only if a later-turn sub can still replace him.
- Every move goes in `social/coach/LOG.md` with its reason. The site is the source of
  truth: after saving, reload and check before writing the log.
- Times are Israel time (IL). Turns are game days, and EuroLeague tip-offs are Paris time
  (`generate.py` converts them).
- Don't spend a trade for nothing (`TRADE_MARGIN`).
- Never change the account's other teams (String, String6). I only read them, for the
  EuroGuru mirror.
- **After every save, mirror the teams into EuroGuru** (section below), so the app's live
  scores and Watch Rooms show the lineups that really count.
- Never click Share (the paper-plane icon). Save is the red button under the bench.

## The game (2026-27 Classic)
- **Squad:** 4 G, 4 F, 2 C and a head coach, at most 6 per club. The budget is the
  team's value, which grows as its players' prices rise.
- **Lineup:**
  - The starting five uses a G-F-C formation: 2-1-2, 1-2-2, 2-2-1, 1-3-1 or 3-1-1.
  - Captain (one of the five) ×2, the other starters and the **6th man** ×1, the other
    four on the bench ×0.5, coach ×1.
- **Scoring:**
  - Players: FPT = PIR, plus 10% when the team wins.
  - Coach: win by 1-10 +10, by 11-20 +20, by 21+ +25. Lose by 1-10 −5, by 11-20 −10,
    by 21+ −20.
- **Turns:** a round is split into game days (T1, T2, sometimes T3). Between turns you can
  sub field↔bench, change formation and move the armband, but **only to players who
  haven't played**. A starter who has played and is moved down keeps 50% (or 100% as the
  6th man).
- **Trades:** between rounds, **4 a round** (the coach counts as one).
  - **Unlimited** before R7, R14, R19, R24, R29 and R35 (windows after R6, 13, 18, 23,
    28, 34), and in the play-in, playoffs and Final Four.
- **Prices:** they move after every round with score relative to price. Cheap players
  who score rise the most, and injured expensive players fall.

## How we win (what plan/turn implement)
1. **Coach first, then captain.** They swing a round the most. The coach is chosen on the
   next 3 rounds (`HORIZON_W`), since changing him costs a trade.
2. **Spend on the six who count in full.** The bench is four cheap players who do play,
   ideally later in the round, so they can step in.
3. **Lineup by turn (the user's rule).**
   - Before a round, every T1 player is on the floor, as many as a formation allows.
     Later-turn players go on the bench, the best of them as 6th man.
   - After T1, each T1 starter who did worse than the later player who could take his
     spot drops to the bench (keeps 50%), and that player comes up. With a T3, the same
     happens again after T2.
   - The armband starts on the best T1 starter. Keep it only if his score beats the best
     later player's expected score; otherwise that player moves into the five and takes
     it. This is never worse than captaining the later player outright.
   - The catch: the between-turn moves are what make the lineup work (R14: 171.9 with
     them, 150.9 without). Never miss a turn ping.
4. **Trades on a 3-round horizon,** each round with its own win chances. Keep big
   reshuffles for the unlimited windows; just before a window, only short-term moves.
5. **Team value compounds.** Prefer under-priced regulars, such as new arrivals still at
   a low price, and sell injured stars before their price drops.
6. **Judgement the model can't see goes into `state.json` "overrides"**
   (`{fpt, until, why}`): a transfer, a return from injury, a teammate out. Write the
   reason, and let it expire.

## Setup (every command)
From the repo root, with system `python3` and no venv. It reads the prod API and the
EuroLeague feeds, like `generate.py`:
```bash
C=.claude/skills/euroguru-coach/coach.py
T=.claude/skills/euroguru-coach/teams.py
export SSL_CERT_FILE=backend/.ca-bundle.pem
python3 $C status
```
`status` shows the round, its turns with our players in each, the lock, the next round's
trade allowance and any injury report hits in our squad. Always start with it.

## Stage A: before a round (once the last round is over)
1. **Fresh data.** If prices or scores are stale, run `/euroguru-data` first (prices move
   after every round).
2. **Review the round that ended:** `python3 $C review`. It appends the score by role,
   price changes and new team value to `LOG.md`, and moves `state.json` on.
   - Read the official total and overall rank on the site and add them to the log entry.
3. **Plan:** `python3 $C plan`. It writes `round-NN/plan.md` and `plan.json`: the trades
   (≤ 4, or all in a window), the lineup, the captain plan, the between-turn rules and
   the coach outlook.
4. **Judge it.**
   - Read the plan, then check the official site's player list for injury or news icons,
     and the injury report via `status`.
   - If something the model can't see matters, add or update an override and re-run
     `plan`.
   - Before an unlimited window, look at the next 3-5 rounds, not just one.
5. **Enter it in Chrome** (steps below), save, reload, check. Save the screenshot to
   `social/coach/round-NN/saved-team.jpg`.
6. **Commit:** `python3 $C commit plan` writes the new squad and lineup into `state.json`.
7. **Mirror into EuroGuru** with tag `plan` (section below).
8. **Log** a round section in `LOG.md`, in the R14 format:
   - the squad table: role, player, position, club, CR, turn, expected
   - the trades with reasons
   - the captain plan and the between-turn rules
   - the projection
   - the EuroGuru mirror: which teams changed, any skipped
   - the next ping time
9. **Tell the user** in 3-5 lines: the moves, the captain plan, the projection, the
   EuroGuru mirror, and when to ping next (after the last T1 game, before T2's first
   tip-off).

## Stage B: between turns (after each turn's last game)
1. `python3 $C turn` reads the real FPT of the finished turn (boxscores) and the expected
   FPT of the rest, and gives the lineup that maximises the round under the
   moves-down-only rule. It writes `round-NN/turn-K.md` and `.json`.
2. Check news for the players still to play. If one is ruled out, he goes down for a
   bench player who hasn't played.
3. Enter the moves in Chrome before the next turn's first tip-off. Save, reload, check.
4. `python3 $C commit turn`.
5. **Mirror into EuroGuru** with tag `tK`, where K is the turn just finished (section
   below).
6. A short `LOG.md` line: the moves, why, the round so far, the EuroGuru mirror.
7. Tell the user the moves, the mirror, and the next ping: the next turn, or the end of
   the round.

## Chrome: the official site
- Tools: Claude in Chrome. Run `tabs_context_mcp` first, then use your own tab.
- Home is https://euroleaguefantasy.euroleaguebasketball.net/10 → StringUtils → Manage Team.
  You can go straight to `/10/fantasy/2916120/team`.
- The header shows round, turn (e.g. 1/2), "Trades Open" with a countdown, CREDITS
  (left/total) and TRADES (used/allowed).
- **Sell:** the × on the player's card. **Buy:** type the surname in "Find player" and
  click the price button. He fills an empty slot of his position.
- **Roles:** click a player to open a dialog with Captain, Substitute and Remove.
  - Captain gives him the armband.
  - Substitute highlights the players he can swap with; click one.
  - The first slot under the court is the 6th man, then the bench.
- **Formation:** the box under CAP shows it ("212", "221"). Click it to open Choose the
  formation, pick one, then Choose.
  - A starter can only be swapped with a player of his position, so change the formation
    first when a swap crosses positions (e.g. a C out, an F in: 2-1-2 to 2-2-1).
  - The site re-seats players when the formation changes, so check the five afterwards.
  - Mid-round it disables formations that would need a bench player who has already
    played to start.
- **The 6th man slot takes any position.** A bench player swaps with the 6th man whatever
  their positions (R14: C Kamenjas for F Davidovac).
- **Cards show weighted points:** the captain's is doubled (Hifi 35.2 = 17.6 FPT × 2), and
  a played starter moved to the bench shows half. Use the FPT from `turn`, not the cards.
- **Save:** scroll down to the red **Save**, then **Save team**. "YOU DID NOT SAVE" at the
  top means unsaved changes.
- **Check:** reload the page and confirm the credits, the lineup and the C badge.
  Screenshot with `save_to_disk`.

## Mirror into EuroGuru (after every save)
EuroGuru's My Teams keep copies of the official teams. The app's live scores, Watch Rooms
and look-backs read those copies, so they have to match what counts. `social/coach/teams.json`
(gitignored) maps each copy to its official team:

| EuroGuru team | Account | Copy of | Read from |
|---|---|---|---|
| StringUtils | personal | StringUtils | `state.json`, so `commit` first |
| String | personal | String | the site |
| String6 | personal | String6 | the site |
| EuroGuru | the EuroGuru account | String | the site |

`TAG` is `plan` before a round, or `t1`, `t2` after that turn. The files go in
`round-NN/teams/`.

1. **Read String and String6** on the site. Their Manage Team URLs are in `teams.json`.
   - **View only:** never click a player, Save or anything else on these two teams.
   - One screenshot shows:
     - the five: C at the top, F in the middle, G at the bottom; the **C** badge marks
       the captain
     - the **6TH** slot
     - the **BENCH** (4)
     - the **HC** card (coach)
   - Zoom on any name or badge you can't read.
   - Write `<TAG>-official.json` in this shape:
     ```json
     {"teams": [{"team": "String", "starters": ["M. Wright", "Vezenkov", "Malcolm", "Hifi", "Maledon"],
      "captain": "Vezenkov", "sixth": "Kamenjas",
      "bench": ["Carter", "Jackson", "Wilbekin", "Papanikolaou"], "coach": "Navarro"}]}
     ```
   - A player already in the EuroGuru copy needs only his surname, with the initial when
     two share it. A new one, after trades, needs his jersey's club code: `"Shorts VBC"`.
2. **Back up.** Run `python3 $T select-sql`, then run that SQL with the Supabase MCP
   `execute_sql` (project in `teams.json`). Save the rows as `<TAG>-before.json`.
3. **Build:** `python3 $T build --round N --tag TAG`.
   - It checks each official lineup (10 players, 4-4-2, a legal five, a captain who
     starts) and prints the role changes for each team.
   - If a check fails, the lineup was misread: re-read that team.
   - While a round is on, EuroGuru takes only subs and the armband, and nobody who has
     played moves up. A team that would break this is **SKIPPED** with the reason, usually
     because its copy wasn't updated before the lock. Sync it after the round ends and tell
     the user.
4. **Write.** Run `<TAG>-update.sql` with `execute_sql`.
   - Every row must come back `synced = true`.
   - Mid-round, `round_row_matches` must also be true. That is the copy the round is
     scored from.
5. **Check in the app.** Open https://eurogurufantasy.com → My Teams; the personal account
   is signed in. Each team's "Round N · so far" must equal its official FPT.
   - The EuroGuru account's team can't be opened from that login, so its `synced` row is
     the check.

**Undo:** run the SQL that `python3 $T restore-sql --round N --tag TAG` prints. Mid-round
the database still refuses moving up a player who has played, so an undo can then be
partial.

## Commands
```bash
python3 $C status
python3 $C plan [--round N] [--max-trades K] [--unlimited]
python3 $C turn [--round N] [--after K]      # K = the turn just finished (default: from the clock)
python3 $C review [--round N]
python3 $C commit plan|turn [--round N]
python3 $T select-sql                         # EuroGuru mirror: the backup
python3 $T build --round N --tag plan|t1|t2   # official lineups -> checked update SQL + report
python3 $T restore-sql --round N --tag TAG    # the undo
```
The constants are at the top of `coach.py`: `HORIZON_W`, `TRADE_MARGIN`, `MIN_GAMES`,
`MIN_AVAIL`, `SIGMA` and `SIMS`.
