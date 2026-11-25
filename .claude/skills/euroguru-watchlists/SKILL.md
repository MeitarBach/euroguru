---
name: euroguru-watchlists
description: Syncs the user's EuroGuru Live-tab watchlists with their fantasy league (E&Tz 4 Ever). Reads the current lineup of String and the league's top 6 teams on the official EuroLeague Fantasy site in the user's Chrome (players, captain, 6th man, bench, coach), writes them into the matching watchlists on their EuroGuru account, and reports who changed, the shared players, the captains and coaches, and where String differs from each rival. Use when the user runs /euroguru-watchlists, asks to update or sync the watchlists, to pull the league's teams or rivals' lineups into EuroGuru, or to go over the top teams in the league.
---

# EuroGuru watchlists

The Live tab's watchlists follow the user's own team **String** and the league's top teams.
Each one is a team's exact lineup: 10 players, captain, 6th man, bench and coach. Every
round the rivals trade, so the lists go stale. This skill reads the lineups off the
official site and writes them into the user's EuroGuru account.

**Hard rules**
- **The fantasy site is read-only here.** Only open other teams' profiles: no saves, no
  trades, no lineup changes. Team management is `/euroguru-coach`'s job, for StringUtils.
- **Only the watchlists named in `league.json` change.** Every other one (e.g.
  "Potential") is left exactly as it is.
- **Back up before writing** (`round-NN/before.json`). `restore-sql` is the undo.
- **Ask the user before going further** when a team in the top 6 has no watchlist, or a
  watchlist's team is no longer in the top 6. Ask: follow it? create one? drop one? Never
  guess who's who.
- **Real people's names live only in `social/watchlists/`, which is gitignored.** Never
  write them into this skill or anywhere tracked.

## When
- **After the round locks**, at its first tip-off. Before that, other teams' lineups for
  the round aren't shown.
- **Again after a turn,** to catch the subs and armband moves rivals make between game
  days. Same steps; the rosters file is simply re-read.

## Files (`social/watchlists/`, gitignored)
- `league.json`:
  - the league URL and `matchday_offset` (matchday id = offset + round; R14 = 1541)
  - the Supabase project and the account's `settings_user_id`
  - `teams`: watchlist ↔ fantasy team ↔ manager. This mapping is the source of truth.
- `round-NN/rosters.json` is what you read off the site:
  ```json
  {"round": 14, "teams": [
    {"watchlist": "<watchlist name>", "team": "<fantasy team name>",
     "starters": ["Balcerowski BAR", "Jeffries BJK", "Baldwin MTA", "Horton-Tucker FBT", "Wilbekin BJK"],
     "captain": "Horton-Tucker FBT", "sixth": "Maledon RMB",
     "bench": ["Bacon DUB", "Kamenjas KBA", "Vezenkov OLY", "Abalde RMB"], "coach": "Navarro CZV"}]}
  ```
  - Players are written `Surname CLUB`, with the club code as printed on the site's jersey.
  - When a surname is shared, add the initial: `M. Wright MIL`.
- `round-NN/before.json` is the backup; `after.json` and `update.sql` come from `build`.

## Steps
Setup, from the repo root:
```bash
W=.claude/skills/euroguru-watchlists/watchlists.py
export SSL_CERT_FILE=backend/.ca-bundle.pem
```

1. **Pick the browser.**
   - Use Claude in Chrome: `tabs_context_mcp` first, then work in your own tab.
   - It must be the profile where the fantasy site shows the user signed in (top left)
     and EuroGuru's sidebar shows their personal account signed in.
   - If several browsers are connected and the one in use isn't that profile, follow
     `list_connected_browsers` and ask the user which one.
2. **Read the standings.**
   - Open `league.url + "?matchday=" + (offset + last finished round)`. The current
     round's page stays empty until it has results.
   - The list is ordered by that **round's** score. Rank the teams by the big **total**
     number yourself.
   - Follow String plus the top 6 by total (String counts if it is in them).
   - Check the result against `league.json` (see hard rules).
3. **Read each lineup.** The site is a Flutter canvas, so there is no page text; read it
   from screenshots.
   - Click the team's row to open its Profile. It shows the current round (the round
     strip has it selected).
   - Scroll down 10 ticks. One screenshot then shows:
     - the starting five: C at the top, F in the middle, G at the bottom; the **C**
       badge marks the captain
     - the **6TH** slot
     - the **BENCH** (4)
     - the **HC** card (coach)
   - Zoom on any name you can't read.
   - The back arrow (top left) returns to the standings, which keep their scroll
     position. Take a fresh screenshot before clicking the next row, because the rows
     move (a stale click once opened the wrong team).
4. **Write `round-NN/rosters.json`** with every team you read.
5. **Back up.** Run `python3 $W select-sql`, then run that SQL with the Supabase MCP
   `execute_sql` (project in `league.json`). Save the `groups` array as
   `round-NN/before.json`.
6. **Build:** `python3 $W build --round N`.
   - It turns names into EuroGuru keys from the prod API and checks every team: 10
     different players, 4G-4F-2C, a legal five, the captain a starter.
   - Then it writes `after.json` and `update.sql` and prints the report.
   - If it complains, re-read that lineup on the site; don't force it.
7. **Write.** Run `round-NN/update.sql` with `execute_sql`. The returned summary should
   list every followed watchlist with 10 players and the others unchanged.
8. **Verify in EuroGuru.**
   - Open Live, go to "Round N · Watchlists", and open one watchlist. Its starters,
     captain (C), 6th man, bench and coach must match the site.
   - "My team"'s live total should equal String's in My teams.
9. **Report** in a short table: watchlist, team, captain, 6th man, coach, changes. Then
   the shared players, the captains and coaches, and the biggest differences between
   String and the rivals, all from the build output.
   - Mention that any other EuroGuru tab picks the new lists up when it's focused
     (`lib/prefs.js` pulls on sign-in and focus), so the user shouldn't edit a watchlist
     in a stale tab.
   - Close your tab.

**Undo:** run the SQL that `python3 $W restore-sql --round N` prints.

## Why the database, not the UI
- The watchlists are `user_settings.settings.liveGroups`, which the app keeps in step
  with localStorage (`frontend/src/lib/prefs.js`, `frontend/src/hooks/useWatchGroups.js`).
- Re-entering about 60 players and their roles through the picker is 200+ clicks. One
  checked write of the whole list, with a backup, is faster and exact.
- It only replaces each followed watchlist's `keys`, `bench`, `captain` and `coach`. The
  `id`, `name` and `color` stay, so the colors and any shared links are kept.
