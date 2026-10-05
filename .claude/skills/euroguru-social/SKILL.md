---
name: euroguru-social
description: Generate EuroGuru's round-by-round Twitter/X posts - tweet text plus a branded 1200x675 image for each - before a fantasy round (preview) or after one (recap). Use when the user asks for pre-round / post-round / round preview / round recap posts, social or Twitter content, or runs /euroguru-social pre|post [round].
---

# EuroGuru social posts

Produces a fixed, repeatable set of posts for every EuroLeague Fantasy round, so the
account has the same structure every week. Each post is a tweet (`<id>.txt`) and a
branded image (`<id>.png`) in `social/round-XX/{pre,post}/` at the repo root, plus a
`README.md` listing the run. `social/` is git-ignored.

**Never post anything yourself.** Generate, check, and hand the posts to the user.

## Run it

From the repo root:

```bash
# On the work network (Cloudflare WARP) Python needs the proxy's root certificate.
# backend/.ca-bundle.pem is built by run_euroguru.sh; build it the same way if missing.
export SSL_CERT_FILE="$PWD/backend/.ca-bundle.pem"

python3 .claude/skills/euroguru-social/generate.py pre              # preview of the next round
python3 .claude/skills/euroguru-social/generate.py post             # recap of the last finished round
python3 .claude/skills/euroguru-social/generate.py post --round 3   # a specific round
python3 .claude/skills/euroguru-social/generate.py pre --only hot-hand,budget-picks
```

Standard library only; images render with the installed Google Chrome (headless).
Pre-round posts read the public EuroGuru API (`https://euroguru-api.vercel.app/api`),
so they reflect the last promoted data. Post-round posts read Euroleague's boxscores
directly and score them exactly as the fantasy game does (PIR, plus 10% of |PIR| for the
winning team), so they need no fetch.

## When to run
- **pre**: after the previous round's data has been fetched and promoted, before the
  next round tips off.
- **post**: once the round's last game is final. `price-movers` also needs the round's
  CR snapshot - run the fetch and `promote.py` first, or it is skipped with a note.

## After generating - always
1. Read the script output: every post prints `id (length/280)`. Lengths use X's rule
   (links count 23, emoji 2). Shorten any post flagged over 280 by editing its builder.
2. Open each PNG with the Read tool and check the layout: nothing overlapping the footer,
   names not truncated, numbers plausible.
3. Spot-check the numbers against the app (e.g. top performers against a player's game
   log via `/api/player?name=...&season=2026`).
4. Show the user each post: the image path and the tweet text, ready to copy. Mention
   any skipped post and why (see the Notes section of the run's README).

## The catalogue

Pre-round (badge "Round N · Preview"):
| id | What it shows | Layout |
|---|---|---|
| `consistent-by-position` | Best healthy G/F/C by reliable floor (avg − 2×SD), 2+ games | columns |
| `hot-hand` | Top 5 by average FPT over the last 3 games | list |
| `budget-picks` | Top 5 healthy players at ≤10 CR by last-5 average | list |
| `value-kings` | Best FPT per CR at each position | columns |
| `smart-picks` | Top 5 from the Recommendations ranking | list |
| `injury-watch` | Highest-priced players on the injury report (OUT/GTD) | list |

Post-round (badge "Round N · Recap"):
| id | What it shows | Layout |
|---|---|---|
| `round-top-performers` | Top 5 FPT of the round with stat lines | list |
| `team-of-the-round` | Best 2 G · 2 F · 1 C, top scorer as captain ×2, total | list |
| `round-bargains` | Most FPT per CR among ≤10 CR players | list |
| `price-movers` | 3 biggest CR risers and 2 fallers after the round | list |

Every tweet has the same shape: a hook line with the round and an emoji, 3–5 compact
player lines, `Full stats & live scores 👉 https://eurogurufantasy.com`, and
`#EuroLeagueFantasy #EuroLeague`.

## Files
- `generate.py`: data, tweet text and rendering. Each post is one `post_*` function
  returning `{title, subtitle, body, text}` (or `None` to skip), registered in `PRE` or
  `POST`.
- `card.html`, `card.css`: the image - dark background, purple glow, half-court lines,
  the EuroGuru mascot (`frontend/public/guru-mark.png`), a round badge, and a footer with
  eurogurufantasy.com. Two body layouts: `cols_body` (three position columns) and
  `list_body` (ranked rows).

## Adding a post type
Write a `post_<name>(ctx)` in `generate.py` using `cols_body` or `list_body` for the
image and `tweet(...)` for the text (end with `LINK_LINE` and `TAGS`), then add
`("<id>", post_<name>)` to `PRE` or `POST`. `ctx` holds `round`, `season` (season
averages), and for pre `last3`, `last5`, `inj`; for post `scores` (each priced player's
round FPT with pts/reb/ast and opponent).
