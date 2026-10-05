# EuroGuru growth playbook

The goal is the most reach for the least of your time. Everything that can run by itself
does; this file is the short list of what is left for you, in priority order.

**What runs by itself:** every round's posts (previews, captain poll, game nights, recaps,
thread), their images, their timing, the link-in-a-reply, UTM tags, Hebrew versions, and a
Reddit draft. **What needs you:** a one-time setup (about 45 minutes), then about
15–20 minutes on game days.

---

## Part 1 · One-time setup (do these in order)

### 1. X profile (10 min) - highest leverage, do it first
- **Name:** `EuroGuru · EuroLeague Fantasy`
- **Bio:** `Free EuroLeague Fantasy stats, live fantasy points & smart picks 🏀 Previews before every round, recaps after. 🇮🇱 עברית בקרוב`
- **Website:** `https://eurogurufantasy.com/?utm_source=x&utm_medium=profile`
- **Banner:** `social/profile/banner.png` (re-generate any time: `python3 .claude/skills/euroguru-social/social.py profile`)
- **Profile photo:** `frontend/public/guru-mark.png`
- **Pinned post:** a 20-second screen recording of the Live tab during a game (record with
  ⌘⇧5 on a phone-width window), text:
  `Follow your EuroLeague Fantasy team live: every basket, rebound and win bonus as it happens. Free 👇` - and the link in the first reply.

### 2. X API keys (15 min) - turns on auto-posting
1. Go to developer.x.com → sign in with the EuroGuru account → **Free** plan.
2. Create a Project and an App. In the App: **User authentication settings** → App
   permissions **Read and write** → Type **Web App, Automated App or Bot** → callback
   `https://eurogurufantasy.com` → save.
3. **Keys and tokens** → copy the API Key and Secret, then **generate** the Access Token and
   Secret (generate them *after* setting Read and write, or they will be read-only).
4. Add to `backend/.env` (never committed):
   ```
   X_API_KEY=...
   X_API_SECRET=...
   X_ACCESS_TOKEN=...
   X_ACCESS_SECRET=...
   ```
5. Check: `python3 .claude/skills/euroguru-social/xpost.py whoami` prints your account.

### 3. Turn on the schedule (2 min)
```bash
python3 .claude/skills/euroguru-social/social.py install   # runs every 30 min while the Mac is awake
python3 .claude/skills/euroguru-social/social.py status    # this round's calendar
```
Until step 4 it only prepares posts and sends a Mac notification; you publish them with
`social.py approve` (it shows each one, you press y).

### 4. Go fully automatic (1 min, after one round of approving)
Once you have seen a round's posts and are happy, add to `backend/.env`:
```
SOCIAL_AUTOPOST=1
```
From then on posts go out on their own. `social.py status` shows what went out;
`social/social.log` has the links.

### 5. Hebrew account (optional, 15 min, when ready)
Create a second X account (e.g. "EuroGuru עברית"), repeat step 2 for it and add
`X_HE_API_KEY`, `X_HE_API_SECRET`, `X_HE_ACCESS_TOKEN`, `X_HE_ACCESS_SECRET`. Hebrew versions
of every post then go out there automatically. (They are generated already - see each
post's `.json`.)

### 6. Reply list (10 min)
Make an X **List** (private is fine) called "EuroGuru replies" with 30–50 accounts:
- the official EuroLeague and EuroLeague Fantasy accounts, and the 20 clubs;
- EuroLeague journalists and stats accounts you already read;
- EuroLeague Fantasy / Dunkest creators and podcasts;
- big fan accounts in Greece, Israel, Turkey, Spain and Serbia.
This List is your game-day feed (Part 2).

---

## Part 2 · The routine

### Automatic, every round (nothing to do)
| When (Paris time) | Post |
|---|---|
| 2 days before the first tip-off | Consistent player at every position · Budget picks |
| 1 day before | Who's hot · Value kings |
| Lock day, 8h / 6h / 5h before | Injury watch · Smart picks · **Captain poll** |
| Each game night, 2.5h after the last tip-off | Tonight's top 5 |
| Morning after the round, 09:00 | Top performers · Team of the round |
| 13:00 | "What we learned" thread |
| 18:00 | Bargains of the round |
| Next day 12:00 | Price risers & fallers (needs the fetch + promote - see below) |

### Your part on game days (~15 min, the highest-value 15 minutes you have)
1. Open the "EuroGuru replies" List during the evening games.
2. When a club or journalist posts about a big performance, reply **within minutes** with
   the number and a card: run `python3 .claude/skills/euroguru-social/social.py live`
   (prints a fresh card + text of tonight's fantasy leaders), attach the image, add one
   line like "That's 34.0 fantasy points, his best of the season 🔥". **Aim for 5–10
   replies.** No links in replies - your profile does that job.
3. Answer every reply you get on your own posts. Conversations are what X rewards most.

### After each round (~5 min)
1. Run the data fetch and promote as usual (`run_dev_fetch.py`, then `promote.py`) - this
   feeds the previews and the price-movers post.
2. Post the Reddit draft (`social/round-XX/post/reddit.md`) to r/Euroleague as a text post.
   Data first, link only in the last line; reply to comments.

### Every two weeks (~10 min) - keep what works
- X → Analytics: impressions, profile visits, new followers per week.
- Vercel → Analytics, filter by `utm_campaign`: which post types bring visitors
  (`r05-round-thread`, `r05-captain-poll`...) and how many sign up.
- Drop the weakest post type, add one more of the best (tell Claude "drop X, add a Y post").

---

## Part 3 · Growth loops already in the app
- **Share a group:** every group on the Live tab has a Share button - a branded image of the
  live standings plus an invite link. Use it yourself in WhatsApp groups of your fantasy
  leagues ("our league, live 👇"); every friend who opens it lands on EuroGuru with the
  group ready to follow.
- **Invite links** carry the whole group (players, bench, captain), so a league can follow
  each other's teams in one tap.

## Part 4 · Next levers (when the routine runs smoothly)
1. **Short video** (TikTok / Reels / Shorts): a 15-second screen recording of the Live tab
   on a big night - repurpose the same clip on all three.
2. **A EuroGuru league in EuroLeague Fantasy**: create a public mini-league, put the code in
   the bio, shout out the weekly leader (a natural weekly post).
3. **Collaborations**: offer fantasy podcasters / YouTubers free custom cards with credit.
4. **Greek and Turkish** versions - the generator is built for more languages; ask Claude
   to add them the same way Hebrew was added.

## Commands at a glance
```bash
S=.claude/skills/euroguru-social
python3 $S/social.py status        # the round's calendar and what happened
python3 $S/social.py approve       # publish posts waiting for approval
python3 $S/social.py live          # a card of tonight's leaders, for replies
python3 $S/social.py profile       # re-render the X banner
python3 $S/generate.py pre|post    # (re)generate a batch by hand
python3 $S/xpost.py whoami         # check the X keys
```
On the work network, prefix Python commands with
`SSL_CERT_FILE=backend/.ca-bundle.pem` (the scheduled job does this by itself).
