---
name: euroguru-data
description: EuroGuru's after-game-day data run, on demand. Fetches the latest EuroLeague games into the dev bucket, verifies them (against the official boxscores, the schedule and the FPT rule), checks the local app shows them, then promotes dev to prod once the user says yes. Use when the user runs /euroguru-data, or asks to fetch / update / refresh the data, check the new games landed, or promote to prod.
---

# EuroGuru data run

Run the morning after a game night. Four stages: **fetch → check the data → check the
app → promote (after a yes)**. Stop at the first failure and report it - never promote
data that did not pass.

## Environment (every command)
From `backend/`:
```bash
source venv/bin/activate
export AWS_CA_BUNDLE=$PWD/.ca-bundle.pem REQUESTS_CA_BUNDLE=$PWD/.ca-bundle.pem SSL_CERT_FILE=$PWD/.ca-bundle.pem
V=../.claude/skills/euroguru-data/verify.py
```
The CA bundle is needed on the work network (Cloudflare WARP); if `.ca-bundle.pem` is
missing, `./run_euroguru.sh` builds it. `backend/.env` must point `BUCKET_NAME` at the dev
bucket - `run_dev_fetch.py` refuses to write to prod anyway.

## 1. Fetch
```bash
python $V snapshot          # remember what dev holds now
python run_dev_fetch.py     # ~1 minute; writes to the dev bucket
```
Reading the fetch output:
- `Error for gameCode=N: Expecting value` for ~5 games in a row, then "Reached 5
  consecutive failures" - **normal**: those games are not played yet.
- `Error updating …` / `Error fetching …` in a section - a **real failure**. Stop, show it.

## 2. Check the data
```bash
python $V check
```
A PASS/WARN/FAIL table:
- **stats/fantasy rows** - no file shrank;
- **boxscore N** - every new game, player by player, equals the official boxscore;
- **schedule** - every played game is stored (WARN = played but not fetched yet, e.g. a
  game that finished after the fetch; re-run later);
- **FPT round N** - FPT = PIR for losers, PIR + 10% of |PIR| for winners, and as many
  teams have the bonus as games were played;
- **dvp** - the Matchups rollup (`defense_vs_position_<season>.csv`) was rebuilt: it covers
  every stored round, and every game has both sides (a FAIL means a broken opponent join);
- **coaches** - the CR fetch wrote `coaches_<season>.csv`: one head coach per club, each
  mapped to a Euroleague code (the Live tab scores a coach on that club's margin);
- **app loads** - `promote.py`'s own check that every season loads.

Any FAIL → stop, explain, do not promote. Note `TOP_SCORER` / `TOP_ROUND` and the top 5.

## 3. Check the app
1. Start the servers as background tasks unless ports 8000/5173 already listen
   (`lsof -iTCP:8000 -iTCP:5173 -sTCP:LISTEN`):
   - backend: `uvicorn main:app --reload --port 8000` (from `backend/`, with the environment);
   - frontend: `npm run dev` (from `frontend/`).
2. `python $V check --local-api` - the local API must serve `TOP_ROUND` for `TOP_SCORER`.
3. In Claude in Chrome (new tab): open http://localhost:5173, find `TOP_SCORER` (Players
   search) and open their page. Confirm the game log shows round `TOP_ROUND` with the same
   FPT as the check printed. Then open the **Matchups** tab: it should show the current
   round, and the round's played games as Final with actual numbers. Take a screenshot;
   give the user the URL to look themselves.
4. Stop the servers after promoting unless the user wants to keep browsing (background
   tasks die after 2 hours anyway).

## 4. Promote - only after the user says yes
```bash
python promote.py --plan    # its checks + the files it would copy
```
Show the file list and ask: **"Promote these N files to prod?"** Wait for an explicit yes
in chat (a yes from an earlier run does not count). Then:
```bash
python promote.py --yes
```
- `BLOCKED` (dev smaller than prod) or failed checks: stop and explain. Never add
  `--allow-shrink` or `--skip-checks` unless the user asks for it.
- "prod is already up to date" is a fine outcome - nothing to copy.

## 5. Confirm prod and wrap up
`GET https://euroguru-api.vercel.app/api/player?name=<TOP_SCORER>&season=2026` must list
`TOP_ROUND` (retry once after a minute if not). Then a short summary: games added, rounds,
anything WARN, prod updated yes/no - and suggest `/euroguru-social` for the night's posts
(the first 3 of the top 5 above are what its game-night card shows).
