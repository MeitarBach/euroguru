#!/usr/bin/env python3
"""
The EuroGuru posting calendar: generates each post when it is due and publishes it.

    python social.py status              # this round's calendar and what has happened
    python social.py tick                # do whatever is due now (the hourly job runs this)
    python social.py approve [--yes]     # publish posts waiting for approval
    python social.py live                # cards for replying under game posts, right now
    python social.py install | uninstall # the hourly job on this Mac (launchd)

Every round gets the same calendar (times are Europe/Paris, where the schedule lives):

    preview   T-48h  consistent-by-position, budget-picks
              T-26h  hot-hand, value-kings
              T-8h   injury-watch      T-6h  smart-picks      T-5h  captain-poll
    nights    each game day, 2.5h after its last tip-off: game-night
    recap     next morning 09:00: round-top-performers, team-of-the-round
              13:00: round-thread      18:00: round-bargains
              day after, 12:00: price-movers (waits for the round's price snapshot)

where T is the round's first tip-off. Each post is generated at its slot, so it uses the
freshest data, and is then either published (SOCIAL_AUTOPOST=1 in backend/.env, plus X
keys) or left waiting for `approve` with a Mac notification. Hebrew versions go to a
separate account when X_HE_* keys are set.

State lives in social/state.json, so nothing is ever posted twice.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate as gen  # noqa: E402
import xpost  # noqa: E402

STATE = gen.OUT_ROOT / "state.json"
LABEL = "com.euroguru.social"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG = gen.OUT_ROOT / "social.log"

PRE_SLOTS = [("consistent-by-position", -48), ("budget-picks", -48), ("hot-hand", -26), ("value-kings", -26),
             ("injury-watch", -8), ("smart-picks", -6), ("captain-poll", -5)]
# Recap slots: (post id, days after the round's last game day, local hour).
POST_SLOTS = [("round-top-performers", 1, 9), ("team-of-the-round", 1, 9), ("round-thread", 1, 13),
              ("round-bargains", 1, 18), ("price-movers", 2, 12)]
# How late a slot may still go out (a Mac that was asleep): previews never after lock.
MAX_LATE = {"post": timedelta(days=3), "night": timedelta(hours=14)}


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")


def at_paris(day, hour):
    return datetime.combine(day, time(hour), tzinfo=gen.PARIS).astimezone(timezone.utc)


def calendar(games, now):
    """Every slot that matters around now: the next round's preview, the nights and recap
    of the round in progress or just finished."""
    slots = []
    rounds = sorted({g["round"] for g in games})
    nxt = gen.next_round(games)
    done = gen.last_finished_round(games)
    for rnd in {r for r in (nxt, done, nxt - 1 if nxt else None) if r in rounds}:
        rg = sorted((g for g in games if g["round"] == rnd), key=lambda g: g["tipoff"])
        first, last = rg[0]["tipoff"], rg[-1]["tipoff"]
        for post_id, hours in PRE_SLOTS:
            slots.append({"key": f"r{rnd:02d}-pre-{post_id}", "mode": "pre", "round": rnd, "id": post_id,
                          "at": first + timedelta(hours=hours), "until": first})
        for day in sorted({g["tipoff"].astimezone(gen.PARIS).date() for g in rg}):
            day_last = max(g["tipoff"] for g in rg if g["tipoff"].astimezone(gen.PARIS).date() == day)
            at = day_last + timedelta(hours=2.5)
            slots.append({"key": f"r{rnd:02d}-night-{day}", "mode": "night", "round": rnd, "id": "game-night",
                          "date": day, "at": at, "until": at + MAX_LATE["night"]})
        end_day = (last + timedelta(hours=2.5)).astimezone(gen.PARIS).date()
        for post_id, days, hour in POST_SLOTS:
            at = at_paris(end_day + timedelta(days=days), hour)
            slots.append({"key": f"r{rnd:02d}-post-{post_id}", "mode": "post", "round": rnd, "id": post_id,
                          "at": at, "until": at + MAX_LATE["post"]})
    return sorted(slots, key=lambda s: s["at"])


def notify(text):
    try:
        subprocess.run(["osascript", "-e", f'display notification "{text}" with title "EuroGuru social"'],
                       capture_output=True, timeout=10)
    except Exception:
        pass


def log(line):
    gen.OUT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    with LOG.open("a") as fh:
        fh.write(f"{stamp} {line}\n")
    print(line)


def publish_entry(entry, langs=("en", "he")):
    """Publish a generated post in every language that has an account. Returns True when
    the main account's post went out."""
    post = json.loads(Path(entry["file"]).read_text())
    sent = entry.setdefault("posted", {})
    for lang in langs:
        creds = xpost.credentials(lang)
        if not creds or lang in sent:
            continue
        sent[lang] = xpost.publish(post, lang, creds)
        log(f"posted {entry['key']} [{lang}] -> https://x.com/i/status/{sent[lang][0]}")
    return "en" in sent


