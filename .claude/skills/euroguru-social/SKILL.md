---
name: euroguru-social
description: EuroGuru's X/Twitter assistant, run on demand. Prepares the posts that fit this moment of the EuroLeague Fantasy round (previews, captain poll, game-night top 5, recaps) as branded images + text in social/, tells the user exactly what to post and when, and coaches their replies - the user pastes other people's posts and gets data-backed reply suggestions. Use when the user runs /euroguru-social, asks what to post, asks for round posts, or pastes an X post asking how to reply.
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
   - a game night finished in the last 14h → **tonight's top 5** (`social/round-XX/night-<date>/`);
   - the next round not locked yet → its **preview** (`social/round-XX/pre/`).
   It writes **`social/PLAN.md`**: every post with when to post it (local time), its image
   and the exact text of the post and of the reply carrying the link. ★ = core posts.
2. Open each new PNG with Read and check it (layout, nothing cut off, numbers plausible).
3. Brief the user, short:
   - **Post now:** the core posts due now - image path + text, ready to copy.
   - **Coming up:** the next core posts with their times (and that optional ones exist in PLAN.md).
   - **When to run again:** e.g. after tonight's games (top 5), after the round (recap).
   - How to post one: attach the image, paste the text, post; then reply to your own post
     with the reply text (the link goes in the reply - X shows link posts to fewer people).

The core set, in the order of a round: budget-picks (2 days before lock) → hot-hand (day
before) → captain-poll (~5h before lock; add the poll options in X's composer) →
game-night (after each evening) → team-of-the-round (morning after). Everything else in
PLAN.md is optional.

## How every post is written (keep new posts to this)
Researched for the #EuroLeagueFantasy niche (Oct 2026): image posts and polls draw the
most interaction, shorter posts get more replies, and opinion + question starts debate.
1. **Hook** - what EuroGuru's data found, naming EuroGuru's feature behind it (live
   tracking, the reliability score, the model, the price tracker).
2. **The data** - 3–5 compact lines; the image carries the full list. When the text runs
   long, `compose()` drops trailing lines, never the hook or the question.
3. **A punchline** where the data allows (e.g. "Diarra out-scores 14 players priced 14+ CR").
4. **A debate question** people have an opinion on (`DEBATE` in `generate.py`).
5. `#EuroLeagueFantasy #EBF` - the game's hashtag and the official account's.
The link always goes in the user's own first reply.

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
python3 $G prepare                   # everything for now + social/PLAN.md
python3 $G live                      # current fantasy leaders card (for replies)
python3 $G pre|post|night [--round N] [--date YYYY-MM-DD] [--only ids]   # one batch by hand
python3 $G banner                    # the X profile banner → social/profile/banner.png
```
Prefix with `SSL_CERT_FILE=backend/.ca-bundle.pem` on the work network.

## How posts are built
`generate.py`: each `post_<name>(ctx)` returns the card (`title`, `subtitle`, `body` via
`cols_body` / `list_body`) and the tweet parts (`hook`, `hook_he`, `lines`, or `poll` /
`thread`). `compose()` adds the one hashtag and builds the reply with a UTM-tagged link
(`utm_campaign=rNN-<post id>`, visible in Vercel Analytics). Cards: `card.html` +
`card.css`; banner: `banner.html`. To add a post type, write the builder, register it in
`PRE` / `POST` / `NIGHT`, and give it a time in `prepare()`.
