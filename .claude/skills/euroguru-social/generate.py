#!/usr/bin/env python3
"""
EuroGuru social posts: a fixed set of tweets, each with a branded 1200x675 image, for
before and after every fantasy round.

    python generate.py pre                 # posts for the next round
    python generate.py post --round 3      # recap of a finished round
    python generate.py night               # tonight's top 3, once tonight's games are final
    python generate.py live                # leaders in the games on right now (for replies)
    python generate.py pre --only hot-hand,budget-picks
    python generate.py team --budget 105 --with Vezenkov --min-c 16 --star-g 5   # a whole squad on a court
    python generate.py team --budget 101 --without Lessort,Ndiaye                # leave out injury doubts

Output goes to social/round-XX/<batch>/<post id>/ at the repo root: post.md (the post
ready to copy - main text, the reply carrying the link, or a poll / thread - in English
and Hebrew) next to <post id>.png. Each batch also gets a POSTS.md with all of its posts
in order, and `prepare` writes social/POSTS.md: every post that fits now, in posting
order, to choose from. Nothing is posted here - the user posts by hand. Each batch's
originals - one-off formats designed per run - come from originals.py (originals.md).

Standard library only. Data comes from the public EuroGuru API and, for round recaps,
straight from Euroleague's feeds - scored exactly as the fantasy game scores it (PIR,
plus 10% of |PIR| for the winning team), the same rule the Live tab uses.
"""

import argparse
import html
import json
import math
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SKILL = Path(__file__).resolve().parent
REPO = SKILL.parents[2]
OUT_ROOT = REPO / "social"
MASCOT = REPO / "frontend" / "public" / "guru-mark.png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Euroleague lists every tip-off in Central European time.
PARIS = ZoneInfo("Europe/Paris")

API = "https://euroguru-api.vercel.app/api"
SEASON = "2026"
SCHEDULE_URL = f"https://api-live.euroleague.net/v1/schedules?seasonCode=E{SEASON}"
BOXSCORE_URL = "https://live.euroleague.net/api/Boxscore?gamecode={code}&seasoncode=E" + SEASON
# Every club's roster for a season, with the official headshot of each player.
PEOPLE_URL = ("https://api-live.euroleague.net/v2/competitions/E/seasons/E{season}/people"
              "?personType=J&limit=1000")  # players only; the default page stops at 500 people
HEADSHOTS = OUT_ROOT / ".headshots"  # downloaded once, reused by every later card
# Players per image: more than this and the card gets crowded. Team of the round (a
# lineup of 5) is the one exception, drawn with compact cards.
MAX_PLAYERS = 3

SITE = "https://eurogurufantasy.com"
TAGS = "#EuroLeagueFantasy #EuroLeague"
LINK_LINE = f"Full stats & live scores 👉 {SITE}"

# Dunkest team code -> Euroleague code (mirrors DUNKEST_TEAM_CODES in the backend).
DUNKEST_TO_EL = {
    "ASV": "ASV", "BAR": "BAR", "BAY": "MUN", "BJK": "BES", "CZV": "RED", "DUB": "DUB",
    "EFS": "IST", "FBT": "ULK", "HTA": "HTA", "KBA": "BAS", "MIL": "MIL", "MTA": "TEL",
    "OLY": "OLY", "PAO": "PAN", "PAR": "PAR", "PBB": "PRS", "RMB": "MAD", "VBC": "PAM",
    "VIR": "VIR", "ZAL": "ZAL",
}


# --- data -------------------------------------------------------------------------

def fetch(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json",
                                                           "user-agent": "euroguru-social"})
    with urllib.request.urlopen(req, timeout=40) as res:
        raw = res.read()
    return raw


def api_get(path):
    return json.loads(fetch(f"{API}{path}"))


def api_post(path, body):
    return json.loads(fetch(f"{API}{path}", body))


def stats(window, regulars_only=False):
    """Every priced player's averages over the last `window` games (100 = season).
    `regulars_only`: just the players with more than half of their club's games - the
    app's bar for ranking anyone (a roster for matching boxscores needs everyone)."""
    return api_post("/stats", {"season": SEASON, "position": "All", "min_cr": 0, "max_cr": 100,
                               "last_x_games": window, "regulars_only": regulars_only})


SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}


def name_parts(name):
    """(initial, SURNAME) for any spelling either feed uses - port of the app's rule."""
    text = re.sub(r"\s*\([^)]*\)\s*$", "", str(name or ""))
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = re.sub(r"\s+", " ", text.replace("-", " ").replace("'", "").replace(".", "")).strip()
    if "," in text:
        last, first = text.split(",", 1)
    else:
        tokens = text.split(" ")
        first, last = (tokens[0], " ".join(tokens[1:])) if len(tokens) > 1 else ("", text)
    surname = " ".join(w for w in last.split() if w not in SUFFIXES).strip()
    return first.strip()[:1], surname


def el_code(player):
    return player.get("TeamCode") or DUNKEST_TO_EL.get(str(player.get("Team", "")).upper())


_rosters = {}


def roster_photos(season=SEASON):
    """Every player on a EuroLeague roster in a season (this one by default) that has a headshot."""
    if season not in _rosters:
        roster = _rosters[season] = []
        try:
            rows = json.loads(fetch(PEOPLE_URL.format(season=season))).get("data", [])
        except Exception as exc:  # no photos is not worth losing the batch over
            print(f"  ! headshots unavailable ({exc}) - cards show initials")
            rows = []
        for row in rows:
            url = (row.get("images") or {}).get("headshot")
            if row.get("type") == "J" and url:
                initial, last = name_parts(row["person"]["name"])
                roster.append({"club": row["club"]["code"], "initial": initial, "last": last,
                               "code": row["person"]["code"], "url": url, "active": row.get("active")})
    return _rosters[season]


def headshot(name, club=None, season=SEASON):
    """A player's official photo as a local file, or None. Matched like the boxscores:
    club + initial + surname first, then looser, and only when the match is unique.
    An earlier `season` finds the photo in his jersey of that season (club = his club then)."""
    initial, last = name_parts(name)
    same = [p for p in roster_photos(season) if p["last"] == last]
    for pool in ([p for p in same if p["club"] == club and p["initial"] == initial],
                 [p for p in same if p["club"] == club],
                 [p for p in same if p["initial"] == initial]):
        if len({p["code"] for p in pool}) == 1:
            person = sorted(pool, key=lambda p: not p["active"])[0]
            break
    else:
        print(f"  ! no headshot for {name} ({club}{'' if season == SEASON else f', {season}'}) - initials used")
        return None
    folder = HEADSHOTS if season == SEASON else HEADSHOTS / f"E{season}"
    path = folder / f"{person['code']}.png"
    if not path.exists():
        try:
            raw = fetch(person["url"])
        except Exception as exc:
            print(f"  ! headshot download failed for {name}: {exc}")
            return None
        if not raw.startswith(b"\x89PNG"):
            return None
        folder.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return path


def injuries():
    """Name key -> status ('OUT' / 'GTD') from the injury report the dashboard serves."""
    report = api_get(f"/dashboard?season={SEASON}").get("injuries") or []
    out = {}
    for row in report:
        status = str(row.get("InjuryStatus", "")).upper()
        tag = "OUT" if status.startswith("OUT") else "GTD" if status else None
        if tag:
            out[name_parts(row.get("Player"))] = (tag, row.get("Injury") or "")
    return out


def schedule():
    items = ET.fromstring(fetch(SCHEDULE_URL)).findall("item")
    games = []
    for it in items:
        try:
            date = datetime.strptime(f"{it.findtext('date').strip()} {it.findtext('startime').strip()}",
                                     "%b %d, %Y %H:%M")
        except (AttributeError, ValueError):
            continue
        games.append({
            "code": int(it.findtext("game")), "round": int(it.findtext("gameday")),
            "tipoff": date.replace(tzinfo=PARIS).astimezone(timezone.utc),
            "home": it.findtext("homecode").strip(), "away": it.findtext("awaycode").strip(),
            "played": (it.findtext("played") or "").strip().lower() == "true",
        })
    return games


def next_round(games):
    now = datetime.now(timezone.utc)
    upcoming = sorted((g for g in games if g["tipoff"] > now), key=lambda g: g["tipoff"])
    return upcoming[0]["round"] if upcoming else max(g["round"] for g in games)


def night_round(games, day=None):
    day = day or datetime.now(PARIS).date()
    tonight = [g for g in games if g["tipoff"].astimezone(PARIS).date() == day]
    return tonight[0]["round"] if tonight else None


def live_round(games):
    now = datetime.now(timezone.utc)
    on = [g for g in games if g["tipoff"] <= now <= g["tipoff"] + timedelta(hours=3)]
    return on[0]["round"] if on else None


def last_finished_round(games):
    rounds = sorted({g["round"] for g in games})
    done = [r for r in rounds if all(g["played"] for g in games if g["round"] == r)]
    return done[-1] if done else None


def round_scores(games, rnd, roster, final_bonus=True):
    """Every priced player's FPT from boxscores: the round's games, or - with rnd None -
    exactly the games given. The win bonus applies only to finished games."""
    by_team = {}
    for p in roster:
        by_team.setdefault(el_code(p), []).append(p)
    results = []
    for g in (games if rnd is None else [g for g in games if g["round"] == rnd]):
        raw = fetch(BOXSCORE_URL.format(code=g["code"]))
        if not raw.strip():
            continue
        box = json.loads(raw)
        finished = final_bonus and not box.get("Live")
        teams = box.get("Stats") or []
        points = {t["PlayersStats"][0]["Team"].strip(): sum(p["Points"] for p in t["PlayersStats"])
                  for t in teams if t.get("PlayersStats")}
        for t in teams:
            lines = t.get("PlayersStats") or []
            if not lines:
                continue
            code = lines[0]["Team"].strip()
            won = finished and len(points) > 1 and points.get(code, 0) > max(v for k, v in points.items() if k != code)
            squad = by_team.get(code, [])
            full = {}
            for p in squad:
                full.setdefault(name_parts(p["PlayerName"]), []).append(p)
            surname = {}
            for p in squad:
                surname.setdefault(name_parts(p["PlayerName"])[1], []).append(p)
            for line in lines:
                if str(line.get("Minutes", "")).upper() in ("", "DNP"):
                    continue
                key = name_parts(line["Player"])
                match = full.get(key)
                if not match or len(match) != 1:
                    match = surname.get(key[1])
                if not match or len(match) != 1:
                    continue
                pir = line["Valuation"]
                fpt = round(pir + (0.1 * abs(pir) if won else 0), 1)
                results.append({**match[0], "fpt": fpt, "pts": line["Points"], "reb": line["TotalRebounds"],
                                "ast": line["Assistances"], "won": won,
                                "vs": g["away"] if code == g["home"] else g["home"]})
    return results


# --- formatting --------------------------------------------------------------------

def display_name(name):
    """Some feeds lower-case the part after a hyphen ('N. Hayes-davis')."""
    return re.sub(r"-([a-z])", lambda m: "-" + m.group(1).upper(), name)


def surname(name):
    clean = re.sub(r"\s*\([^)]*\)$", "", display_name(name))
    return clean.split(" ", 1)[1] if " " in clean else clean


def num(x, d=1):
    return f"{x:.{d}f}"


def tweet(*lines):
    text = "\n".join(l for l in lines if l is not None)
    return text


def x_length(text):
    """Length as X counts it: every link is 23 characters; Latin, Greek, Hebrew and common
    punctuation count 1, everything else (emoji, ⚡, arrows, ≤) counts 2."""
    text = re.sub(r"https?://\S+", "x" * 23, text)
    light = lambda o: o <= 4351 or 8192 <= o <= 8205 or 8208 <= o <= 8223 or 8242 <= o <= 8247
    return sum(1 if light(ord(c)) else 2 for c in text)


def initials(name):
    initial, last = name_parts(name)
    return f"{initial}{last[:1]}"


