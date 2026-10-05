---
name: euroguru-social
description: EuroGuru's Twitter/X content engine - generates, schedules and publishes round-by-round posts (previews, captain poll, game nights, recaps, a "what we learned" thread, live cards for replies) with branded images, in English and Hebrew. Use when the user asks for round preview / recap posts, social or Twitter content, live reply cards, the posting calendar, approving or publishing posts, or runs /euroguru-social.
---

# EuroGuru social

The full growth routine lives in `docs/growth/PLAYBOOK.md`; this skill is the machinery.

## Pieces
- `generate.py`: builds posts. `python3 generate.py pre|post|night|live [--round N] [--date YYYY-MM-DD] [--only ids]`.
  Each post is `<id>.json` (tweets in `en` and `he`: `main` + `reply`, or a `poll`, or a
  `thread`), `<id>.png` (1200x675 card) and a `README.md`, in `social/round-XX/<batch>/`.
  A recap batch also writes `reddit.md`.
- `xpost.py`: publishes a post through the X API (OAuth 1.0a, standard library).
  `selftest`, `whoami`, `publish <json> [--lang en|he] [--yes]`.
- `social.py`: the calendar. `status`, `tick` (what launchd runs every 30 min), `next`
  (guided manual posting: opens X's composer with the text, image on the clipboard, then
  the reply with the link), `live` (reply card → clipboard), `profile` (X banner),
  `approve` (API posting), `install` / `uninstall` (the launchd job).
- `card.html` / `card.css` / `banner.html`: the look (dark, purple glow, court lines,
  mascot, eurogurufantasy.com footer).

## Rules every post follows
- The **main tweet has no link** (X shows link posts to far fewer people) and one hashtag,
  `#EuroLeagueFantasy`. The **link goes in the first reply**, with UTM tags
  (`utm_source=x|x-he`, `utm_campaign=rNN-<post id>`), so Vercel Analytics shows which
  post types bring visitors.
- Polls carry no image (X does not allow both). Threads carry the image on the first post
  and the link on the last.
- **The user posts by hand** (X's API needs paid credits). `tick` only prepares posts and
  notifies; the user publishes with `social.py next`. API posting happens only if they set
  `SOCIAL_AUTOPOST=1` in `backend/.env` after buying credits. Never post on their behalf.
- By default only the **core** posts are scheduled (`CORE` in `social.py`: budget-picks,
  hot-hand, captain-poll, game-night, team-of-the-round); `SOCIAL_LEVEL=full` adds the rest.

## The calendar (per round; T = first tip-off, Europe/Paris)
| Slot | Posts |
|---|---|
| T−48h | consistent-by-position, budget-picks |
| T−26h | hot-hand, value-kings |
| T−8h / −6h / −5h | injury-watch, smart-picks, captain-poll |
| each game day, last tip-off + 2.5h | game-night |
| next morning 09:00 | round-top-performers, team-of-the-round |
| 13:00 / 18:00 | round-thread, round-bargains |
| day after, 12:00 | price-movers (waits for the round's CR snapshot) |

Previews never go out after lock; late recaps up to 3 days, game nights up to 14h.
State is in `social/state.json` (nothing is posted twice); the log is `social/social.log`.

## When asked to generate or check posts
1. On the work network: `export SSL_CERT_FILE="$PWD/backend/.ca-bundle.pem"`.
2. Run the generator (or `social.py status` / `tick`), then open each PNG with Read and check
   the layout and numbers; every tweet's X length (links 23, emoji 2) is printed and must
   be ≤280.
3. Show the user each post's image path and text. Mention skipped posts and why.

## Adding a post type or language
- Post: a `post_<name>(ctx)` in `generate.py` returning `title, subtitle, body` (via
  `cols_body` / `list_body`) plus `hook`, `hook_he`, `lines` (or `poll` / `thread` +
  `thread_he`); register it in `PRE`, `POST`, `NIGHT` or `LIVE`, and give it a slot in
  `social.py` if it should be scheduled.
- Language: add a `hook_<lang>` / `thread_<lang>` per builder, a `REPLY[lang]`, extend the
  loop in `compose()`, and `credentials()` in `xpost.py` for that account's keys.