def tick():
    xpost.load_env()
    autopost = os.environ.get("SOCIAL_AUTOPOST") == "1" and xpost.credentials("en")
    now = datetime.now(timezone.utc)
    state = load_state()
    games = gen.schedule()
    ready = 0
    for slot in calendar(games, now):
        entry = state.get(slot["key"], {})
        if entry.get("status") in ("posted", "skipped") or now < slot["at"]:
            continue
        if now > slot["until"]:
            if entry.get("status") != "missed":
                state[slot["key"]] = {**entry, "key": slot["key"], "status": "missed"}
                log(f"missed {slot['key']} (its window closed)")
            continue
        if not entry.get("file"):
            try:
                _, out, made, notes = gen.generate(slot["mode"], slot["round"], {slot["id"]}, slot.get("date"))
            except SystemExit as stop:  # e.g. the round's boxscores are not in yet
                log(f"waiting {slot['key']}: {stop}")
                continue
            if slot["id"] not in made:
                log(f"waiting {slot['key']}: {'; '.join(notes) or 'nothing to post yet'}")
                continue
            entry = {"key": slot["key"], "file": str(out / f"{slot['id']}.json"), "status": "ready"}
            state[slot["key"]] = entry
            save_state(state)
        if autopost:
            try:
                if publish_entry(entry):
                    entry["status"] = "posted"
            except Exception as exc:
                log(f"failed {slot['key']}: {exc}")
        else:
            ready += 1
        save_state(state)
    if ready:
        notify(f"{ready} post(s) ready - run: social.py approve")
    save_state(state)


def approve(yes=False):
    xpost.load_env()
    if not xpost.credentials("en"):
        sys.exit("No X keys yet - add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET to backend/.env.")
    state = load_state()
    waiting = [e for e in state.values() if e.get("status") == "ready"]
    if not waiting:
        print("Nothing waiting.")
        return
    for entry in waiting:
        post = json.loads(Path(entry["file"]).read_text())
        t = post["tweets"]["en"]
        print(f"\n=== {entry['key']} ===")
        print("\n---\n".join(t.get("thread") or [t["main"], "↳ " + t["reply"]]))
        if post.get("image"):
            print(f"[image] {post['image']}")
        answer = "y" if yes else input("Post it? [y/N/s=skip for good] ").strip().lower()
        if answer == "s":
            entry["status"] = "skipped"
            save_state(state)
            continue
        if answer != "y":
            continue
        try:
            if publish_entry(entry):
                entry["status"] = "posted"
        except Exception as exc:
            log(f"failed {entry['key']}: {exc}")
        save_state(state)


def status():
    now = datetime.now(timezone.utc)
    state = load_state()
    for slot in calendar(gen.schedule(), now):
        entry = state.get(slot["key"], {})
        when = slot["at"].astimezone(gen.PARIS).strftime("%a %d %b %H:%M")
        mark = entry.get("status") or ("due" if slot["at"] <= now <= slot["until"] else
                                       "closed" if now > slot["until"] else "upcoming")
        print(f"{when}  {mark:9}  {slot['key']}")


def live():
    _, out, made, notes = gen.generate("live")
    for post_id, post in made.items():
        t = post["tweets"]["en"]
        print(f"{post['image']}\n\n{t['main']}\n")
    for note in notes:
        print(f"! {note}")
    if not made:
        print("No game is on right now.")


PLIST_BODY = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/env</string><string>python3</string><string>{script}</string><string>tick</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    {cert}
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
"""


def install():
    bundle = gen.REPO / "backend" / ".ca-bundle.pem"
    cert = f"<key>SSL_CERT_FILE</key><string>{bundle}</string>" if bundle.exists() else ""
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    gen.OUT_ROOT.mkdir(parents=True, exist_ok=True)
    PLIST.write_text(PLIST_BODY.format(label=LABEL, script=Path(__file__).resolve(), cert=cert, log=LOG))
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    subprocess.run(["launchctl", "load", str(PLIST)], check=True)
    print(f"Installed: runs every 30 minutes while this Mac is awake. Log: {LOG}")


def uninstall():
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    PLIST.unlink(missing_ok=True)
    print("Removed the scheduled job.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "tick":
        tick()
    elif cmd == "approve":
        approve("--yes" in sys.argv)
    elif cmd == "live":
        live()
    elif cmd == "install":
        install()
    elif cmd == "uninstall":
        uninstall()
    else:
        status()