def photo_body(items):
    """Player cards, each with the player's headshot - the layout for every post about
    players. Up to MAX_PLAYERS cards; more (team of the round) switch to compact cards.
    items: dicts with pos, name, team (Euroleague code, finds the photo), big, unit,
    line, meta [html snippets], tone ('up' / 'down'), tag ((css class, text))."""
    compact = len(items) > MAX_PLAYERS
    cards = []
    for it in items:
        shot = headshot(it["name"], it.get("team"))
        photo = (f'<img class="shot" src="{shot.as_uri()}" alt="">' if shot
                 else f'<div class="initials">{html.escape(initials(it["name"]))}</div>')
        tag = f'<span class="tag {it["tag"][0]}">{it["tag"][1]}</span>' if it.get("tag") else ""
        stat = f'<div class="stat {it.get("tone", "")}"><b>{it["big"]}</b><small>{it["unit"]}</small></div>'
        meta = "".join(f"<span>{m}</span>" for m in it.get("meta") or [])
        cards.append(
            f'<div class="pcard"><div class="halo"></div>{photo}<span class="chip">{it["pos"]}</span>'
            f'{"" if compact else stat}'
            f'<div class="info"><div class="name">{html.escape(display_name(it["name"]))}{tag}</div>'
            f'<div class="line">{html.escape(it.get("line") or "")}</div>'
            f'{stat if compact else (f"<div class=meta>{meta}</div>" if meta else "")}</div></div>')
    return (f'<div class="pcards{" compact" if compact else ""}" '
            f'style="grid-template-columns: repeat({len(items)}, 1fr)">{"".join(cards)}</div>')


def cr_meta(cr):
    return f"<b>{num(cr)}</b> CR"



# --- the posts ---------------------------------------------------------------------
# A builder returns a card - title, subtitle, body (the image's HTML, from photo_body) -
# plus the tweet's parts: `hook` / `hook_he` (the opening line in English and Hebrew) and
# `lines` (the player lines, shared by both - the same players as the image). compose()
# turns that into the main tweet, the reply that carries the link, and the Hebrew pair. A
# builder may instead return a `poll` or a `thread`, and returns None to skip.

def healthy(players, inj):
    return [p for p in players if name_parts(p["PlayerName"]) not in inj]


def post_consistent(ctx):
    rows = [p for p in healthy(ctx["regulars"], ctx["inj"])
            if (p.get("GamesPlayed") or 0) >= 2 and p.get("Average_Score") is not None]
    picks = []
    for pos in ("C", "F", "G"):
        group = [p for p in rows if p["position"] == pos]
        if group:
            picks.append(max(group, key=lambda p: p["Average_Score"] - 2 * (p.get("StdDev_Score") or 0)))
    if not picks:
        return None
    r = ctx["round"]
    return {
        "title": "The safest pick at every position",
        "subtitle": "Highest reliable floor (average − 2 × SD) this season, injured players excluded",
        "body": photo_body([{"pos": p["position"], "name": p["PlayerName"], "team": el_code(p), "line": el_code(p),
                             "big": num(p["Average_Score"]), "unit": "avg FPT",
                             "meta": [f"SD <b>{num(p.get('StdDev_Score') or 0)}</b>", cr_meta(p["CR"])]} for p in picks]),
        "hook": f"🎯 The safest pick at every position for Round {r}, by EuroGuru's reliability score:",
        "hook_he": f"🎯 הבחירה הכי בטוחה בכל עמדה למחזור {r}, לפי ציון האמינות של EuroGuru:",
        "lines": [f"{p['position']} {surname(p['PlayerName'])} · {num(p['Average_Score'])} avg · "
                  f"SD {num(p.get('StdDev_Score') or 0)} · {num(p['CR'])} CR" for p in picks],
    }


def post_hot(ctx):
    rows = sorted((p for p in healthy(ctx["last3"], ctx["inj"]) if p.get("Average_Score") is not None),
                  key=lambda p: -p["Average_Score"])[:MAX_PLAYERS]
    if not rows:
        return None
    r = ctx["round"]
    season = {name_parts(p["PlayerName"]): p.get("Average_Score") for p in ctx["season"]}
    return {
        "title": "Who's hot going into the round",
        "subtitle": "Best average FPT over each player's last 3 games",
        "body": photo_body([{"pos": p["position"], "name": p["PlayerName"], "team": el_code(p), "line": el_code(p),
                             "big": num(p["Average_Score"]), "unit": "last 3",
                             "meta": [f"season <b>{num(season[name_parts(p['PlayerName'])])}</b>"
                                      if season.get(name_parts(p["PlayerName"])) is not None else "",
                                      cr_meta(p["CR"])]} for p in rows]),
        "hook": f"🔥 Hottest players before Round {r} (last 3 games), via EuroGuru:",
        "hook_he": f"🔥 הכי חמים לפני מחזור {r} (3 משחקים אחרונים), לפי EuroGuru:",
        "lines": [f"{i}. {surname(p['PlayerName'])} {num(p['Average_Score'])} · {num(p['CR'])} CR"
                  for i, p in enumerate(rows, 1)],
    }


def post_budget(ctx):
    rows = sorted((p for p in healthy(ctx["last5"], ctx["inj"])
                   if p.get("Average_Score") is not None and p["CR"] <= 10),
                  key=lambda p: -p["Average_Score"])[:MAX_PLAYERS]
    if not rows:
        return None
    r = ctx["round"]
    beaten = sum(1 for p in ctx["last5"] if p.get("Average_Score") is not None and p["CR"] >= 14
                 and p["Average_Score"] < rows[0]["Average_Score"])
    return {
        "title": "Budget picks: 10 CR or less",
        "subtitle": "Best average FPT over the last 5 games among healthy players at ≤10 CR",
        "body": photo_body([{"pos": p["position"], "name": p["PlayerName"], "team": el_code(p), "line": el_code(p),
                             "big": num(p["Average_Score"]), "unit": "avg FPT",
                             "meta": [f"<b>{num(p['Average_Score'] / p['CR'], 2)}</b> FPT / CR", cr_meta(p["CR"])]}
                            for p in rows]),
        "insight": (f"{surname(rows[0]['PlayerName'])} out-scores {beaten} players priced 14+ CR." if beaten else None),
        "insight_he": (f"{surname(rows[0]['PlayerName'])} מקדים {beaten} שחקנים שעולים 14+ קרדיט." if beaten else None),
        "hook": f"💰 No need to pay 15 CR. EuroGuru's best ≤10 CR picks for Round {r}:",
        "hook_he": f"💰 לא חייבים לשלם 15 קרדיט. המציאות של EuroGuru עד 10 קרדיט למחזור {r}:",
        "lines": [f"{p['position']} {surname(p['PlayerName'])} · {num(p['Average_Score'])} FPT · {num(p['CR'])} CR"
                  for p in rows],
    }


def post_value(ctx):
    rows = [p for p in healthy(ctx["regulars"], ctx["inj"])
            if p.get("Value") and (p.get("GamesPlayed") or 0) >= 2]
    picks = [max((p for p in rows if p["position"] == pos), key=lambda p: p["Value"], default=None)
             for pos in ("C", "F", "G")]
    picks = [p for p in picks if p]
    if not picks:
        return None
    r = ctx["round"]
    return {
        "title": "Value kings: most FPT per credit",
        "subtitle": "Season FPT per CR spent, best at each position",
        "body": photo_body([{"pos": p["position"], "name": p["PlayerName"], "team": el_code(p), "line": el_code(p),
                             "big": num(p["Value"], 2), "unit": "FPT / CR",
                             "meta": [f"avg <b>{num(p['Average_Score'])}</b>", cr_meta(p["CR"])]} for p in picks]),
        "hook": f"👑 Most FPT per credit at each position before Round {r}, via EuroGuru:",
        "hook_he": f"👑 הכי הרבה FPT לקרדיט בכל עמדה לפני מחזור {r}, לפי EuroGuru:",
        "lines": [f"{p['position']}: {surname(p['PlayerName'])} · {num(p['Value'], 2)} FPT/CR · "
                  f"{num(p['Average_Score'])} avg · {num(p['CR'])} CR" for p in picks],
    }


def post_smart(ctx):
    recs = healthy(api_post("/recommend", {"season": SEASON, "min_cr": 0, "max_cr": 100}), ctx["inj"])[:MAX_PLAYERS]
    if not recs:
        return None
    r = ctx["round"]
    return {
        "title": "EuroGuru smart picks",
        "subtitle": "Recency-weighted output, value per credit and consistency, combined",
        "body": photo_body([{"pos": x.get("position", ""), "name": x["PlayerName"], "team": el_code(x), "line": el_code(x),
                             "big": num(float(x["RecScore"])), "unit": "score",
                             "meta": [f"<b>{num(float(x.get('Efficiency') or 0), 2)}</b> FPT / CR", cr_meta(float(x["CR"]))]}
                            for x in recs]),
        "hook": f"🧠 EuroGuru's model (form × value × consistency) top {len(recs)} for Round {r}:",
        "hook_he": f"🧠 הטופ {len(recs)} של המודל של EuroGuru (כושר × תמורה × עקביות) למחזור {r}:",
        "lines": [f"{i}. {surname(x['PlayerName'])} ({x.get('position', '')}) · {num(float(x['CR']))} CR"
                  for i, x in enumerate(recs, 1)],
    }


def post_injuries(ctx):
    by_key = {name_parts(p["PlayerName"]): p for p in ctx["season"]}
    hit = [(by_key[k], tag, injury) for k, (tag, injury) in ctx["inj"].items() if k in by_key]
    hit = sorted(hit, key=lambda t: -(t[0]["CR"] or 0))[:MAX_PLAYERS]
    if not hit:
        return None
    r = ctx["round"]
    return {
        "title": "Injury watch: think twice before you pick",
        "subtitle": "Highest-priced players on the injury report",
        "body": photo_body([{"pos": p["position"], "name": p["PlayerName"], "team": el_code(p),
                             "line": injury or el_code(p), "big": num(p["CR"]), "unit": "CR", "tag": (tag.lower(), tag),
                             "meta": [el_code(p), f"avg <b>{num(p['Average_Score'])}</b>"
                                      if p.get("Average_Score") is not None else ""]} for p, tag, injury in hit]),
        "hook": f"🚑 Before you lock Round {r}: the priciest names on the injury report",
        "hook_he": f"🚑 לפני שנועלים את מחזור {r}: השחקנים הכי יקרים ברשימת הפציעות",
        "lines": [f"{tag} · {surname(p['PlayerName'])} ({p['Team']}) · {num(p['CR'])} CR" for p, tag, _ in hit],
    }


def post_captain_poll(ctx):
    """A poll before lock. X polls cannot carry an image, so this one is text only."""
    rows = sorted((p for p in healthy(ctx["last5"], ctx["inj"]) if p.get("Average_Score") is not None),
                  key=lambda p: -p["Average_Score"])[:4]
    if len(rows) < 2:
        return None
    r = ctx["round"]
    minutes = int((ctx["lock"] - datetime.now(timezone.utc)).total_seconds() // 60) if ctx.get("lock") else 1440
    return {
        "hook": f"🧢 Captain counts double. Who gets your Round {r} armband? (avg FPT, last 5)",
        "hook_he": f"🧢 הקפטן שווה כפול. למי הסרט במחזור {r}? (ממוצע FPT, 5 אחרונים)",
        "lines": [f"{surname(p['PlayerName'])} {num(p['Average_Score'])}" for p in rows],
        "poll": {"options": [f"{surname(p['PlayerName'])} ({p['Team']})"[:25] for p in rows],
                 "minutes": max(60, min(10080, minutes))},
    }


def scorer_cards(rows, unit="FPT"):
    """Cards for a night's or a round's best fantasy scores."""
    return photo_body([{"pos": x["position"], "name": x["PlayerName"], "team": el_code(x),
                        "line": f"{x['pts']} PTS · {x['reb']} REB · {x['ast']} AST",
                        "big": num(x["fpt"]), "unit": unit, "meta": [f"vs {x['vs']}", cr_meta(x["CR"])]}
                       for x in rows])


def post_top_performers(ctx):
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:MAX_PLAYERS]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": f"Round {r}: top performers",
        "subtitle": "Most fantasy points this round, win bonus included",
        "body": scorer_cards(rows),
        "hook": f"⭐ Round {r}'s biggest fantasy scores, tracked live on EuroGuru:",
        "hook_he": f"⭐ הניקודים הגדולים של מחזור {r}, במעקב חי ב-EuroGuru:",
        "lines": [f"{i}. {surname(x['PlayerName'])} {num(x['fpt'])} FPT ({x['pts']}p {x['reb']}r {x['ast']}a)"
                  for i, x in enumerate(rows, 1)],
    }


