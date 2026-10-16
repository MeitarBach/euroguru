#!/usr/bin/env python3
"""
EuroGuru social posts: a fixed set of tweets, each with a branded 1200x675 image, for
before and after every fantasy round.

    python generate.py pre                 # posts for the next round
    python generate.py post --round 3      # recap of a finished round
    python generate.py night               # tonight's top 3, once tonight's games are final
    python generate.py live                # leaders in the games on right now (for replies)
    python generate.py pre --only hot-hand,budget-picks

Output goes to social/round-XX/<batch>/<post id>/ at the repo root: post.md (the post
ready to copy - main text, the reply carrying the link, or a poll / thread - in English
and Hebrew) next to <post id>.png. Each batch also gets a POSTS.md with all of its posts
in order, and `prepare` writes social/POSTS.md: every post that fits now, in posting
order, to choose from. Nothing is posted here - the user posts by hand.

Standard library only. Data comes from the public EuroGuru API and, for round recaps,
straight from Euroleague's feeds - scored exactly as the fantasy game scores it (PIR,
plus 10% of |PIR| for the winning team), the same rule the Live tab uses.
"""

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
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
# Every club's roster for the season, with the official headshot of each player.
PEOPLE_URL = (f"https://api-live.euroleague.net/v2/competitions/E/seasons/E{SEASON}/people"
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


def stats(window):
    """Every priced player's averages over the last `window` games (100 = season)."""
    return api_post("/stats", {"season": SEASON, "position": "All", "min_cr": 0, "max_cr": 100,
                               "last_x_games": window})


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


_roster = None


def roster_photos():
    """Every player on a EuroLeague roster this season that has a headshot."""
    global _roster
    if _roster is None:
        _roster = []
        try:
            rows = json.loads(fetch(PEOPLE_URL)).get("data", [])
        except Exception as exc:  # no photos is not worth losing the batch over
            print(f"  ! headshots unavailable ({exc}) - cards show initials")
            rows = []
        for row in rows:
            url = (row.get("images") or {}).get("headshot")
            if row.get("type") == "J" and url:
                initial, last = name_parts(row["person"]["name"])
                _roster.append({"club": row["club"]["code"], "initial": initial, "last": last,
                                "code": row["person"]["code"], "url": url, "active": row.get("active")})
    return _roster


def headshot(name, club=None):
    """A player's official photo as a local file, or None. Matched like the boxscores:
    club + initial + surname first, then looser, and only when the match is unique."""
    initial, last = name_parts(name)
    same = [p for p in roster_photos() if p["last"] == last]
    for pool in ([p for p in same if p["club"] == club and p["initial"] == initial],
                 [p for p in same if p["club"] == club],
                 [p for p in same if p["initial"] == initial]):
        if len({p["code"] for p in pool}) == 1:
            person = sorted(pool, key=lambda p: not p["active"])[0]
            break
    else:
        print(f"  ! no headshot for {name} ({club}) - initials used")
        return None
    path = HEADSHOTS / f"{person['code']}.png"
    if not path.exists():
        try:
            raw = fetch(person["url"])
        except Exception as exc:
            print(f"  ! headshot download failed for {name}: {exc}")
            return None
        if not raw.startswith(b"\x89PNG"):
            return None
        HEADSHOTS.mkdir(parents=True, exist_ok=True)
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
    """Length as X counts it: every link is 23 characters, emoji and other wide
    characters count double."""
    text = re.sub(r"https?://\S+", "x" * 23, text)
    return sum(2 if ord(c) > 0x2FFF else 1 for c in text)


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
    rows = [p for p in healthy(ctx["season"], ctx["inj"])
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
    rows = sorted((p for p in ctx["last3"] if p.get("Average_Score") is not None),
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
    rows = [p for p in healthy(ctx["season"], ctx["inj"])
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
    recs = api_post("/recommend", {"season": SEASON, "min_cr": 0, "max_cr": 100})[:MAX_PLAYERS]
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
        ctx.update(last3=stats(3), last5=stats(5), inj=injuries(),
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
        ctx["scores"] = round_scores(on, None, season, final_bonus=False)
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
    others = sorted(d.name for d in out.iterdir() if (d / "post.md").exists() and d.name not in made)
    if others:
        md += ["## From earlier runs", *[f"- [{d}]({d}/post.md)" for d in others], ""]
    if notes:
        md += ["## Notes", *[f"- {x}" for x in notes]]
    (out / "POSTS.md").write_text("\n".join(md) + "\n")


# --- prepare: everything for right now, and the plan ---------------------------------

# The posts worth a minute of manual posting, in the order they go out. The rest of the
# catalogue is generated too and listed as optional.
CORE = {"budget-picks", "hot-hand", "captain-poll", "game-night", "team-of-the-round"}


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

    md = ["# EuroGuru posts", f"Prepared {_local(now)}. Times are your local time. "
          "★ = core posts; the rest are optional. Pick what you want to post.", "",
          "| # | When | Post | Image | Folder |", "|---|---|---|---|---|"]
    for n, (when, post, core, _) in enumerate(items, 1):
        img = "🖼️" if post.get("image") else ("poll" if post["tweets"]["en"].get("poll") else "text")
        md.append(f"| {n} | {label(when)} | {'★ ' if core else ''}{post['title']} | {img} "
                  f"| [{rel(post['folder'])}]({rel(post['folder'])}/post.md) |")
    md.append("")
    for n, (when, post, core, _) in enumerate(items, 1):
        write_post_md(post, label(when), core)
        md += ["---", "", f"## {n}. {'★ ' if core else ''}{post['title']} - post {label(when)}",
               f"Folder: [`{rel(post['folder'])}/`]({rel(post['folder'])}/post.md) (Hebrew version in post.md)", ""]
        if post.get("image"):
            md += [f"Attach: `{rel(post['image'])}`", "", f"![{post['id']}]({rel(post['image'])})", ""]
        md += post_text_md(post)
        if _length_note(post):
            md += [_length_note(post), ""]
    if notes:
        md += ["---", "", "## Notes", *[f"- {x}" for x in notes]]
    (OUT_ROOT / "POSTS.md").write_text("\n".join(md) + "\n")
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["prepare", "pre", "post", "night", "live", "banner", "og"])
    ap.add_argument("--round", type=int, help="round number (default: chosen from the schedule)")
    ap.add_argument("--date", help="game night date, YYYY-MM-DD (night mode; default today)")
    ap.add_argument("--only", help="comma-separated post ids")
    args = ap.parse_args()
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
