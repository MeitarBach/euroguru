---
name: euroguru-social
description: EuroGuru's X/Twitter assistant, run on demand. Prepares the posts that fit this moment of the EuroLeague Fantasy round (previews, captain poll, game-night top 3, recaps) as branded images - player cards with headshots - + text in social/, tells the user exactly what to post and when, and coaches their replies - the user pastes other people's posts and gets data-backed reply suggestions. Use when the user runs /euroguru-social, asks what to post, asks for round posts, or pastes an X post asking how to reply.
---

# EuroGuru social

The user posts and replies **by hand** on @EuroGuruFantasy. This skill never posts.
Its job: have everything ready, say what to do in what order, and help with replies.

## When triggered: prepare and brief

1. Run (from the repo root; the cert is needed on the work network):
   ```bash
   SSL_CERT_FILE=backend/.ca-bundle.pem python3 .claude/skills/euroguru-social/generate.py prepare
   ```
   It reads the schedule and generates whatever fits **now**:
   - a round finished in the last 36h → its **recap** (`social/round-XX/post/`, plus `reddit.md`);
   - a game night finished in the last 14h → **tonight's top 3** (`social/round-XX/night-<date>/`);
   - the next round not locked yet → its **preview** (`social/round-XX/pre/`).

   Every post gets its **own folder** (`social/round-XX/<batch>/<post id>/`) with `post.md`
   (when to post it, the text, the reply carrying the link, poll options or thread parts,
   then the Hebrew version) and its image `<post id>.png`. Each batch has a `POSTS.md` too.
   It writes **`social/POSTS.md`**: every post that fits now, in posting order (local
   time), with a table up top, the image inline and the English text ready to copy - the
   menu the user picks from. ★ = core posts. All of it is markdown; there is no JSON.
2. Open each new PNG with Read and check it (layout, nothing cut off, numbers plausible,
   every player has their photo - an initials circle means the name did not match).
3. Brief the user, short:
   - **Post now:** the core posts due now - image path + text, ready to copy.
   - **Coming up:** the next core posts with their times (and that optional ones are in `social/POSTS.md`).
   - **When to run again:** e.g. after tonight's games (top 3), after the round (recap).
   - How to post one: attach the image, paste the text, post; then reply to your own post
     with the reply text (the link goes in the reply - X shows link posts to fewer people).