def team_of_round(scores):
    rows = sorted(scores, key=lambda x: -x["fpt"])
    team = ([x for x in rows if x["position"] == "G"][:2] + [x for x in rows if x["position"] == "F"][:2]
            + [x for x in rows if x["position"] == "C"][:1])
    if len(team) < 5:
        return None, None, None
    captain = max(team, key=lambda x: x["fpt"])
    total = round(sum(x["fpt"] for x in team) + captain["fpt"], 1)
    return sorted(team, key=lambda x: -x["fpt"]), captain, total


def post_team_of_round(ctx):
    team, captain, total = team_of_round(ctx["scores"])
    if not team:
        return None
    r = ctx["round"]
    return {
        "title": f"Round {r}: team of the round",
        "subtitle": f"Best 2 G · 2 F · 1 C, captain doubled: {num(total)} FPT",
        "body": photo_body([{"pos": x["position"], "name": x["PlayerName"], "team": el_code(x),
                             "line": f"{el_code(x)} vs {x['vs']} · {num(x['CR'])} CR",
                             "big": num(x["fpt"] * (2 if x is captain else 1)),
                             "unit": "FPT ×2" if x is captain else "FPT",
                             "tag": ("c", "C") if x is captain else None} for x in team]),
        "hook": f"🏆 The perfect Round {r} lineup (2G 2F 1C, captain ×2) scored {num(total)} FPT:",
        "hook_he": f"🏆 החמישייה המושלמת של מחזור {r} (2G 2F 1C, קפטן כפול) עשתה {num(total)} FPT:",
        "lines": [f"{x['position']} {surname(x['PlayerName'])} {num(x['fpt'])}{' (C)' if x is captain else ''}" for x in team],
    }


def post_bargains(ctx):
    rows = sorted((x for x in ctx["scores"] if x["CR"] <= 10 and x["fpt"] > 0),
                  key=lambda x: -(x["fpt"] / x["CR"]))[:MAX_PLAYERS]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": f"Round {r}: bargains of the round",
        "subtitle": "Most FPT per credit among players at ≤10 CR",
        "body": photo_body([{"pos": x["position"], "name": x["PlayerName"], "team": el_code(x),
                             "line": f"{num(x['fpt'])} FPT · {num(x['CR'])} CR",
                             "big": num(x["fpt"] / x["CR"], 2), "unit": "FPT / CR",
                             "meta": [f"{el_code(x)} vs {x['vs']}"]} for x in rows]),
        "hook": f"💎 Round {r}'s best value for money - most FPT per credit at ≤10 CR, via EuroGuru:",
        "hook_he": f"💎 התמורה הכי טובה של מחזור {r} - הכי הרבה FPT לקרדיט עד 10 קרדיט, לפי EuroGuru:",
        "lines": [f"{surname(x['PlayerName'])} {num(x['fpt'])} FPT · {num(x['CR'])} CR" for x in rows],
    }


def price_moves(rnd):
    moves = []
    for p in api_get(f"/cr-history?season={SEASON}").get("players", []):
        by_round = {s["round"]: s["cr"] for s in p.get("series", []) if s.get("round") is not None}
        if rnd in by_round and (rnd - 1) in by_round:
            moves.append((p, round(by_round[rnd] - by_round[rnd - 1], 1), by_round[rnd]))
    return moves


def post_price_movers(ctx):
    rnd = ctx["round"]
    moves = price_moves(rnd)
    if not moves:
        ctx["notes"].append(f"price-movers skipped: no CR snapshot for round {rnd} yet - run the fetch and promote first.")
        return None
    # Two risers and the biggest faller: three cards, both directions.
    pick = ([m for m in sorted(moves, key=lambda m: -m[1]) if m[1] > 0][:2]
            + [m for m in sorted(moves, key=lambda m: m[1]) if m[1] < 0][:1])
    if not pick:
        return None
    return {
        "title": f"Round {rnd}: price risers and fallers",
        "subtitle": "Biggest CR changes after the round",
        "body": photo_body([{"pos": p["position"], "name": p["playerName"],
                             "team": DUNKEST_TO_EL.get(str(p["team"]).upper(), p["team"]),
                             "line": DUNKEST_TO_EL.get(str(p["team"]).upper(), p["team"]),
                             "big": f"{'+' if d > 0 else ''}{num(d)}", "unit": "CR", "tone": "up" if d > 0 else "down",
                             "meta": [f"now <b>{num(cr)}</b> CR"]} for p, d, cr in pick]),
        "hook": f"📈📉 Round {rnd} price movers, from EuroGuru's price tracker:",
        "hook_he": f"📈📉 מי עלה ומי ירד אחרי מחזור {rnd}, לפי מעקב המחירים של EuroGuru:",
        "lines": [f"{'▲' if d > 0 else '▼'} {surname(p['playerName'])} {'+' if d > 0 else ''}{num(d)} → {num(cr)} CR"
                  for p, d, cr in pick],
    }


def post_round_thread(ctx):
    """'What we learned' - a short thread; the link sits in its last post."""
    scores = ctx["scores"]
    if not scores:
        return None
    r = ctx["round"]
    top = max(scores, key=lambda x: x["fpt"])
    team, captain, total = team_of_round(scores)
    cheap = [x for x in scores if x["CR"] <= 10 and x["fpt"] > 0]
    bargain = max(cheap, key=lambda x: x["fpt"] / x["CR"]) if cheap else None
    expensive = sorted((x for x in scores if x["CR"] >= 14), key=lambda x: x["fpt"])
    flop = expensive[0] if expensive else None
    en = [f"🧵 What Round {r} taught us about EuroLeague Fantasy 👇",
          f"1/ {top['PlayerName']} owned the round: {num(top['fpt'])} FPT ({top['pts']}p {top['reb']}r {top['ast']}a) vs {top['vs']}."]
    he = [f"🧵 מה למדנו ממחזור {r} בפנטזי יורוליג 👇",
          f"1/ {top['PlayerName']} היה השחקן של המחזור: {num(top['fpt'])} FPT ({top['pts']}p {top['reb']}r {top['ast']}a)."]
    if team:
        en.append(f"2/ The perfect lineup (2G 2F 1C, {surname(captain['PlayerName'])} as captain) scored {num(total)} FPT.")
        he.append(f"2/ החמישייה המושלמת (2G 2F 1C, עם {surname(captain['PlayerName'])} כקפטן) הייתה עושה {num(total)} FPT.")
    if bargain:
        en.append(f"3/ Bargain of the round: {bargain['PlayerName']} gave {num(bargain['fpt'])} FPT for only {num(bargain['CR'])} CR.")
        he.append(f"3/ המציאה של המחזור: {bargain['PlayerName']} נתן {num(bargain['fpt'])} FPT בשביל {num(bargain['CR'])} קרדיט בלבד.")
    if flop:
        en.append(f"4/ The pricey miss: {flop['PlayerName']} ({num(flop['CR'])} CR) managed just {num(flop['fpt'])} FPT.")
        he.append(f"4/ האכזבה היקרה: {flop['PlayerName']} ({num(flop['CR'])} קרדיט) סיים עם {num(flop['fpt'])} FPT בלבד.")
    return {"thread": en, "thread_he": he}


def post_game_night(ctx):
    """The night's top 3 once the day's games are final."""
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:MAX_PLAYERS]
    if not rows:
        return None
    day = ctx["night"]
    label = day.strftime("%A")
    return {
        "title": f"{label} night: top fantasy performers",
        "subtitle": f"Round {ctx['round']} · {len(ctx['night_games'])} game{'s' if len(ctx['night_games']) != 1 else ''}, win bonus included",
        "body": scorer_cards(rows),
        "hook": f"🌙 {label} night in fantasy points, tracked live on EuroGuru (Round {ctx['round']}):",
        "hook_he": f"🌙 הערב בנקודות פנטזי, במעקב חי ב-EuroGuru (מחזור {ctx['round']}):",
        "lines": [f"{i}. {surname(x['PlayerName'])} {num(x['fpt'])} FPT ({x['pts']}p {x['reb']}r {x['ast']}a)"
                  for i, x in enumerate(rows, 1)],
    }


def post_live(ctx):
    """Right now, in the games being played: made for replying under game posts."""
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:MAX_PLAYERS]
    if not rows:
        return None
    return {
        "title": "Live: tonight's fantasy leaders",
        "subtitle": "Current fantasy points in the games being played right now",
        "body": scorer_cards(rows, unit="FPT live"),
        "hook": "🔴 Live on EuroGuru right now - tonight's fantasy leaders:",
        "hook_he": "🔴 בזמן אמת ב-EuroGuru - המובילים בפנטזי הערב:",
        "lines": [f"{surname(x['PlayerName'])} {num(x['fpt'])} FPT ({x['pts']}p {x['reb']}r {x['ast']}a)" for x in rows],
    }


PRE = [("consistent-by-position", post_consistent), ("hot-hand", post_hot), ("budget-picks", post_budget),
       ("value-kings", post_value), ("injury-watch", post_injuries), ("smart-picks", post_smart),
       ("captain-poll", post_captain_poll)]
POST = [("round-top-performers", post_top_performers), ("team-of-the-round", post_team_of_round),
        ("round-thread", post_round_thread), ("round-bargains", post_bargains), ("price-movers", post_price_movers)]
NIGHT = [("game-night", post_game_night)]
LIVE = [("live-leaders", post_live)]

# The game's own hashtag plus the one the official account (@EBF_Official) uses.
TAG = "#EuroLeagueFantasy #EBF"

# Every post ends by handing the conversation to the reader: a question people have an
# opinion on, so the replies fill with debate - which is what X rewards with reach.
DEBATE = {
    "consistent-by-position": ("Safe or boring? Who did we miss? 👇",
                               "רצפה בטוחה או משעמם? מי השחקן היציב ששכחנו? 👇"),
    "hot-hand": ("Ride the hot hand or sell high? Who cools off first? 👇",
                 "רוכבים על הכושר או מוכרים בשיא? מי יתקרר ראשון? 👇"),
    "budget-picks": ("Which cheap pick are you riding? 👇",
                     "על איזו מציאה אתם הולכים המחזור? 👇"),
    "value-kings": ("Who's the steal of the season so far? 👇", "מי הגניבה של העונה עד עכשיו? 👇"),
    "injury-watch": ("Hold or sell? What are you doing with them? 👇", "מחזיקים או מוכרים? מה אתם עושים איתם? 👇"),
    "smart-picks": ("Which one would you fade - and who's missing? 👇", "על מי הייתם מוותרים, ומי חסר? 👇"),
    "captain-poll": ("Got a differential captain? Drop him below 👇", "יש לכם קפטן מפתיע? כתבו למטה 👇"),
    "round-top-performers": ("How many of them did you have? 👇", "כמה מהם היו לכם? 👇"),
    "team-of-the-round": ("How close did your team get? Drop your score 👇", "כמה קרובה הייתה הקבוצה שלכם? כתבו את הניקוד 👇"),
    "round-bargains": ("Who's buying them for next round? 👇", "מי קונה אותם למחזור הבא? 👇"),
    "price-movers": ("Buy the dip or sell the rise? 👇", "קונים בירידה או מוכרים בעלייה? 👇"),
    "game-night": ("Who was your MVP tonight? 👇", "מי היה ה-MVP שלכם הערב? 👇"),
    "live-leaders": ("Who's carrying your team tonight? 👇", "מי סוחב לכם את הקבוצה הערב? 👇"),
    "round-thread": ("What did Round {r} teach you? 👇", "מה למדתם ממחזור {r}? 👇"),
}
REPLY = {"en": "Live fantasy points, stats & smart picks, free 👉 {url}",
         "he": "נקודות פנטזי בזמן אמת, סטטיסטיקות והמלצות, בחינם 👉 {url}"}


def utm(campaign, lang):
    return f"{SITE}/?utm_source=x{'-he' if lang == 'he' else ''}&utm_medium=social&utm_campaign={campaign}"


