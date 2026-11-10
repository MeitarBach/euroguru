---
name: euroguru-social
description: EuroGuru's X/Twitter assistant, run on demand. Prepares the posts that fit this moment of the EuroLeague Fantasy round (previews, captain poll, game-night top 3, recaps) as branded images - player cards with headshots - + text in social/, plus 3-4 original out-of-the-box posts every run (a fresh format and a big-photo visual each, invented from the data), draws team builds (the best squad for a budget, on a court), tells the user exactly what to post and when, and coaches their replies - the user pastes other people's posts and gets data-backed reply suggestions. Use when the user runs /euroguru-social, asks what to post, asks for round posts, asks for a team / wildcard build, or pastes an X post asking how to reply.
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
   It ends with a line per batch: `✦ round-09/pre: no originals yet` (or `originals in ORIGINALS.md`).
2. Open each new PNG with Read and check it (layout, nothing cut off, numbers plausible,
   every player has their photo - an initials circle means the name did not match).
   If a core post is due now, give it to the user first in one short message - the
   originals take a while.
3. **Originals (✦)** - make 3-4 for the run, across the batches with none yet, by
   [originals.md](originals.md) (the section below is the short version). A batch that
   already has `ORIGINALS.md` keeps its originals: list them again, make new ones only
   when the user asks.
4. Brief the user, short:
   - **Post now:** the core posts due now - image path + text, ready to copy.
   - **✦ Originals:** a compact table - time, title, format, image path (the texts are in
     `social/POSTS.md` and each `post.md`) - and the ideas not made ("say make #6").
   - **Coming up:** the next core posts with their times (and that optional ones are in `social/POSTS.md`).
   - **When to run again:** e.g. after tonight's games (top 3), after the round (recap).
   - How to post one: attach the image, paste the text, post; then reply to your own post
     with the reply text (the link goes in the reply - X shows link posts to fewer people).

The core set, in the order of a round: budget-picks (2 days before lock) → hot-hand (day
before) → captain-poll (~5h before lock; add the poll options in X's composer) →
game-night (after each evening) → team-of-the-round (morning after). Everything else in
POSTS.md is optional.

## Originals (✦): 3-4 out-of-the-box posts every run
The catalogue repeats its shapes every round; originals don't. Each is **one surprising,
true fact** + **a familiar format** that makes it instant (a weather app, a receipt, a
dating profile, a would-you-rather - the genre, never a real brand) + **1-3 big faces** +
**one question** people have an opinion on. Round 8's five set the bar
(`social/round-08/pre/`). The full brief - ways to find ideas, the idea bank, the visual
checklist, timing, a `make.py` skeleton - is [originals.md](originals.md). In short:
1. `originals.py facts social/round-XX/<batch>` - freezes the batch's data (`.data.json`)
   and prints the stories sheet; `originals.py history` - the formats already used.
2. Brainstorm 8+ "fact → format → question" one-liners, then pick 3-4: at least 2 formats
   `history` doesn't have, none from the last 2 rounds, different moods (playful,
   analytical, a decision now, a story), timely for the batch. Never an injured player as
   a pick, nothing mocking an injury, no politics or betting.
3. Write `social/round-XX/<batch>/make.py` with the toolkit (`import originals as o`:
   photos placed by the head, the brand chrome, render, `build`), run it, open every PNG.
4. Every number from the snapshot; superlatives checked with `o.rank` ("(5+ games)" when
   needed); EN and HE ≤275 characters. `build` writes each post.md (the numbers behind
   it, replies for the comments, Hebrew), the batch's `ORIGINALS.md` and its ✦ block in
   `social/POSTS.md`, and warns on mismatched numbers or a >5 MB image.
5. Times: the strongest one the evening before the lock (20:00-22:00, no games on), others
   lock-day morning, after the games, or the morning after - 2h+ from any other post.

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
  `! no headshot for <name> (<club>)`. An earlier season's photo - him in that season's
  jersey - is `headshot(name, club_then, season="2025")`, kept in `social/.headshots/E2025/`.
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

## Team card: a whole squad on a court
For "drop your teams" / wildcard / "what's your rebuild" threads: the best squad for a
budget, drawn like a fantasy app - the starting five on a half court, the sixth man, bench
and coach underneath (`court.html`, 1200x1350, same look as the post cards).
```bash
python3 $G team --budget 105 --badge "Round 7 · Wildcard"
python3 $G team --budget 105 --core 3-2-2 --core-min 15     # best coach, best captain, then 3 G 2 F 2 C at 15+
python3 $G team --budget 105 --with Vezenkov --min-c 16 --star-g 5   # him + a top-5-priced guard; centers 16+
python3 $G team --budget 110 --with "Vezenkov,Diarra,Zizic"   # a shared surname: "D. Hall (MIL)"
python3 $G team --budget 105 --value expected                 # backtested valuation (or form)
python3 $G team --budget 105 --with Vezenkov --replay 6       # + the same squad on Round 6's real scores
python3 $G team --budget 101 --without Lessort,Ndiaye --min-c 15   # leave out injury doubts the report doesn't have yet
```
`--replay N` adds `<slug>-rN.png`: the squad and roles unchanged, each player on his real
Round N FPT (DNP if he sat), the coach on his Round N result, the total in the title. Its
own section in `team.md` has the sum line by line and reply text. Use it to back a "200+"
claim with a real round; it is a look back, since the squad was picked on games that
include that round.
Writes `social/teams/<slug>/`: `<slug>.png` and `team.md` (the squad table, the replay,
reply text in English and Hebrew - Greek or other languages you write yourself).
- **The rules it scores by** (Dunkest's Classic mode): 4 G · 4 F · 2 C + coach; the starting
  five in a 2-2-1 / 1-2-2 / 2-1-2 / 1-3-1 / 3-1-1 formation at 100% with the captain doubled,
  the sixth man and the coach at 100%, the other four at 50%; at most 6 from one club. A
  coach scores on the club's margin (the table in `backend/utils/coaches.py`): -20 to +25.
- **The coach is picked on the next game**, not his season - one game swings him 45 points.
  Club ratings from this season's margins (home edge out, opponents adjusted, shrunk
  toward average) give the next game's expected margin, and so the coach's expected points
  (`coach_outlook()`; constants calibrated on the last two seasons). `team.md` ranks every
  coach for the round - use it when the user asks which coach to take.
