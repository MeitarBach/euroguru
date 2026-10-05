# EuroGuru growth playbook

You post and reply by hand. Claude prepares the posts, tells you what to post when, and
helps with replies. About **30 minutes a week**.

## Once (≈20 minutes)

**Profile** - it multiplies everything else:
- **Name:** `EuroGuru · EuroLeague Fantasy`
- **Bio:** `Free EuroLeague Fantasy stats, live fantasy points & smart picks 🏀 Previews before every round, recaps after.`
- **Website:** `https://eurogurufantasy.com/?utm_source=x&utm_medium=profile`
- **Banner:** `social/profile/banner.png` (ask Claude for it, or `generate.py banner`)
- **Photo:** `frontend/public/guru-mark.png`
- **Pinned post:** a 20-second screen recording of the Live tab during a game, with
  `Follow your EuroLeague Fantasy team live - every basket, rebound and win bonus as it happens. Free 👇`
  and the link in the first reply.

**Reply list:** a private X List "EuroGuru replies" with 30–50 accounts - the official
EuroLeague and EuroLeague Fantasy accounts, the clubs, EuroLeague journalists and stats
accounts, fantasy creators, and big fan accounts in Greece, Israel, Turkey, Spain, Serbia.

## Every round

Run **`/euroguru-social`** in Claude Code whenever you sit down to post. It creates the
posts that fit right now and tells you what to post and when (all of it is also in
`social/PLAN.md`).

| When | Post (core) |
|---|---|
| 2 days before the round locks | Budget picks |
| The day before | Who's hot |
| ~5 hours before lock | Captain poll |
| After each game night | Tonight's top 5 |
| The morning after the round | Team of the round |

Posting one takes ~2 minutes: attach the image, paste the text, post; then reply to your
own post with the reply text (it carries the link - X shows posts with links to fewer
people, so the link always goes in the reply).

Run `/euroguru-social` again after each game night and after the round - it picks up what
is new.

## Game nights: replies (≈10 minutes) - the biggest growth lever

1. Open the "EuroGuru replies" List during the games.
2. Paste a post you want to answer into Claude ("how should I reply to this?"). You get 2–3
   ready replies with a real fantasy number, and an image to attach when it helps.
3. Aim for **5 replies, within minutes** of the original posts. Answer everyone who replies
   to you.

## Every two weeks (≈10 minutes)
- **X → Analytics:** impressions, profile visits, followers.
- **Vercel → Analytics**, by `utm_campaign` (e.g. `r05-captain-poll`): which posts bring visitors.
- Keep what works, drop what does not - ask Claude to change the post mix.

## Free multipliers in the app
- **Share a group** (Live tab → Share): a branded image of the group's live total plus an
  invite link - post it in your fantasy leagues' WhatsApp groups.

## Later
- Short video (the Live-tab clip) on TikTok / Reels / Shorts.
- A public EuroGuru mini-league in EuroLeague Fantasy, with a weekly shout-out.
- Hebrew: every post is generated in Hebrew too (each post's `.json` → `tweets.he`).
- Reddit: each recap also writes `reddit.md`, ready for r/Euroleague.