def compose(post_id, card, campaign):
    """The tweets for one post, in both languages. The link always goes in a reply:
    X shows posts with outside links to far fewer people."""
    out = {}
    for lang in ("en", "he"):
        reply = REPLY[lang].format(url=utm(campaign, lang))
        question = DEBATE.get(post_id, ("", ""))[0 if lang == "en" else 1]
        if "thread" in card:
            thread = card["thread" if lang == "en" else "thread_he"]
            round_no = re.search(r"\d+", campaign).group().lstrip("0")
            out[lang] = {"thread": [*thread, question.format(r=round_no), reply]}
            continue
        hook = card["hook" if lang == "en" else "hook_he"]
        insight = card.get("insight" if lang == "en" else "insight_he")
        # The image carries the full list, so when the text runs long the last player
        # lines go - never the hook, the punchline or the question.
        lines = list(card["lines"])
        while True:
            main = "\n".join(x for x in [hook, "", *lines, "", insight, question, "", TAG] if x is not None)
            main = re.sub(r"\n{3,}", "\n\n", main)
            if x_length(main) <= 275 or len(lines) <= 3:
                break
            lines.pop()
        out[lang] = {"main": main, "reply": reply}
        if card.get("poll"):
            out[lang]["poll"] = card["poll"]
    return out


# --- rendering ---------------------------------------------------------------------

def render(card, badge, png):
    page = (SKILL / "card.html").read_text()
    for key, value in {"css": (SKILL / "card.css").as_uri(), "mascot": MASCOT.as_uri(), "badge": html.escape(badge),
                       "title": html.escape(card["title"]), "subtitle": html.escape(card["subtitle"]),
                       "body": card["body"]}.items():
        page = page.replace("{{" + key + "}}", value)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, dir=png.parent) as fh:
        fh.write(page)
        tmp = Path(fh.name)
    try:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        "--window-size=1200,675", "--virtual-time-budget=3000", "--allow-file-access-from-files",
                        f"--screenshot={png}", tmp.as_uri()],
                       check=True, capture_output=True, timeout=90)
    finally:
        tmp.unlink(missing_ok=True)


# --- running a batch ---------------------------------------------------------------

def reddit_draft(rnd, posts, out):
    """A Reddit-friendly recap: data first, the link only at the end."""
    lines = [f"# Round {rnd} EuroLeague Fantasy recap: top performers, team of the round and bargains", ""]
    for post_id in ("round-top-performers", "team-of-the-round", "round-bargains", "price-movers"):
        card = posts.get(post_id)
        if not card:
            continue
        items = [re.sub(r"^\d+\. ", "", l) for l in card["card"]["lines"]]
        lines += [f"**{card['card']['title']}**", "", *[f"{i}. {l}" for i, l in enumerate(items, 1)], ""]
    lines += ["---", f"Numbers from EuroGuru, a free EuroLeague Fantasy stats site ({SITE}). Happy to answer questions."]
    (out / "reddit.md").write_text("\n".join(lines) + "\n")


def generate(mode, rnd=None, only=None, night=None):
    """Build one batch. Returns (round, output dir, {id: post}). Each post gets its own
    folder: post.md (its text in both languages) and <id>.png when it has an image."""
    if not Path(CHROME).exists():
        raise SystemExit(f"Google Chrome not found at {CHROME} - needed to render the images.")
    games = schedule()
    if mode == "pre":
        rnd = rnd or next_round(games)
    elif mode == "post":
        rnd = rnd or last_finished_round(games)
    elif mode in ("night", "live"):
        rnd = rnd or (night_round(games, night) if mode == "night" else live_round(games))
    if rnd is None:
        raise SystemExit("No round to cover right now.")

    season = stats(100)
    ctx = {"round": rnd, "season": season, "notes": []}
    if mode == "pre":
        # The ranking pools: only players with more than half of their club's games.
        ctx.update(last3=stats(3, True), last5=stats(5, True), regulars=stats(100, True), inj=injuries(),
                   lock=min((g["tipoff"] for g in games if g["round"] == rnd), default=None))
        catalogue, badge, sub = PRE, f"Round {rnd} · Preview", "pre"
    elif mode == "post":
        ctx["scores"] = round_scores(games, rnd, season)
        if not ctx["scores"]:
            raise SystemExit(f"Round {rnd} has no boxscores yet.")
        catalogue, badge, sub = POST, f"Round {rnd} · Recap", "post"
    elif mode == "night":
        day = night or datetime.now(PARIS).date()
        tonight = [g for g in games if g["tipoff"].astimezone(PARIS).date() == day]
        ctx.update(night=day, night_games=tonight, scores=round_scores(tonight, None, season))
        catalogue, badge, sub = NIGHT, f"Round {rnd} · Game night", f"night-{day.isoformat()}"
    else:
        now = datetime.now(timezone.utc)
        on = [g for g in games if g["tipoff"] <= now <= g["tipoff"] + timedelta(hours=3)]
        ctx["scores"] = round_scores(on, None, season)  # games already final get their win bonus
        catalogue, badge, sub = LIVE, "Live now", f"live-{now.astimezone(PARIS):%Y%m%d-%H%M}"

    out = OUT_ROOT / f"round-{rnd:02d}" / sub
    out.mkdir(parents=True, exist_ok=True)
    made = {}
    for post_id, build in catalogue:
        if only and post_id not in only:
            continue
        try:
            card = build(ctx)
        except Exception as exc:  # one broken post should not sink the batch
            ctx["notes"].append(f"{post_id} failed: {exc}")
            continue
        if not card:
            continue
        campaign = f"r{rnd:02d}-{post_id}"
        tweets = compose(post_id, card, campaign)
        folder = out / post_id
        folder.mkdir(exist_ok=True)
        post = {"id": post_id, "round": rnd, "mode": mode, "tweets": tweets, "image": None,
                "title": card.get("title") or post_title(post_id), "folder": folder, "card": card}
        if "body" in card:
            png = folder / f"{post_id}.png"
            render(card, badge, png)
            post["image"] = png
        write_post_md(post)
        made[post_id] = post

    write_batch_index(rnd, mode, out, made, ctx["notes"])
    if mode == "post" and not only:
        reddit_draft(rnd, made, out)
    return rnd, out, made, ctx["notes"]


def tweet_lengths(tweets):
    texts = []
    for lang in ("en", "he"):
        t = tweets[lang]
        texts += t.get("thread") or [t["main"], t["reply"]]
    return max(x_length(t) for t in texts)


BATCH_TITLE = {"pre": "preview", "post": "recap", "night": "game night", "live": "live"}


def post_title(post_id):
    return post_id.replace("-", " ").capitalize()


def _fence(text):
    return ["```", text, "```"]


def post_text_md(post, lang="en", heading="###"):
    """The copy-ready parts of one post in one language, as markdown."""
    t = post["tweets"][lang]
    md = []
    if t.get("thread"):
        md += [f"{heading} Thread - post each part as a reply to the previous one", ""]
        for n, part in enumerate(t["thread"], 1):
            md += [f"{n}.", *_fence(part), ""]
        return md
    md += [f"{heading} Post", "", *_fence(t["main"]), ""]
    if t.get("poll"):
        md += [f"Add a poll in X's composer: **{' / '.join(t['poll']['options'])}** "
               "(open until the round locks). Polls cannot carry an image.", ""]
    md += [f"{heading} Then reply to your own post with (the link goes here)", "", *_fence(t["reply"]), ""]
    return md


def _length_note(post):
    longest = tweet_lengths(post["tweets"])
    return f"⚠️ {longest} characters - over X's 280 limit, trim before posting." if longest > 280 else None


def write_post_md(post, when=None, core=None):
    """post.md in the post's own folder: everything needed to post it by hand."""
    md = [f"# {post['title']}", ""]
    meta = [f"Round {post['round']} · {BATCH_TITLE.get(post['mode'], post['mode'])}"]
    if when:
        meta.append(f"post **{when}**")
    if core:
        meta.append("★ core post")
    md += [" · ".join(meta), ""]
    if post.get("image"):
        name = Path(post["image"]).name
        md += [f"Attach: `{name}`", "", f"![{post['id']}]({name})", ""]
    md += post_text_md(post, "en", "##")
    if _length_note(post):
        md += [_length_note(post), ""]
    md += ["---", "", "## עברית (Hebrew)", ""]
    md += post_text_md(post, "he", "###")
    (Path(post["folder"]) / "post.md").write_text("\n".join(md) + "\n")


def write_batch_index(rnd, mode, out, made, notes):
    """POSTS.md for one batch: its posts in catalogue order, English text inline.
    Folders from earlier runs (a partial --only re-run) are linked, not dropped."""
    md = [f"# Round {rnd} · {BATCH_TITLE[mode]} posts", f"Generated {datetime.now():%a %d %b, %H:%M}.", ""]
    for n, post in enumerate(made.values(), 1):
        md += [f"## {n}. {post['title']}", f"Folder: [`{post['id']}/`]({post['id']}/post.md)", ""]
        if post.get("image"):
            md += [f"![{post['id']}]({post['id']}/{Path(post['image']).name})", ""]
        md += post_text_md(post)
    # Originals (originals.py) have their own menu; their folders are not "earlier runs".
    menu = (out / "ORIGINALS.md").read_text() if (out / "ORIGINALS.md").exists() else ""
    others = sorted(d.name for d in out.iterdir() if (d / "post.md").exists() and d.name not in made
                    and f"({d.name}/post.md)" not in menu)
    if others:
        md += ["## From earlier runs", *[f"- [{d}]({d}/post.md)" for d in others], ""]
    if menu:
        md += ["## ✦ Originals", "One-off posts in their own formats: [ORIGINALS.md](ORIGINALS.md).", ""]
    if notes:
        md += ["## Notes", *[f"- {x}" for x in notes]]
    (out / "POSTS.md").write_text("\n".join(md) + "\n")


# --- prepare: everything for right now, and the plan ---------------------------------

# The posts worth a minute of manual posting, in the order they go out. The rest of the
# catalogue is generated too and listed as optional.
CORE = {"budget-picks", "hot-hand", "captain-poll", "game-night", "team-of-the-round"}

# Each batch's originals (originals.py) add a block like this to the end of social/POSTS.md;
# write_plan() keeps it for as long as its batch is current.
ORIGINALS_BLOCK = re.compile(r"<!-- originals (\S+) -->.*?<!-- /originals -->", re.S)
ORIGINALS_NOTE = "✦ **Originals** - one-off posts in their own formats - are at the end."


def _local(dt):
    return dt.astimezone().strftime("%a %d %b, %H:%M")


def _next_morning(dt, hour=9):
    """The next morning at `hour`, local time, after an instant."""
    local = dt.astimezone()
    day = local.date() + timedelta(days=1 if local.hour >= 4 else 0)
    return datetime.combine(day, datetime.min.time()).replace(hour=hour).astimezone()


def prepare():
    """Work out where the season is, generate what is relevant now, and write the plan:
    what to post, when, from which files."""
    games = schedule()
    now = datetime.now(timezone.utc)
    items = []  # (when, post, core, path)
    notes = []

    def add(when, post, folder):
        items.append((when, post, post["id"] in CORE, folder))

    # 1. A round that just finished: its recap.
    done = last_finished_round(games)
    if done:
        last = max(g["tipoff"] for g in games if g["round"] == done)
        if now - last < timedelta(hours=36):  # a recap older than that is stale
            _, out, made, n = generate("post", done)
            notes += n
            morning = _next_morning(last + timedelta(hours=2))
            slots = {"team-of-the-round": morning, "round-top-performers": morning,
                     "round-thread": morning + timedelta(hours=4), "round-bargains": morning + timedelta(hours=9),
                     "price-movers": morning + timedelta(days=1, hours=3)}
            for pid, post in made.items():
                add(max(slots.get(pid, morning), now), post, out)

    # 2. Game nights that have finished in the last 14 hours.
    for day in sorted({g["tipoff"].astimezone(PARIS).date() for g in games}):
        tonight = [g for g in games if g["tipoff"].astimezone(PARIS).date() == day]
        end = max(g["tipoff"] for g in tonight) + timedelta(hours=2.5)
        if end <= now <= end + timedelta(hours=14):
            _, out, made, n = generate("night", tonight[0]["round"], night=day)
            notes += n
            for post in made.values():
                add(now, post, out)

    # 3. The next round, if it has not locked yet: its preview.
    nxt = next_round(games)
    first = min((g["tipoff"] for g in games if g["round"] == nxt), default=None)
    if first and first > now:
        _, out, made, n = generate("pre", nxt)
        notes += n
        slots = {"budget-picks": first - timedelta(hours=48), "consistent-by-position": first - timedelta(hours=46),
                 "hot-hand": first - timedelta(hours=26), "value-kings": first - timedelta(hours=24),
                 "injury-watch": first - timedelta(hours=8), "smart-picks": first - timedelta(hours=6),
                 "captain-poll": first - timedelta(hours=5)}
        for pid, post in made.items():
            add(max(slots.get(pid, now), now), post, out)
        nights = sorted({g["tipoff"].astimezone(PARIS).date() for g in games if g["round"] == nxt})
        notes.append(f"Round {nxt} locks {_local(first)}. Game nights: "
                     + ", ".join(d.strftime("%a %d %b") for d in nights)
                     + " - run /euroguru-social again after each night's games for its top-5 post.")
    elif first:
        notes.append(f"Round {nxt} is in progress - run again after each game night, and after the round for its recap.")

    items.sort(key=lambda i: (i[0], not i[2]))
    write_plan(items, notes, now)
    return items, notes