- **Priorities, in order** (the user's rule - coach and captain swing a round the most):
  1. **Coach** (`--coach best`, the default): the coach with the most expected points this
     round is picked before any player, whatever he costs. `--coach "Itoudis"` names one,
     `--coach any` lets the budget decide.
  2. **Captain** (`--captain best`): the top captain score - his FPT with this round's 10%
     winner's bonus in place of his club's usual one - is locked in and wears the armband.
     `team.md` ranks the top 8; `--captain "Vezenkov"` / `--captain any` override.
  3. **The core** (`--core 3-2-2 --core-min 15`): at least 3 G, 2 F, 2 C at 15+ FPT. At 105
     CR with Obradovic and Bryant, a 16+ core needs 107 CR (and projects lower).
  4. Then the highest projected round within the budget.
- **Players are valued on season averages** (`--value avg`, the default) - the user's call:
  it values a breakout like Diarra (20.2 FPT at 9.3 CR) at what he scores. Two others:
  `--value expected` (availability x average pulled toward the price; the best in the
  2025-26 backtest, 134 a round at 105 CR vs 123 on averages and 126 on form) and `--value
  form` (the Recommendations tab's last-3 momentum).
- **What a team really scores.** Rebuilt every round with no transfer limits, no formula
  reached 200 in a typical round (180+ about 1 round in 8 at 105 CR), and squads scored
  under their projection - ~50 FPT on season averages, ~18 on expected FPT - because the
  best-looking players are the luckiest. Never promise 200+; a replayed 200+ round is
  hindsight, since the squad was picked on games that include it.
- **Rule flags**: `--with` locks players in; `--without` leaves players out like injured ones
  (a doubt the injury report doesn't have yet); `--min-c` sets the bar both centers' value must
  clear ("great centers": 16+ was the top 5 in Round 7); `--star-g N` requires one of
  the N priciest healthy guards (the "superstar guard"), trying each - `team.md` lists the
  best squad around every one of them.
- **The squad is the exact best** within the budget (coach included) for those values - not
  a search that might miss one: `best_squad()`. Injured players and anyone short of games
  are out unless named in `--with`.
- **The numbers on the card**: cost, the next round projected, the last round replayed with
  the real scores, and how many rounds went over 200. The title only says
  "200+" when a replayed round really did; an average round of 200+ at ~105 CR is not
  realistic, so never claim one. `--title` / `--subtitle` override the defaults.

## Team vote + "drop your team" (a team card post)
Two or three team cards as one post ("Team A / B / C": `render_court()` with a badge and
title of your own), the text naming each build's captain, stars and projection, and the
call to drop a team for a review. X can't put a poll on a post with images, so the poll
(A / B / C / "Mine 👇") is the user's first reply and the link the second. Round 7's is in
`social/round-07/pre/team-vote/`.

**Reviewing a follower's team** (they reply with a screenshot or a list; the user pastes it):
1. Match every player in `squad_pool()` (`find_player`), add up the cost, field it with
   `lineup()` and project the round.
2. The three calls, in the user's order of priority: the **coach** for this round (the
   coach table in any `team.md`), the **captain** (`captain_scores()`), then the **one or
   two changes** worth making - `team --with "<the 8 they keep>" --budget <value + bank>
   --captain any` shows what the free spots should be.
3. Reply in their language: one thing that's good, the change with the FPT it adds, the
   captain and coach call. One number per point, friendly, never a lecture.

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
python3 $G team [--budget 105] [--with names] [--without names] [--core 3-2-2] [--coach best] [--captain best] [--value avg] [--replay N]  # a squad on a court
python3 $G banner                    # the X profile banner → social/profile/banner.png
O=.claude/skills/euroguru-social/originals.py
python3 $O facts social/round-XX/<batch> [--refresh]   # the stories sheet (+ the batch's frozen data)
python3 $O history                   # originals made so far: batch, format, id
python3 $O sheet "S. Vezenkov:OLY" "Y. Madar:HTA:2025"  # candidate photos side by side (+ last season's)
python3 social/round-XX/<batch>/make.py [ids] [--out DIR]   # build a batch's originals
```
Prefix with `SSL_CERT_FILE=backend/.ca-bundle.pem` on the work network.

## How posts are built
`generate.py`: each `post_<name>(ctx)` returns the card (`title`, `subtitle`, `body` via
`photo_body`) and the tweet parts (`hook`, `hook_he`, `lines`, or `poll` /
`thread`). `write_post_md()` / `write_batch_index()` / `write_plan()` write the
markdown. `compose()` adds the one hashtag and builds the reply with a UTM-tagged link
(`utm_campaign=rNN-<post id>`, visible in Vercel Analytics). Cards: `card.html` +
`card.css`; banner: `banner.html`. To add a post type, write the builder, register it in
`PRE` / `POST` / `NIGHT`, and give it a time in `prepare()`. Originals are not catalogue
posts: each batch's `make.py` builds them on `originals.py`, and `write_plan()` keeps
their ✦ block in `social/POSTS.md` while the batch is current.
