# EuroGuru growth playbook

**Goal:** the most reach for the least of your time. You post and reply by hand; the
computer does everything else - picks what to post and when, builds the image and text,
tells you when it is time, and opens X with it filled in.

**Your time:** ~2 minutes per post, ~6 posts per round, plus 10 minutes of replies on game
nights. About **30 minutes a week**.

---

## 1. One-time setup (≈20 minutes, in this order)

### 1.1 Profile (10 min) - do this first, it multiplies everything else
- **Name:** `EuroGuru · EuroLeague Fantasy`
- **Bio:** `Free EuroLeague Fantasy stats, live fantasy points & smart picks 🏀 Previews before every round, recaps after.`
- **Website:** `https://eurogurufantasy.com/?utm_source=x&utm_medium=profile`
- **Banner:** `social/profile/banner.png` (re-render: `social.py profile`)
- **Photo:** `frontend/public/guru-mark.png`
- **Pinned post:** a 20-second screen recording of the Live tab during a game (⌘⇧5 on a
  phone-width browser window), text:
  `Follow your EuroLeague Fantasy team live - every basket, rebound and win bonus as it happens. Free 👇`
  and the link in the first reply.

### 1.2 Turn on the reminders (2 min)
```bash
python3 .claude/skills/euroguru-social/social.py install
```
Every 30 minutes (while the Mac is awake) it prepares whatever post is due and shows a
notification: **"Ready to post: … - run: social.py next"**. Nothing is ever posted for you.

### 1.3 Reply list (10 min)
Make a private X **List** "EuroGuru replies" with 30–50 accounts: the official EuroLeague
and EuroLeague Fantasy accounts, the clubs, EuroLeague journalists and stats accounts,
fantasy creators and podcasts, and big fan accounts in Greece, Israel, Turkey, Spain and
Serbia. This is your game-night feed.

---

## 2. Posting a post (≈2 minutes, every time the same)

When a notification arrives, run:
```bash
python3 .claude/skills/euroguru-social/social.py next
```
1. X opens with the text already written; the **image is on your clipboard** - press
   **⌘V** to attach it - and **Post**.
2. Copy the new post's link (Share → Copy link), paste it into the terminal: the
   **reply opens with the site link filled in** - **Post**.
3. Press Enter. Done; `next` again if more are waiting.

Polls: `next` lists the options - click the poll icon in the composer and type them (4 short
names). Threads (optional set): `next` copies each part in turn.

> Why the link goes in a reply: X shows posts with outside links to far fewer people. The
> post earns the reach; the reply carries the link.

---

## 3. The round calendar (core set - ~6 posts)

| When (Paris time) | Post | Why this one |
|---|---|---|
| 2 days before the first tip-off | **Budget picks** (≤10 CR) | What people act on while building teams |
| 1 day before | **Who's hot** (last 3 games) | Easy to agree/argue with → replies |
| ~5h before lock | **Captain poll** | Polls get the most engagement for the least effort |
| Each game night, ~2.5h after the last tip-off | **Tonight's top 5** | Everyone is talking about the games now. Late night? The window stays open 14h - post it the next morning |
| Morning after the round, 09:00 | **Team of the round** | The most shareable recap |

Every post is due once; if you miss one, it expires quietly - no backlog guilt.

**More when you have time:** set `SOCIAL_LEVEL=full` in `backend/.env` to also get
consistency by position, value kings, injury watch, smart picks, top performers, the "what
we learned" thread, bargains and price movers (~15 posts/round).

---

## 4. Game nights: replies (≈10 minutes) - your biggest growth lever

A small account grows fastest by being useful under bigger accounts' posts.
1. Open the "EuroGuru replies" List during the evening games.
2. When a club, journalist or the official account posts a big performance, run:
   ```bash
   python3 .claude/skills/euroguru-social/social.py live
   ```
   A card of tonight's fantasy leaders is now **on your clipboard**. Reply with one line +
   ⌘V, e.g. *"That's 34.0 fantasy points - best of the night so far 🔥"*.
3. **5 replies, within minutes of their post.** Speed matters more than polish.
4. No links in replies - the profile does that job.
5. Reply to everyone who replies to you. Conversations are what X rewards most.

---

## 5. After each round (≈5 minutes)
1. Fetch and promote the data as usual (`run_dev_fetch.py`, `promote.py`) - this feeds the
   next round's previews.
2. Optional: `generate.py post` writes `social/round-XX/post/reddit.md` - paste it into
   r/Euroleague as a text post (data first, link only at the end), reply to comments.

## 6. Every two weeks (≈10 minutes) - keep what works
- **X → Analytics:** impressions, profile visits, new followers per week.
- **Vercel → Analytics**, filter by `utm_campaign` (`r05-captain-poll`,
  `r05-team-of-the-round`…): which post types bring visitors and sign-ups.
- Drop the weakest post type, double the best (ask Claude to change the calendar).

## 7. Free multipliers already in the app
- **Share a group** (Live tab → Share): a branded image of a group's live total plus an
  invite link. Post it in your fantasy leagues' WhatsApp groups ("our league, live 👇") -
  every friend who taps lands on EuroGuru with the group ready to follow.
- **Invite links** carry the whole group (players, bench, captain).

## 8. Later, when the routine is easy
1. **Short video** (TikTok / Reels / Shorts): the Live-tab clip from the pinned post works on
   all three.
2. **A EuroGuru mini-league** in EuroLeague Fantasy - code in the bio, a weekly shout-out to
   the leader (a ready-made weekly post).
3. **Hebrew:** every post is already generated in Hebrew too - `social.py next --he` posts
   the Hebrew version (to a separate account if you open one).
4. **Automatic posting:** X's API now charges per post through prepaid credits. If you buy
   credits later: add `SOCIAL_AUTOPOST=1` to `backend/.env` and everything above posts itself
   (the X keys are already set up).

---

## Commands
```bash
S=.claude/skills/euroguru-social
python3 $S/social.py next      # post the next waiting post (guided)
python3 $S/social.py live      # tonight's leaders card → clipboard, for replies
python3 $S/social.py status    # this round's calendar
python3 $S/social.py profile   # re-render the X banner
python3 $S/social.py install   # reminders on (uninstall: turns them off)
```
On the work network, prefix with `SSL_CERT_FILE=backend/.ca-bundle.pem` (the reminder job
does this by itself).