def write_plan(items, notes, now):
    """social/POSTS.md: every post that fits now, in posting order - a menu to choose
    from. Each post's own folder (post.md + image) has the Hebrew version too."""
    def label(when):
        return "now" if when <= now + timedelta(minutes=30) else _local(when)

    def rel(path):
        return Path(path).relative_to(OUT_ROOT).as_posix()

    plan = OUT_ROOT / "POSTS.md"
    batches = {rel(out) for *_, out in items}
    kept = [m.group(0) for m in ORIGINALS_BLOCK.finditer(plan.read_text() if plan.exists() else "")
            if m.group(1) in batches]

    md = ["# EuroGuru posts", f"Prepared {_local(now)}. Times are your local time. "
          "★ = core posts; the rest are optional. Pick what you want to post.", "",
          "| # | When | Post | Image | Folder |", "|---|---|---|---|---|"]
    for n, (when, post, core, _) in enumerate(items, 1):
        img = "🖼️" if post.get("image") else ("poll" if post["tweets"]["en"].get("poll") else "text")
        md.append(f"| {n} | {label(when)} | {'★ ' if core else ''}{post['title']} | {img} "
                  f"| [{rel(post['folder'])}]({rel(post['folder'])}/post.md) |")
    md.append("")
    if kept:
        md += [ORIGINALS_NOTE, ""]
    for n, (when, post, core, _) in enumerate(items, 1):
        write_post_md(post, label(when), core)
        md += ["---", "", f"## {n}. {'★ ' if core else ''}{post['title']} - post {label(when)}",
               f"Folder: [`{rel(post['folder'])}/`]({rel(post['folder'])}/post.md) (Hebrew version in post.md)", ""]
        if post.get("image"):
            md += [f"Attach: `{rel(post['image'])}`", "", f"![{post['id']}]({rel(post['image'])})", ""]
        md += post_text_md(post)
        if _length_note(post):
            md += [_length_note(post), ""]
    for block in kept:
        md += [block, ""]
    if notes:
        md += ["---", "", "## Notes", *[f"- {x}" for x in notes]]
    plan.write_text("\n".join(md) + "\n")
    (OUT_ROOT / "PLAN.md").unlink(missing_ok=True)  # replaced by POSTS.md


def render_page(template, size, png, scale=2):
    """Render a static brand page (no data) in the post cards' look."""
    png.parent.mkdir(parents=True, exist_ok=True)
    page = (SKILL / template).read_text()
    page = page.replace("{{css}}", (SKILL / "card.css").as_uri()).replace("{{mascot}}", MASCOT.as_uri())
    tmp = png.parent / f"_{png.stem}.html"
    tmp.write_text(page)
    try:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--force-device-scale-factor={scale}",
                        f"--window-size={size[0]},{size[1]}", "--virtual-time-budget=3000", "--allow-file-access-from-files",
                        f"--screenshot={png}", tmp.as_uri()], check=True, capture_output=True, timeout=90)
    finally:
        tmp.unlink(missing_ok=True)
    return png


def render_banner():
    """The X profile banner (1500x500)."""
    return render_page("banner.html", (1500, 500), OUT_ROOT / "profile" / "banner.png")


def render_og():
    """The site's link preview (og:image), the card under every shared link: exactly
    1200x630, as index.html declares. Written straight into frontend/public."""
    return render_page("og.html", (1200, 630), REPO / "frontend" / "public" / "og-image.png", scale=1)


# --- the team card: a whole squad on a court ------------------------------------------
# The game's squad (Dunkest's Classic mode): 4 G, 4 F, 2 C and a head coach. Each round
# the starting five - one of five formations - scores 100% with the captain (a starter)
# doubled, the sixth man and the coach 100%, the other four on the bench 50%.

RESULTS_URL = f"https://api-live.euroleague.net/v1/results?seasonCode=E{SEASON}"
SQUAD = {"G": 4, "F": 4, "C": 2}
# G-F-C. The sixth man scores 100% too, so formations often tie: the first wins, which
# starts both centers when that costs nothing.
FORMATIONS = [(2, 1, 2), (1, 2, 2), (2, 2, 1), (1, 3, 1), (3, 1, 1)]
MAX_PER_CLUB = 6
# A coach is valued on his club's next game. Club ratings come from this season's point
# margins - home edge taken out, opponents adjusted for, shrunk toward average - and the
# constants were calibrated on the 2024-25 and 2025-26 regular seasons, predicting each
# round from the ones before it: home clubs win by 3.3 on average, a predicted margin
# misses by about 12, and shrinking as if every club had 7 more average games predicts
# best. That beat a coach's season average of points (13.3 vs 12.1 coach-points error).
HOME_EDGE = 3.3
MARGIN_SD = 12.0
RATING_SHRINK = 7
# A player's form the way the Recommendations tab ranks him (recommend_players_v2 in
# backend/utils/recommendations.py): his last few games, the newest counting 1, the one
# before 0.85, then 0.85², ... (its Alpha), less the standard error of those games (its
# Consistency weight). Its third part, FPT per CR, is left out: the budget already prices
# every player exactly, and counting cost twice would tilt the squad to cheap players.
FORM_ALPHA = 0.85
RAW_ROWS_CAP = 2000  # /stats returns at most this many raw game rows per call
# The default valuation, chosen by backtest: every 2025-26 regular-season round from 4 on,
# plus 2026 so far, the exact best squad under each formula (data before the round only),
# scored on what then happened. A player's expected FPT = the chance he plays (the share of
# his club's last AVAIL_GAMES games he played) x his season average pulled toward what his
# price implies, as if he had played SHRINK_GAMES more games at that level. At 105 CR it
# averaged 134 a round, against 123 on season averages and 126 on the Recommendations form,
# and it won at every budget from 100 to 120 CR. Penalising inconsistency (std) only cost
# points, and so did matchups and recent form at full weight. Its squads still came in ~18
# under their projection (the best-looking players are the luckiest: PROJECTION_GAP), and no
# formula reached 200 in a typical round - at 105 CR, 180+ came in about 1 round in 8.
SHRINK_GAMES = 6
AVAIL_GAMES = 5
PROJECTION_GAP = 18
FLOOR_W, FLOOR_H = 1088, 760  # court.html's floor, px
ROW_TOP = {"C": 132, "F": 338, "G": 548}  # where each position's starters stand, basket end first


def coach_points(margin):
    """A coach scores on the club's result alone - the table in backend/utils/coaches.py."""
    if margin > 0:
        return 25 if margin >= 21 else 20 if margin >= 11 else 10
    return -20 if margin <= -21 else -10 if margin <= -11 else -5


def results():
    """Every finished game: (round, home, away, home margin), Euroleague codes."""
    out = []
    for game in ET.fromstring(fetch(RESULTS_URL)).findall("game"):
        if (game.findtext("played") or "").strip().lower() == "true":
            out.append((int(game.findtext("gameday")), game.findtext("homecode").strip(),
                        game.findtext("awaycode").strip(),
                        int(game.findtext("homescore")) - int(game.findtext("awayscore"))))
    return out


def coach_rounds(played):
    """Euroleague club code -> {round: coach FPT}."""
    out = {}
    for rnd, home, away, margin in played:
        out.setdefault(home, {})[rnd] = coach_points(margin)
        out.setdefault(away, {})[rnd] = coach_points(-margin)
    return out


def club_ratings(played):
    """Points better than an average club on a neutral floor: each club's margins with the
    home edge taken out and the opponent's rating added back, shrunk toward 0."""
    clubs = {c for _, home, away, _ in played for c in (home, away)}
    rating = dict.fromkeys(clubs, 0.0)
    for _ in range(100):
        for club in clubs:
            total, n = 0.0, 0
            for _, home, away, margin in played:
                if club == home:
                    total, n = total + margin - HOME_EDGE + rating[away], n + 1
                elif club == away:
                    total, n = total - margin + HOME_EDGE + rating[home], n + 1
            rating[club] = total / (n + RATING_SHRINK)
        mean = sum(rating.values()) / len(rating)
        rating = {c: v - mean for c, v in rating.items()}
    return rating


def coach_outlook(margin):
    """(expected coach points, chance of a win) when the club's margin is expected to be
    `margin`, give or take MARGIN_SD - each band of the scoring table times its chance."""
    def below(x):
        return 0.5 * (1 + math.erf((x - margin) / (MARGIN_SD * math.sqrt(2))))
    bands = [(-math.inf, -20.5, -20), (-20.5, -10.5, -10), (-10.5, 0, -5),
             (0, 10.5, 10), (10.5, 20.5, 20), (20.5, math.inf, 25)]
    return sum(pts * (below(hi) - below(lo)) for lo, hi, pts in bands), 1 - below(0)


def game_scores():
    """Player name -> [(round, FPT)] for every game he played, newest first (the stats
    feed's raw rows)."""
    logs = {}
    for k in SQUAD:
        rows = api_post("/stats", {"season": SEASON, "position": k, "min_cr": 0, "max_cr": 100, "last_x_games": 0})
        if len(rows) >= RAW_ROWS_CAP:
            sys.exit(f"/stats capped the {k} game rows at {RAW_ROWS_CAP} - fetch them in CR bands")
        for g in rows:
            if g.get("GameCode") is not None:
                logs.setdefault(g["PlayerName"], []).append(g)
    return {name: [(int(g["Round"]), g["Score"] or 0.0) for g in sorted(games, key=lambda g: -g["GameCode"])]
            for name, games in logs.items()}


def squad_pool(valuation="expected", form=3, consistency=1.0, played=None):
    """Every priced player as the squad search sees him. `fpt` is what he is expected to
    score, `value` what the search maximizes:
    - "expected" (default): availability x season average shrunk to his price (SHRINK_GAMES);
    - "form": the Recommendations tab's ranking over his last `form` games (FORM_ALPHA) -
      `fpt` his momentum average, `value` that less `consistency` x its standard error;
    - "avg": both his season average.
    `played` is results(), for the club games he could have played."""
    inj = injuries()
    logs = game_scores() if valuation != "avg" else {}
    pool = []
    for p in stats(100):
        avg = p["Average_Score"] or 0.0
        entry = {"name": p["PlayerName"], "pos": p["position"], "club": p["Team"], "team": el_code(p),
                 "cr": p["CR"], "avg": avg, "fpt": avg, "value": avg, "games": p["GamesPlayed"] or 0,
                 "out": name_parts(p["PlayerName"]) in inj}
        if valuation == "form":
            recent = [x for _, x in logs.get(p["PlayerName"], [])][:form]
            weights = [FORM_ALPHA ** i for i in range(len(recent))]
            momentum = sum(x * w for x, w in zip(recent, weights)) / sum(weights) if recent else 0.0
            se = statistics.stdev(recent) / math.sqrt(len(recent)) if len(recent) > 1 else 0.0
            entry.update(fpt=momentum, value=momentum - consistency * se, se=se, recent=recent)
        pool.append(entry)
    if valuation == "expected":
        club_rounds = {}
        for rnd, home, away, _ in played if played is not None else results():
            club_rounds.setdefault(home, set()).add(rnd)
            club_rounds.setdefault(away, set()).add(rnd)
        # What a price buys this season: a line through every regular's (price, average).
        regulars = [q for q in pool if q["games"] >= 3]
        slope, icept = statistics.linear_regression([q["cr"] for q in regulars], [q["avg"] for q in regulars])
        for entry in pool:
            mine = {r for r, _ in logs.get(entry["name"], [])}
            since = sorted(r for r in club_rounds.get(entry["team"], ()) if mine and r >= min(mine))[-AVAIL_GAMES:]
            avail = sum(r in mine for r in since) / len(since) if since else 0.0
            n = len(mine)
            est = (n * entry["avg"] + SHRINK_GAMES * (icept + slope * entry["cr"])) / (n + SHRINK_GAMES)
            entry.update(fpt=avail * est, value=avail * est, avail=(sum(r in mine for r in since), len(since)))
    return pool