The core set, in the order of a round: budget-picks (2 days before lock) → hot-hand (day
before) → captain-poll (~5h before lock; add the poll options in X's composer) →
game-night (after each evening) → team-of-the-round (morning after). Everything else in
POSTS.md is optional.

## How every post is written (keep new posts to this)
Researched for the #EuroLeagueFantasy niche (Oct 2026): image posts and polls draw the
most interaction, shorter posts get more replies, and opinion + question starts debate.
1. **Hook** - what EuroGuru's data found, naming EuroGuru's feature behind it (live
   tracking, the reliability score, the model, the price tracker).
2. **The data** - one compact line per player, the same players as the image. When the
   text runs long, `compose()` drops trailing lines, never the hook or the question.
3. **A punchline** where the data allows (e.g. "Diarra out-scores 14 players priced 14+ CR").
4. **A debate question** people have an opinion on (`DEBATE` in `generate.py`).
5. `#EuroLeagueFantasy #EBF` - the game's hashtag and the official account's.
The link always goes in the user's own first reply.

## Images: player cards with headshots
Every image about players shows them: one card per player with their official headshot,
the key number big in the corner and the details underneath (`photo_body()`).
- **At most 3 players per image** (`MAX_PLAYERS`) - three big faces read better in the feed
  than a crowded list. Pick the 3 most interesting; the text names the same 3. The one
  exception is team of the round, a lineup of 5 by definition: `photo_body` switches to
  compact cards on its own when given more than 3.
- **Photos** are the official EuroLeague player photos, from the season rosters
  (`PEOPLE_URL`), matched by club + name like the boxscores and downloaded once to
  `social/.headshots/` (gitignored). No match → an initials circle, and the run prints
  `! no headshot for <name> (<club>)`.
- **One-off posts** (a hand-made post, a card for a reply) use the same cards:
  ```python
  import sys; sys.path.insert(0, ".claude/skills/euroguru-social"); import generate as g
  from pathlib import Path
  card = {"title": "Tonight's softest matchups", "subtitle": "FPT allowed per 36 min vs the league",
          "body": g.photo_body([{"pos": "C", "name": "A. Diarra", "team": "VIR",
                                  "line": "Virtus vs Baskonia", "big": "+34%", "unit": "vs avg",
                                  "tone": "up", "meta": ["<b>#1</b> vs centers", g.cr_meta(9.0)]}])}
  g.render(card, "Round 6 · Tonight", Path("social/round-06/<folder>/<post id>.png"))
  ```
  `team` is the Euroleague club code (it finds the photo); `meta` items are HTML, so wrap
  numbers in `<b>`; `tone` is `up` (green) / `down` (red); `tag` = `("c", "C")` marks a captain.

## Coaching the comment section on the user's own posts
Debate posts only grow if the debate gets answered - the first hour matters most. When the
user pastes comments from their post, suggest a short reply to each: agree or push back
with **one number** from the API, ask a follow-up question, keep it friendly and
in the commenter's language. Never argue; reward every comment with an answer.

## Reply coaching (the user pastes posts)

Replies under bigger accounts are the main way this account grows. When the user pastes a
post (text, link or screenshot) and asks how to answer:

1. **Get the numbers** the post is about - never invent them:
   - a game on now / tonight: `generate.py live` (writes a card of current fantasy leaders
     in `social/round-XX/live-*/` and prints their FPT), or the game's boxscore
     (`https://live.euroleague.net/api/Boxscore?gamecode=N&seasoncode=E2026`; FPT = PIR,
     plus 10% of |PIR| for a winning team once the game is final);
   - a player's season: `POST https://euroguru-api.vercel.app/api/stats` with
     `{"season":"2026","position":"All","min_cr":0,"max_cr":100,"last_x_games":100}` (or 3/5
     for form), or `GET /api/player?name=<name>&season=2026` for the game log;
   - prices: `GET /api/cr-history?season=2026`.
2. **Suggest 2–3 replies**, each ready to paste:
   - one line, under ~200 characters, **one concrete fantasy number** (FPT, value per CR,
     price change, rank) that adds something the post did not say;
   - one of them ends with a short question to start a conversation;
   - in the post's language (Hebrew post → Hebrew reply);
   - no links, no hashtags, no "check out my site" - the profile does that;
   - match the tone: celebratory for a big night, dry for analysis, light for banter.
3. Say whether to **attach an image** (the live card, or the matching card from this
   round's folder) and give its path.
4. Remind briefly when it matters: reply within minutes of the original post; answer
   everyone who replies back.

## Commands
```bash
G=.claude/skills/euroguru-social/generate.py
python3 $G prepare                   # everything for now + social/POSTS.md
python3 $G live                      # current fantasy leaders card (for replies)
python3 $G pre|post|night [--round N] [--date YYYY-MM-DD] [--only ids]   # one batch by hand
python3 $G banner                    # the X profile banner → social/profile/banner.png
```
Prefix with `SSL_CERT_FILE=backend/.ca-bundle.pem` on the work network.

## How posts are built
`generate.py`: each `post_<name>(ctx)` returns the card (`title`, `subtitle`, `body` via
`photo_body`) and the tweet parts (`hook`, `hook_he`, `lines`, or `poll` /
`thread`). `write_post_md()` / `write_batch_index()` / `write_plan()` write the
markdown. `compose()` adds the one hashtag and builds the reply with a UTM-tagged link
(`utm_campaign=rNN-<post id>`, visible in Vercel Analytics). Cards: `card.html` +
`card.css`; banner: `banner.html`. To add a post type, write the builder, register it in
`PRE` / `POST` / `NIGHT`, and give it a time in `prepare()`.