def coach_pool(rounds, rating, fixtures):
    """Every coach, valued on his club's next game (`fixtures`: the next round's (home,
    away) pairs); a club without a game that round scores 0. `avg` is the season so far."""
    nxt = {}
    for home, away in fixtures:
        edge = rating.get(home, 0.0) - rating.get(away, 0.0) + HOME_EDGE
        nxt[home], nxt[away] = (away, True, edge), (home, False, -edge)
    dunkest = {el: dk for dk, el in DUNKEST_TO_EL.items()}
    coaches = []
    for c in api_get(f"/coaches?season={SEASON}"):
        pts = list(rounds.get(c["TeamCode"], {}).values())
        opp, home, margin = nxt.get(c["TeamCode"], (None, None, 0.0))
        proj, win = coach_outlook(margin) if opp else (0.0, 0.0)
        coaches.append({"name": c["CoachName"], "club": c["Team"], "team": c["TeamCode"], "cr": c["CR"],
                        "avg": sum(pts) / len(pts) if pts else 0.0, "proj": proj, "win": win,
                        "margin": margin, "opp": dunkest.get(opp, opp), "home": home})
    return coaches


def find_player(pool, name):
    """A player by 'Vezenkov', 'S. Vezenkov' or, when a surname is shared, the feed's own
    'D. Hall (MIL)'; exits when that is nobody or several."""
    exact = [p for p in pool if p["name"].lower() == name.strip().lower()]
    initial, last = name_parts(name)
    hits = exact or [p for p in pool if name_parts(p["name"])[1] == last and initial in ("", name_parts(p["name"])[0])]
    if len(hits) != 1:
        sys.exit(f"--with {name!r} matches {[p['name'] for p in hits] or 'nobody'}")
    return hits[0]


def lineup(squad, key="value", captain=None):
    """The best way to field a squad on `key`: (score, starters, captain, sixth man, bench).
    A given `captain` starts and wears the armband."""
    by_pos = {k: sorted((p for p in squad if p["pos"] == k), key=lambda p: (p is not captain, -p[key])) for k in SQUAD}
    best = None
    for ng, nf, nc in FORMATIONS:
        starters = by_pos["G"][:ng] + by_pos["F"][:nf] + by_pos["C"][:nc]
        on = {id(p) for p in starters}
        rest = sorted((p for p in squad if id(p) not in on), key=lambda p: -p[key])
        cap = captain if captain is not None else max(starters, key=lambda p: p[key])
        score = (sum(p[key] for p in starters) + cap[key] + rest[0][key]
                 + sum(p[key] for p in rest[1:]) / 2)
        if best is None or score > best[0] + 1e-9:
            best = (score, starters, cap, rest[0], rest[1:])
    return best


def best_squad(pool, coaches, budget, lock=(), min_c=0.0, min_games=1, captain=None, core=None):
    """The squad and coach with the highest round score within the budget - exactly:
    players on their `value`, the coach on his next game. A round's score is a weighted sum (captain 2, the other starters and
    the sixth man 1, the bench 0.5), so players and roles are picked together: for each
    position, every best (cost, points) set for each mix of roles; then the mixes that make
    a legal lineup - a captain and five more at 100%, every position among those six - are
    joined under the budget. Locked players are always in; everyone else is healthy, has
    `min_games` games, and a center's `fpt` is at least `min_c`. `captain` (one of `lock`)
    wears the armband; `core` = {position: (n, floor)} asks for at least n players there
    whose `fpt` is floor or more. The roles come back fielded on `fpt` (lineup()), `score`
    with them; None when nothing fits the budget."""
    def unit(cr):  # prices have one decimal
        return round(cr * 10)

    limit = unit(budget)
    locked = {id(p) for p in lock}
    allowed = {k: [p for p in pool if p["pos"] == k and id(p) not in locked and not p["out"]
                   and p["games"] >= min_games and (k != "C" or p["fpt"] >= min_c)] for k in SQUAD}
    for k, n in SQUAD.items():
        mine = sum(p["pos"] == k for p in lock)
        if mine > n or len(allowed[k]) < n - mine:
            sys.exit(f"Can't fill {n} {k} spots with these rules")
    # A player beaten on both price and value by as many others as there are spots can
    # always be swapped for one of them, so only the rest are considered.
    cand = {k: [p for p in v if sum(q is not p and q["cr"] <= p["cr"] and q["value"] >= p["value"] for q in v) < SQUAD[k]]
            for k, v in allowed.items()}

    def pareto(entries):
        out, top = [], float("-inf")
        for e in sorted(entries, key=lambda e: (e[0], -e[1])):
            if e[1] > top + 1e-9:
                out.append(e)
                top = e[1]
        return out

    def position(k):
        """(captains, at 100%, at 50%) -> [(cost, points, picks)], cheapest first. The state
        also counts core players (capped at the number needed)."""
        need, floor = (core or {}).get(k, (0, 0.0))
        front = {(0, 0, 0, 0): [(0, 0.0, ())]}
        for p in [q for q in lock if q["pos"] == k] + cand[k]:
            good = int(need > 0 and p["fpt"] >= floor)
            roles = ((1, 0, 0, 2.0),) if p is captain else (((1, 0, 0, 2.0),) if captain is None else ()) + ((0, 1, 0, 1.0), (0, 0, 1, 0.5))
            nxt = {} if id(p) in locked else {s: list(v) for s, v in front.items()}
            for (c, f, h, n), entries in front.items():
                for dc, df, dh, w in roles:
                    s = (c + dc, f + df, h + dh, min(need, n + good))
                    if s[0] <= 1 and sum(s[:3]) <= SQUAD[k]:
                        nxt.setdefault(s, []).extend((cost + unit(p["cr"]), pts + w * p["value"], picks + (p,))
                                                     for cost, pts, picks in entries if cost + unit(p["cr"]) <= limit)
            front = {s: pareto(v) for s, v in nxt.items()}
        return {s[:3]: v for s, v in front.items() if sum(s[:3]) == SQUAD[k] and s[3] >= need}

    fronts = {k: position(k) for k in SQUAD}
    # The centers and the coach together: for each mix, the best within every budget left.
    tail = {}
    for s, entries in fronts["C"].items():
        within = [None] * (limit + 1)
        for cost, pts, picks in entries:
            for coach in coaches:
                b = cost + unit(coach["cr"])
                if b <= limit and (within[b] is None or pts + coach["proj"] > within[b][0]):
                    within[b] = (pts + coach["proj"], picks, coach)
        run = None
        for b in range(limit + 1):
            if within[b] is not None and (run is None or within[b][0] > run[0]):
                run = within[b]
            within[b] = run
        tail[s] = within

    best = None
    for sg, gs in fronts["G"].items():
        for sf, fs in fronts["F"].items():
            for sc, within in tail.items():
                if (sg[0] + sf[0] + sc[0] != 1 or sg[1] + sf[1] + sc[1] != 5
                        or min(sg[0] + sg[1], sf[0] + sf[1], sc[0] + sc[1]) < 1):
                    continue
                for cg, pg, picks_g in gs:
                    for cf, pf, picks_f in fs:
                        if cg + cf > limit:
                            break
                        rest = within[limit - cg - cf]
                        if rest and (best is None or pg + pf + rest[0] > best[0] + 1e-9):
                            squad = [*picks_g, *picks_f, *rest[1]]
                            if max(Counter(p["club"] for p in squad).values()) <= MAX_PER_CLUB:
                                best = (pg + pf + rest[0], squad, rest[2])
    if best is None:
        return None
    total, squad, coach = best
    score, starters, captain, sixth, bench = lineup(squad, "fpt", captain)
    return {"score": score + coach["proj"], "objective": total, "cost": round(sum(p["cr"] for p in squad) + coach["cr"], 1),
            "starters": starters, "captain": captain, "sixth": sixth, "bench": bench, "coach": coach}


def game_logs(team):
    """Each squad player's real FPT by round: name -> {round: FPT}."""
    logs = {}
    for p in [*team["starters"], team["sixth"], *team["bench"]]:
        query = urllib.parse.urlencode({"name": p["name"], "season": SEASON})
        logs[p["name"]] = {int(g["Round"]): g["FPT"] for g in api_get(f"/player?{query}")["games"]}
    return logs


def replay(team, logs, rounds, coach_pts):
    """What the squad would have scored in each finished round, real FPT and the card's
    roles every round (starters, captain, sixth man, bench). A player who sat out scores 0."""
    out = {}
    for r in rounds:
        def fpt(p):
            return logs[p["name"]].get(r, 0.0)
        out[r] = (sum(map(fpt, team["starters"])) + fpt(team["captain"]) + fpt(team["sixth"])
                  + sum(map(fpt, team["bench"])) / 2 + coach_pts.get(team["coach"]["team"], {}).get(r, 0))
    return out


def round_game(team, logs, rnd, played):
    """One finished round the way render_court() draws it: each player's real FPT (no
    entry = he did not play) and the coach's points with his game, e.g. 'Won by 14 vs KBA'."""
    club = team["coach"]["team"]
    dunkest = {el: dk for dk, el in DUNKEST_TO_EL.items()}
    coach, line = 0, "no game"
    for r, home, away, margin in played:
        if r == rnd and club in (home, away):
            m, opp = (margin, away) if club == home else (-margin, home)
            coach, line = coach_points(m), (f"{'Won' if m > 0 else 'Lost'} by {abs(m)} "
                                             f"{'vs' if club == home else 'at'} {dunkest.get(opp, opp)}")
    return {"players": {name: fpts[rnd] for name, fpts in logs.items() if rnd in fpts},
            "coach": coach, "coach_game": line}


def court_lines():
    """A FIBA half court (15 m wide), scaled to the floor, basket at the top."""
    s = FLOOR_W / 15
    bx, by = FLOOR_W / 2, 1.575 * s  # the basket
    r3, c3 = 6.75 * s, 0.9 * s       # the three-point arc and the corner-three line
    y3 = by + (r3 ** 2 - (bx - c3) ** 2) ** 0.5
    return (f'<svg class="lines" viewBox="0 0 {FLOOR_W} {FLOOR_H}" width="{FLOOR_W}" height="{FLOOR_H}">'
            f'<rect class="paint" x="{bx - 2.45 * s:.1f}" y="0" width="{4.9 * s:.1f}" height="{5.8 * s:.1f}"/>'
            f'<circle cx="{bx:.1f}" cy="{5.8 * s:.1f}" r="{1.8 * s:.1f}"/>'
            f'<path d="M {bx - 1.25 * s:.1f} {by:.1f} A {1.25 * s:.1f} {1.25 * s:.1f} 0 0 0 {bx + 1.25 * s:.1f} {by:.1f}"/>'
            f'<line class="board" x1="{bx - 0.9 * s:.1f}" y1="{1.2 * s:.1f}" x2="{bx + 0.9 * s:.1f}" y2="{1.2 * s:.1f}"/>'
            f'<circle class="rim" cx="{bx:.1f}" cy="{by:.1f}" r="{0.23 * s:.1f}"/>'
            f'<path d="M {c3:.1f} 0 L {c3:.1f} {y3:.1f} A {r3:.1f} {r3:.1f} 0 0 0 {FLOOR_W - c3:.1f} {y3:.1f} '
            f'L {FLOOR_W - c3:.1f} 0"/></svg>')


def court_photo(name, club):
    shot = headshot(name, club)
    return (f'<img class="shot" src="{shot.as_uri()}" alt="">' if shot
            else f'<div class="initials">{html.escape(initials(name))}</div>')


def court_value(p, game):
    """A plate's number: the season average, or the FPT of the round `game` replays."""
    if not game:
        return f"<b>{num(p['fpt'])}</b> FPT"
    fpt = game["players"].get(p["name"])
    return "<b>DNP</b>" if fpt is None else f"<b>{num(fpt)}</b> FPT"


def court_starters(team, game=None):
    """The starting five on the floor, a row per position; the best of three in the middle."""
    figs = []
    for pos, top in ROW_TOP.items():
        row = sorted((p for p in team["starters"] if p["pos"] == pos), key=lambda p: -p["fpt"])
        if len(row) == 3:
            row = [row[1], row[0], row[2]]
        for dx, p in zip({1: [0], 2: [-190, 190], 3: [-330, 0, 330]}.get(len(row), []), row):
            cap = p is team["captain"]
            figs.append(
                f'<div class="fig{" cap" if cap else ""}" style="left:{FLOOR_W / 2 + dx:.0f}px; top:{top}px">'
                f'<div class="bust"><div class="halo"></div>{court_photo(p["name"], p["team"])}'
                f'{"<span class=capb>C</span>" if cap else ""}</div>'
                f'<div class="plate"><div class="nm"><span class="pos">{p["pos"]}</span>{html.escape(surname(p["name"]))}</div>'
                f'<div class="ln">{court_value(p, game)}{" ×2" if cap else ""} · {num(p["cr"])} CR</div></div></div>')
    return "".join(figs)


def court_bench(team, game=None):
    """The row under the court: sixth man, the four on the bench, the coach."""
    cells = [f'<div class="bitem {cls}"><div class="bbust"><div class="halo"></div>{court_photo(p["name"], p["team"])}</div>'
             f'<div class="bnm"><span class="pos">{p["pos"]}</span>{html.escape(surname(p["name"]))}</div>'
             f'<div class="bln">{court_value(p, game)} · {num(p["cr"])} CR</div><div class="btag">{tag}</div></div>'
             for p, tag, cls in [(team["sixth"], "6th man · 100%", "six"), *[(p, "Bench · 50%", "") for p in team["bench"]]]]
    c = team["coach"]
    cells.append(f'<div class="bitem coach"><div class="bbust"><div class="halo"></div>'
                 f'<div class="initials">{html.escape(initials(c["name"]))}</div></div>'
                 f'<div class="bnm"><span class="pos">HC</span>{html.escape(surname(c["name"]))}</div>'
                 + (f'<div class="bln"><b>{game["coach"]:+d}</b> FPT · {num(c["cr"])} CR</div>'
                    f'<div class="btag">{html.escape(game["coach_game"])}</div></div>' if game else
                    f'<div class="bln"><b>{num(c["proj"])}</b> exp · {num(c["cr"])} CR</div>'
                    f'<div class="btag">Coach · {"vs" if c["home"] else "at"} {html.escape(c["opp"] or "-")}</div></div>'))
    return "".join(cells)


def render_court(team, card, png, game=None):
    """The team card (1200x1350). `card`: badge, title, subtitle, kpis [(value, label, tone)].
    `game` draws one finished round's real scores instead of the averages (round_game())."""
    fields = {"css": (SKILL / "card.css").as_uri(), "mascot": MASCOT.as_uri(), "badge": html.escape(card["badge"]),
              "title": html.escape(card["title"]), "subtitle": html.escape(card["subtitle"]),
              "kpis": "".join(f'<div class="kpi {tone}"><b>{html.escape(value)}</b><small>{html.escape(label)}</small></div>'
                              for value, label, tone in card["kpis"]),
              "lines": court_lines(), "starters": court_starters(team, game), "bench": court_bench(team, game),
              "formation": "-".join(str(sum(p["pos"] == k for p in team["starters"])) for k in "GFC")}
    page = (SKILL / "court.html").read_text()
    for key, value in fields.items():
        page = page.replace("{{" + key + "}}", value)
    png.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, dir=png.parent) as fh:
        fh.write(page)
        tmp = Path(fh.name)
    try:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        "--window-size=1200,1350", "--virtual-time-budget=3000", "--allow-file-access-from-files",
                        f"--screenshot={png}", tmp.as_uri()], check=True, capture_output=True, timeout=90)
    finally:
        tmp.unlink(missing_ok=True)


def captain_scores(pool, coaches, played):
    """Player id -> his captain score: his FPT with this round's winner's bonus in place of
    his club's usual one (a winning side's players get +10%, doubled on the captain)."""
    games, wins = Counter(), Counter()
    for _, home, away, margin in played:
        games[home] += 1
        games[away] += 1
        wins[home if margin > 0 else away] += 1
    nxt = {c["team"]: c for c in coaches if c["opp"]}
    return {id(p): p["fpt"] * (1 + 0.1 * nxt[p["team"]]["win"]) / (1 + 0.1 * wins[p["team"]] / max(1, games[p["team"]]))
            if p["team"] in nxt else 0.0 for p in pool}


def team_card(budget, with_names=(), min_c=0.0, title=None, subtitle=None, badge=None, show_round=None,
              valuation="avg", form=3, consistency=1.0, star_g=0, coach_pick="best", captain_pick="best", core=None,
              without_names=()):
    """The best squad for the rules given, replayed over the finished rounds, written to
    social/teams/<slug>/: the card <slug>.png and team.md (squad, numbers, reply text).
    Players are valued by `valuation` (squad_pool(): expected / form / avg);
    `star_g` = N makes one of the N priciest healthy guards a must; `show_round` also
    draws the squad on that finished round's real scores: <slug>-rN.png.
    The order of priorities: the coach (`coach_pick`: "best" = the most expected points
    this round, a name, or None to let the budget decide), then the captain ("best" = the
    top captain score, a name, or None), then the `core` ({pos: (n, floor)}), then the rest.
    `without_names` are left out like injured players (a doubt the injury report doesn't have yet)."""
    games = schedule()
    last = last_finished_round(games) or 0
    if show_round is not None and not 1 <= show_round <= last:
        sys.exit(f"--replay {show_round}: the finished rounds are 1-{last}")
    nxt = next_round(games)
    played = results()
    pool = squad_pool(valuation, form, consistency, played)
    lock = [find_player(pool, n) for n in with_names]
    left_out = [find_player(pool, n) for n in without_names]
    for p in left_out:
        p["out"] = True
    pts = coach_rounds(played)
    every_coach = coach_pool(pts, club_ratings(played), [(g["home"], g["away"]) for g in games if g["round"] == nxt])
    coaches = every_coach
    if coach_pick == "best":
        coaches = [max(every_coach, key=lambda c: c["proj"])]
    elif coach_pick:
        coaches = [c for c in every_coach if name_parts(c["name"])[1] == name_parts(coach_pick)[1]]
        if len(coaches) != 1:
            sys.exit(f"--coach {coach_pick!r} matches {[c['name'] for c in coaches] or 'nobody'}")
    min_games = max(1, last - 1)
    cap_score = captain_scores(pool, every_coach, played)
    captains = sorted((p for p in pool if not p["out"] and p["games"] >= min_games and cap_score[id(p)]),
                      key=lambda p: -cap_score[id(p)])[:8]
    captain = (captains[0] if captain_pick == "best" else find_player(pool, captain_pick) if captain_pick else None)
    if captain is not None and not any(captain is q for q in lock):
        lock = [*lock, captain]
    # The superstar guard: each of the priciest healthy guards in turn, the best squad wins.
    stars = sorted((p for p in pool if p["pos"] == "G" and not p["out"] and p["games"] >= min_games),
                   key=lambda p: -p["cr"])[:star_g]
    star = next((p for p in lock if any(p is q for q in stars)), None)
    options = [(g, best_squad(pool, coaches, budget, lock + ([] if g is captain else [g]), min_c, min_games, captain, core))
               for g in ([] if star or not star_g else stars)]
    if not options:
        options = [(star, best_squad(pool, coaches, budget, lock, min_c, min_games, captain, core))]
    if not any(t for _, t in options):
        sys.exit(f"No squad fits {budget:g} CR with these rules")
    star, team = max(((g, t) for g, t in options if t), key=lambda o: o[1]["objective"])
    logs = game_logs(team)
    past = replay(team, logs, range(1, last + 1), pts)
    over = sum(v >= 200 for v in past.values())

    names = [surname(p["name"]) for p in lock if p is not captain]
    squad = [*team["starters"], team["sixth"], *team["bench"]]
    on_avg = lineup(squad, "avg")[0] + team["coach"]["proj"]  # the same squad on season averages
    label = {"expected": "projected", "form": "on form", "avg": "expected"}[valuation]
    kpis = [(num(team["cost"]), "CR, coach included", ""), (num(team["score"]), f"FPT {label}, Round {nxt}", "")]
    if past:
        kpis += [(num(past[last]), f"FPT in Round {last}", "up" if past[last] >= 200 else ""),
                 (f"{over} of {len(past)}", "rounds over 200", "gold")]
    rules = [f"{surname(team['coach']['name'])} coach" if coach_pick else None,
             f"{surname(team['captain']['name'])} captain" if captain_pick else None,
             " · ".join(f"{n} {k}" for k, (n, _) in core.items()) + f" at {list(core.values())[0][1]:g}+ FPT" if core else None,
             f"with {' + '.join(names)}" if names else None,
             f"no {' or '.join(surname(p['name']) for p in left_out)}" if left_out else None,
             f"{surname(star['name'])} as star guard" if star_g and star else None,
             f"both centers {min_c:g}+ FPT" if min_c else None]
    basis = {"expected": "players on expected FPT", "form": f"last-{form}-game form",
             "avg": "players on season averages"}[valuation]
    sub = " · ".join(x for x in [*rules, None if any(rules) else "4 G · 4 F · 2 C + coach", basis] if x)
    card = {"badge": badge or f"Round {nxt} · Team build",
            "title": title or (f"A 200+ team for {budget:g} CR" if over
                               else f"{'A' if names else 'The best'} {budget:g}-CR team for Round {nxt}"),
            "subtitle": subtitle or sub[0].upper() + sub[1:], "kpis": kpis}

    slug = "-".join([f"{budget:g}cr", *[name_parts(p["name"])[1].lower().replace(" ", "-") for p in lock],
                     *[f"no-{name_parts(p['name'])[1].lower().replace(' ', '-')}" for p in left_out],
                     *([f"c{min_c:g}"] if min_c else []), *([f"star-g{star_g}"] if star_g else []),
                     *([f"core{''.join(str(n) for n, _ in core.values())}-{list(core.values())[0][1]:g}"] if core else []),
                     *([name_parts(team["coach"]["name"])[1].lower()] if coach_pick and coach_pick != "best" else []),
                     *({"expected": ["exp"], "form": [f"form{form}"], "avg": []}[valuation])])
    out = OUT_ROOT / "teams" / slug
    render_court(team, card, out / f"{slug}.png")

    cap = team["captain"]
    five = [f"{surname(p['name'])}{' (C)' if p is cap else ''}" for p in [cap, *[p for p in team["starters"] if p is not cap]]]
    sixth = surname(team["sixth"]["name"])
    coach = team["coach"]
    en = (f"{num(team['cost'])} CR build: {', '.join(five)}, {sixth} 6th man, {surname(coach['name'])} coach. "
          f"{num(team['score'])} FPT {label} in R{nxt}{f', {num(past[last])} in R{last}' if past else ''}. "
          "What would you change?")
    he = (f"קבוצה ב-{num(team['cost'])} קרדיט: {', '.join(five)}, {sixth} שחקן שישי, {surname(coach['name'])} מאמן. "
          f"{num(team['score'])} FPT {'לפי הכושר' if valuation == 'form' else 'צפוי'} במחזור {nxt}{f', {num(past[last])} במחזור {last}' if past else ''}. "
          "מה הייתם משנים?")
    rows = ([("Starter (C)" if p is cap else "Starter", p) for p in team["starters"]] + [("6th man", team["sixth"])]
            + [("Bench (50%)", p) for p in team["bench"]])
    md = [f"# {card['title']}", "", f"{card['badge']} · {card['subtitle']}", "",
          f"Attach: `{slug}.png` (1200x1350)", "", f"![{slug}]({slug}.png)", "", "## The squad", "",
          {"expected": f"Each player on expected FPT: the chance he plays (the share of his club's last {AVAIL_GAMES} "
                       f"games he played) x his season average pulled toward what his price implies, as if he had "
                       f"played {SHRINK_GAMES} more games at that level. Backtested on 2025-26, squads picked this way "
                       f"beat season averages by ~10 FPT a round but came in ~{PROJECTION_GAP} under their projection: "
                       f"read {num(team['score'])} as a good week and ~{num(team['score'] - PROJECTION_GAP)} as a typical one.",
           "form": f"Each player as the Recommendations tab ranks him: his last {form} games, the newest counting most "
                   f"(1, {FORM_ALPHA:g}, {FORM_ALPHA ** 2:.2f}), less {consistency:g} x their standard error - picked on "
                   "that, lined up on the form FPT. Price is left to the budget.",
           "avg": "Each player on his season average."}[valuation], "",
          f"| | Player | Pos | Club | CR | {label.capitalize()} | Season avg | "
          f"{'Played, last 5' if valuation == 'expected' else 'Last games'} | Std err |", "|---|---|---|---|---|---|---|---|---|",
          *[f"| {role} | {display_name(p['name'])} | {p['pos']} | {p['club']} | {num(p['cr'])} | {num(p['fpt'])} | "
            f"{num(p['avg'])} | {'{}/{}'.format(*p['avail']) if 'avail' in p else ', '.join(num(x) for x in p.get('recent', [])) or '-'} | "
            f"{num(p['se']) if 'se' in p else '-'} |" for role, p in rows],
          f"| Coach | {coach['name']} | HC | {coach['club']} | {num(coach['cr'])} | {num(coach['proj'])} (R{nxt}) | | | |",
          f"| **Total** | | | | **{num(team['cost'])}** | **{num(team['score'])}** | **{num(on_avg)}** | | |", "",
          *([f"Form runs hot: early this season, players 3+ FPT above their average over the last 3 games "
             f"scored below their average the next game. Read {num(team['score'])} as what it scores if the form holds, "
             f"and {num(on_avg)} (the same squad on season averages) as the likelier number.", ""]
            if valuation == "form" else []),
          *([f"## The superstar guard", "",
             f"One of the {star_g} priciest healthy guards must be in; the best squad around each:", "",
             f"| | Guard | CR | {label.capitalize()} | Season avg | Squad {label} |",
             "|---|---|---|---|---|---|",
             *[f"| {'✓' if g is star else ''} | {display_name(g['name'])} | {num(g['cr'])} | {num(g['fpt'])} | "
               f"{num(g['avg'])} | {num(t['score']) if t else 'over budget'} |" for g, t in options if g], ""]
            if star_g else []),
          f"## Captain for Round {nxt}", "",
          f"Captain score: his {label} FPT with this round's 10% winner's bonus in place of his club's usual one, "
          "doubled on the armband. Picked before the rest of the squad.", "",
          "| | Player | Pos | Club | CR | FPT | Next | Win | Captain score | x2 |", "|---|---|---|---|---|---|---|---|---|---|",
          *[f"| {'✓' if p is cap else ''} | {display_name(p['name'])} | {p['pos']} | {p['club']} | {num(p['cr'])} | "
            f"{num(p['fpt'])} | {next(('vs ' if c['home'] else 'at ') + c['opp'] for c in every_coach if c['team'] == p['team'])} | "
            f"{next(c['win'] for c in every_coach if c['team'] == p['team']):.0%} | {num(cap_score[id(p)])} | "
            f"{num(2 * cap_score[id(p)])} |" for p in captains], "",
          f"## Coach for Round {nxt}", "",
          "Each coach on his club's next game: club ratings from this season's margins, plus the home edge. "
          + ("The top line is picked first, before any player." if coach_pick == "best" else
             "The pick is the best for the money with this squad, not always the top line."), "",
          "| | Coach | Club | CR | Next | Margin | Win | Expected | Season avg |", "|---|---|---|---|---|---|---|---|---|",
          *[f"| {'✓' if c is coach else ''} | {c['name']} | {c['club']} | {num(c['cr'])} | "
            f"{('vs ' if c['home'] else 'at ') + c['opp'] if c['opp'] else '-'} | {c['margin']:+.1f} | {c['win']:.0%} | "
            f"{num(c['proj'])} | {num(c['avg'])} |" for c in sorted(every_coach, key=lambda c: -c["proj"])], ""]
    if past:
        md += ["## Replayed on the real scores", "",
               "Same roles every round (starters, captain, sixth man, bench); a player who sat out scores 0.", "",
               "| Round | FPT |", "|---|---|", *[f"| {r} | {num(v)} |" for r, v in past.items()], ""]
    md += ["## Reply text", "", "```", en, "```", "", "Hebrew:", "", "```", he, "```", ""]

    shown = None
    if show_round:
        r, game = show_round, round_game(team, logs, show_round, played)
        cap_fpt = game["players"].get(cap["name"], 0.0)
        steal = max((p for _, p in rows if p["name"] in game["players"]),
                    key=lambda p: game["players"][p["name"]] / p["cr"])  # the most FPT per CR that round
        sub = " · ".join(x for x in [*rules, f"the real Round {r} scores", "captain ×2, 6th man and coach 100%, bench 50%"] if x)
        rcard = {"badge": f"Round {r} · Real scores",
                 "title": f"{num(past[r])} FPT in Round {r}, for {num(team['cost'])} CR",
                 "subtitle": sub[0].upper() + sub[1:],
                 "kpis": [(num(past[r]), f"FPT in Round {r}", "up" if past[r] >= 200 else ""),
                          (num(team["cost"]), "CR at today's prices", ""),
                          (num(2 * cap_fpt), f"{surname(cap['name'])} as captain", "gold"),
                          (num(game["players"][steal["name"]]), f"{surname(steal['name'])} at {num(steal['cr'])} CR", "up")]}
        shown = out / f"{slug}-r{r}.png"
        render_court(team, rcard, shown, game)
        weight = {"Starter (C)": 2, "Starter": 1, "6th man": 1, "Bench (50%)": 0.5}
        en_r = (f"Round {r} on the real scores: {num(past[r])} FPT for {num(team['cost'])} CR. {', '.join(five)}, "
                f"{sixth} 6th man, {surname(coach['name'])} coach. What did yours score?")
        he_r = (f"מחזור {r} על התוצאות האמיתיות: {num(past[r])} FPT ב-{num(team['cost'])} קרדיט. {', '.join(five)}, "
                f"{sixth} שחקן שישי, {surname(coach['name'])} מאמן. כמה עשתה שלכם?")
        md += [f"## Round {r} on the real scores", "",
               f"Attach: `{shown.name}` (1200x1350) - the same squad and roles, each on his real Round {r} FPT, "
               f"the coach on his Round {r} game: {game['coach_game']}. Prices are today's.", "",
               f"![{shown.stem}]({shown.name})", "",
               f"| | Player | R{r} FPT | Counts |", "|---|---|---|---|",
               *[f"| {role} | {display_name(p['name'])} | "
                 f"{num(game['players'][p['name']]) if p['name'] in game['players'] else 'DNP'} | "
                 f"{num(weight[role] * game['players'].get(p['name'], 0.0))} |" for role, p in rows],
               f"| Coach | {coach['name']} | {game['coach_game']} | {game['coach']:+d} |",
               f"| **Total** | | | **{num(past[r])}** |", "",
               "Reply text:", "", "```", en_r, "```", "", "Hebrew:", "", "```", he_r, "```", ""]
    (out / "team.md").write_text("\n".join(md))
    return {"out": out, "team": team, "past": past, "en": en, "nxt": nxt, "shown": shown, "options": options}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["prepare", "pre", "post", "night", "live", "team", "banner", "og"])
    ap.add_argument("--round", type=int, help="round number (default: chosen from the schedule)")
    ap.add_argument("--date", help="game night date, YYYY-MM-DD (night mode; default today)")
    ap.add_argument("--only", help="comma-separated post ids")
    ap.add_argument("--budget", type=float, default=105.0, help="team mode: credits, coach included")
    ap.add_argument("--with", dest="with_players", help="team mode: comma-separated players who must be in")
    ap.add_argument("--without", help="team mode: comma-separated players to leave out (injury doubts)")
    ap.add_argument("--min-c", type=float, default=0.0, help="team mode: the lowest value a center may have")
    ap.add_argument("--title", help="team mode: the card's title (default from the numbers)")
    ap.add_argument("--subtitle", help="team mode: the card's subtitle")
    ap.add_argument("--badge", help="team mode: the badge, e.g. 'Round 7 · Wildcard'")
    ap.add_argument("--replay", type=int, help="team mode: also draw the squad on this finished round's real scores")
    ap.add_argument("--value", choices=["avg", "expected", "form"], default="avg",
                    help="team mode: season averages, expected FPT (availability + price), or Recommendations form")
    ap.add_argument("--coach", default="best", help="team mode: 'best' (picked first), a coach's name, or 'any'")
    ap.add_argument("--captain", default="best", help="team mode: 'best' (picked second), a player's name, or 'any'")
    ap.add_argument("--core", help="team mode: G-F-C good players the squad must have, e.g. 3-2-2")
    ap.add_argument("--core-min", type=float, default=16.0, help="team mode: the FPT a core player needs")
    ap.add_argument("--form", type=int, default=3, help="team mode, --value form: how many recent games")
    ap.add_argument("--consistency", type=float, default=1.0, help="team mode: weight of the std-error penalty on form")
    ap.add_argument("--star-g", type=int, default=0, help="team mode: one of the N priciest healthy guards must be in")
    args = ap.parse_args()
    if args.mode == "team":
        names = [n.strip() for n in (args.with_players or "").split(",") if n.strip()]
        core = (dict(zip("GFC", ((int(n), args.core_min) for n in args.core.split("-")))) if args.core else None)
        res = team_card(args.budget, names, args.min_c, args.title, args.subtitle, args.badge, args.replay,
                        args.value, args.form, args.consistency, args.star_g,
                        None if args.coach == "any" else args.coach, None if args.captain == "any" else args.captain, core,
                        [n.strip() for n in (args.without or "").split(",") if n.strip()])
        out, team, past, en, nxt, shown = (res[k] for k in ("out", "team", "past", "en", "nxt", "shown"))
        c = team["coach"]
        on_avg = lineup([*team["starters"], team["sixth"], *team["bench"]], "avg")[0] + team["coach"]["proj"]
        print(f"✓ {num(team['score'])} FPT ({args.value}) in Round {nxt} "
              f"({num(on_avg)} on season averages), {num(team['cost'])} CR")
        print(f"  coach {c['name']} ({c['club']}, {num(c['cr'])} CR) {'vs' if c['home'] else 'at'} {c['opp']}: "
              f"{c['margin']:+.1f} margin, {c['win']:.0%} win, {num(c['proj'])} expected (season {num(c['avg'])})")
        for g, t in res["options"]:
            if g:
                print(f"  {'✓' if t is team else ' '} star guard {g['name']} ({num(g['cr'])} CR): "
                      + (f"{num(t['score'])} expected" if t else "over budget"))
        print("  " + "  ".join(f"{'*' if p is team['captain'] else ''}{surname(p['name'])} {num(p['fpt'])}"
                               for p in [*team["starters"], team["sixth"], *team["bench"]]))
        if past:
            print("  replayed: " + "  ".join(f"R{r} {num(v)}" for r, v in past.items()))
        print(f"  reply ({x_length(en)}/280): {en}")
        if shown:
            print(f"  Round {args.replay} card: {shown.relative_to(REPO)}")
        print(f"\n{(out / 'team.md').relative_to(REPO)}")
        return
    if args.mode == "banner":
        print(render_banner())
        return
    if args.mode == "og":
        print(render_og())
        return
    if args.mode == "prepare":
        items, notes = prepare()
        now = datetime.now(timezone.utc)
        for when, post, core, _ in items:
            label = "now" if when <= now + timedelta(minutes=30) else _local(when)
            print(f"{'★' if core else ' '} {label:22} {post['id']}  (longest tweet {tweet_lengths(post['tweets'])}/280)")
        for note in notes:
            print(f"! {note}")
        for out in sorted({out for *_, out in items}):
            print(f"✦ {out.relative_to(OUT_ROOT).as_posix()}: "
                  + ("originals in ORIGINALS.md" if (out / "ORIGINALS.md").exists()
                     else "no originals yet - make 3-4 (originals.md)"))
        print(f"\nAll posts, in order: {(OUT_ROOT / 'POSTS.md').relative_to(REPO)}")
        return
    night = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None
    rnd, out, made, notes = generate(args.mode, args.round, set(args.only.split(",")) if args.only else None, night)
    for post_id, post in made.items():
        longest = tweet_lengths(post["tweets"])
        flag = "  ⚠ over X's 280 limit" if longest > 280 else ""
        print(f"✓ {post_id} (longest tweet {longest}/280){flag}")
    for note in notes:
        print(f"! {note}")
    print(f"\n{len(made)} posts in {(out / 'POSTS.md').relative_to(REPO)}")


if __name__ == "__main__":
    main()
