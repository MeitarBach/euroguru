#!/usr/bin/env python3
"""
EuroGuru social posts: a fixed set of tweets, each with a branded 1200x675 image, for
before and after every fantasy round.

    python generate.py pre                 # posts for the next round
    python generate.py post --round 3      # recap of a finished round
    python generate.py night               # tonight's top 5, once tonight's games are final
    python generate.py live                # leaders in the games on right now (for replies)
    python generate.py pre --only hot-hand,budget-picks

Output goes to social/round-XX/<batch>/ at the repo root: <id>.json (the tweets, English
and Hebrew: main post, the reply carrying the link, or a poll / thread), <id>.png and a
README.md. Nothing is posted here - xpost.py does that.

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

def surname(name):
    clean = re.sub(r"\s*\([^)]*\)$", "", name)
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


def cols_body(items):
    """Three position columns. items: dicts with pos, name, team, big, unit, meta[(label, value)]."""
    cells = []
    for it in items:
        meta = "".join(f"<span>{html.escape(k)} <b>{html.escape(v)}</b></span>" for k, v in it["meta"])
        cells.append(
            f'<div class="col"><span class="pos">{it["pos"]}</span>'
            f'<div class="name">{html.escape(it["name"])}</div><div class="team">{html.escape(it["team"])}</div>'
            f'<div class="big">{it["big"]}<small>{it["unit"]}</small></div><div class="meta">{meta}</div></div>')
    return f'<div class="cols">{"".join(cells)}</div>'


def list_body(items):
    """A ranked list. items: dicts with pos, name, detail, side, big, unit, tone, tag."""
    rows = []
    for i, it in enumerate(items, 1):
        tag = f'<span class="tag {it["tag"][0]}">{it["tag"][1]}</span>' if it.get("tag") else ""
        rows.append(
            f'<div class="row"><span class="rank">{i}</span><span class="chip">{it["pos"]}</span>'
            f'<div class="who"><div class="name">{html.escape(it["name"])}{tag}</div>'
            f'<div class="detail">{html.escape(it["detail"])}</div></div>'
            f'<span class="side">{it["side"]}</span>'
            f'<span class="big {it.get("tone", "")}">{it["big"]}<small>{it["unit"]}</small></span></div>')
    return f'<div class="list">{"".join(rows)}</div>'



# --- the posts ---------------------------------------------------------------------
# A builder returns a card - title, subtitle, body (the image's HTML) - plus the tweet's
# parts: `hook` / `hook_he` (the opening line in English and Hebrew) and `lines` (the
# player lines, shared by both). compose() turns that into the main tweet, the reply that
# carries the link, and the Hebrew pair. A builder may instead return a `poll` or a
# `thread`, and returns None to skip.

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
        "title": "The most consistent healthy player at every position",
        "subtitle": "Highest reliable floor (average − 2 × SD) this season, injured players excluded",
        "body": cols_body([{"pos": p["position"], "name": p["PlayerName"], "team": p["Team"],
                            "big": num(p["Average_Score"]), "unit": "avg FPT",
                            "meta": [("SD", num(p.get("StdDev_Score") or 0)), ("CR", num(p["CR"]))]} for p in picks]),
        "hook": f"Round {r}: the most consistent healthy player at every position 🎯",
        "hook_he": f"מחזור {r}: השחקן הכי יציב (ובריא) בכל עמדה 🎯",
        "lines": [f"{p['position']}: {surname(p['PlayerName'])} · {num(p['Average_Score'])} FPT · "
                  f"SD {num(p.get('StdDev_Score') or 0)} · {num(p['CR'])} CR" for p in picks],
    }


def post_hot(ctx):
    rows = sorted((p for p in ctx["last3"] if p.get("Average_Score") is not None),
                  key=lambda p: -p["Average_Score"])[:5]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": "Who's hot going into the round",
        "subtitle": "Best average FPT over each player's last 3 games",
        "body": list_body([{"pos": p["position"], "name": p["PlayerName"], "detail": p["Team"],
                            "side": f"<b>{num(p['CR'])}</b> CR", "big": num(p["Average_Score"]), "unit": "LAST 3"}
                           for p in rows]),
        "hook": f"🔥 Hottest players before Round {r} (avg FPT, last 3 games)",
        "hook_he": f"🔥 השחקנים הכי חמים לפני מחזור {r} (ממוצע FPT ב-3 המשחקים האחרונים)",
        "lines": [f"{i}. {surname(p['PlayerName'])} {num(p['Average_Score'])} · {num(p['CR'])} CR"
                  for i, p in enumerate(rows, 1)],
    }


def post_budget(ctx):
    rows = sorted((p for p in healthy(ctx["last5"], ctx["inj"])
                   if p.get("Average_Score") is not None and p["CR"] <= 10),
                  key=lambda p: -p["Average_Score"])[:5]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": "Budget picks: 10 CR or less",
        "subtitle": "Best average FPT over the last 5 games among healthy players at ≤10 CR",
        "body": list_body([{"pos": p["position"], "name": p["PlayerName"], "detail": p["Team"],
                            "side": f"<b>{num(p['CR'])}</b> CR", "big": num(p["Average_Score"]), "unit": "AVG FPT"}
                           for p in rows]),
        "hook": f"💰 Round {r} budget picks (≤10 CR)",
        "hook_he": f"💰 מציאות למחזור {r} (עד 10 קרדיט)",
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
        "body": cols_body([{"pos": p["position"], "name": p["PlayerName"], "team": p["Team"],
                            "big": num(p["Value"], 2), "unit": "FPT / CR",
                            "meta": [("Avg", num(p["Average_Score"])), ("CR", num(p["CR"]))]} for p in picks]),
        "hook": f"👑 Value kings before Round {r}: most FPT per credit",
        "hook_he": f"👑 מלכי התמורה לפני מחזור {r}: הכי הרבה FPT לכל קרדיט",
        "lines": [f"{p['position']}: {surname(p['PlayerName'])} · {num(p['Value'], 2)} FPT/CR · "
                  f"{num(p['Average_Score'])} avg · {num(p['CR'])} CR" for p in picks],
    }


def post_smart(ctx):
    recs = api_post("/recommend", {"season": SEASON, "min_cr": 0, "max_cr": 100})[:5]
    if not recs:
        return None
    r = ctx["round"]
    return {
        "title": "EuroGuru smart picks",
        "subtitle": "Recency-weighted output, value per credit and consistency, combined",
        "body": list_body([{"pos": x.get("position", ""), "name": x["PlayerName"],
                            "detail": f"{num(float(x.get('Efficiency') or 0), 2)} FPT/CR efficiency",
                            "side": f"<b>{num(float(x['CR']))}</b> CR", "big": num(float(x["RecScore"])), "unit": "SCORE"}
                           for x in recs]),
        "hook": f"🧠 EuroGuru smart picks for Round {r}",
        "hook_he": f"🧠 ההמלצות של EuroGuru למחזור {r}",
        "lines": [f"{i}. {surname(x['PlayerName'])} ({x.get('position', '')}) · {num(float(x['CR']))} CR"
                  for i, x in enumerate(recs, 1)],
    }


def post_injuries(ctx):
    by_key = {name_parts(p["PlayerName"]): p for p in ctx["season"]}
    hit = [(by_key[k], tag, injury) for k, (tag, injury) in ctx["inj"].items() if k in by_key]
    hit = sorted(hit, key=lambda t: -(t[0]["CR"] or 0))[:5]
    if not hit:
        return None
    r = ctx["round"]
    return {
        "title": "Injury watch: think twice before you pick",
        "subtitle": "Highest-priced players on the injury report",
        "body": list_body([{"pos": p["position"], "name": p["PlayerName"],
                            "detail": f"{p['Team']} · {injury}" if injury else p["Team"],
                            "side": f"avg <b>{num(p['Average_Score'])}</b>" if p.get("Average_Score") is not None else "",
                            "big": num(p["CR"]), "unit": "CR", "tag": (tag.lower(), tag)} for p, tag, injury in hit]),
        "hook": f"🚑 Injury watch before Round {r}",
        "hook_he": f"🚑 מעקב פציעות לפני מחזור {r}",
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
        "hook": f"🧢 Round {r} captain: who gets the armband?",
        "hook_he": f"🧢 מחזור {r}: את מי אתם שמים קפטן?",
        "lines": [f"{surname(p['PlayerName'])}: {num(p['Average_Score'])} FPT avg, last 5" for p in rows],
        "poll": {"options": [f"{surname(p['PlayerName'])} ({p['Team']})"[:25] for p in rows],
                 "minutes": max(60, min(10080, minutes))},
    }


def post_top_performers(ctx):
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:5]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": f"Round {r}: top performers",
        "subtitle": "Most fantasy points this round, win bonus included",
        "body": list_body([{"pos": x["position"], "name": x["PlayerName"],
                            "detail": f"{x['pts']} PTS · {x['reb']} REB · {x['ast']} AST vs {x['vs']}",
                            "side": f"<b>{num(x['CR'])}</b> CR", "big": num(x["fpt"]), "unit": "FPT"} for x in rows]),
        "hook": f"⭐ Round {r} top performers",
        "hook_he": f"⭐ הכוכבים של מחזור {r}",
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
        "body": list_body([{"pos": x["position"], "name": x["PlayerName"], "detail": f"{el_code(x)} vs {x['vs']}",
                            "side": f"<b>{num(x['CR'])}</b> CR", "big": num(x["fpt"] * (2 if x is captain else 1)),
                            "unit": "FPT ×2" if x is captain else "FPT",
                            "tag": ("c", "C") if x is captain else None} for x in team]),
        "hook": f"🏆 Round {r} team of the round: {num(total)} FPT",
        "hook_he": f"🏆 החמישייה של מחזור {r}: {num(total)} FPT",
        "lines": [f"{x['position']} {surname(x['PlayerName'])} {num(x['fpt'])}{' (C)' if x is captain else ''}" for x in team],
    }


def post_bargains(ctx):
    rows = sorted((x for x in ctx["scores"] if x["CR"] <= 10 and x["fpt"] > 0), key=lambda x: -(x["fpt"] / x["CR"]))[:5]
    if not rows:
        return None
    r = ctx["round"]
    return {
        "title": f"Round {r}: bargains of the round",
        "subtitle": "Most FPT per credit among players at ≤10 CR",
        "body": list_body([{"pos": x["position"], "name": x["PlayerName"],
                            "detail": f"{num(x['fpt'])} FPT · {num(x['CR'])} CR",
                            "side": f"{el_code(x)} vs {x['vs']}", "big": num(x["fpt"] / x["CR"], 2), "unit": "FPT / CR"}
                           for x in rows]),
        "hook": f"💎 Round {r} bargains (≤10 CR, FPT per credit)",
        "hook_he": f"💎 המציאות של מחזור {r} (עד 10 קרדיט, FPT לקרדיט)",
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
    pick = sorted(moves, key=lambda m: -m[1])[:3] + sorted(moves, key=lambda m: m[1])[:2]
    return {
        "title": f"Round {rnd}: price risers and fallers",
        "subtitle": "Biggest CR changes after the round",
        "body": list_body([{"pos": p["position"], "name": p["playerName"], "detail": p["team"],
                            "side": f"now <b>{num(cr)}</b> CR", "big": f"{'+' if d > 0 else ''}{num(d)}",
                            "unit": "CR", "tone": "up" if d > 0 else "down"} for p, d, cr in pick]),
        "hook": f"📈📉 Round {rnd} price movers",
        "hook_he": f"📈📉 מי עלה ומי ירד במחיר אחרי מחזור {rnd}",
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
    """The night's top 5 once the day's games are final."""
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:5]
    if not rows:
        return None
    day = ctx["night"]
    label = day.strftime("%A")
    return {
        "title": f"{label} night: top fantasy performers",
        "subtitle": f"Round {ctx['round']} · {len(ctx['night_games'])} games, win bonus included",
        "body": list_body([{"pos": x["position"], "name": x["PlayerName"],
                            "detail": f"{x['pts']} PTS · {x['reb']} REB · {x['ast']} AST vs {x['vs']}",
                            "side": f"<b>{num(x['CR'])}</b> CR", "big": num(x["fpt"]), "unit": "FPT"} for x in rows]),
        "hook": f"🌙 {label} night's best fantasy performances (Round {ctx['round']})",
        "hook_he": f"🌙 הביצועים הכי טובים של הערב בפנטזי (מחזור {ctx['round']})",
        "lines": [f"{i}. {surname(x['PlayerName'])} {num(x['fpt'])} FPT ({x['pts']}p {x['reb']}r {x['ast']}a)"
                  for i, x in enumerate(rows, 1)],
    }


def post_live(ctx):
    """Right now, in the games being played: made for replying under game posts."""
    rows = sorted(ctx["scores"], key=lambda x: -x["fpt"])[:5]
    if not rows:
        return None
    return {
        "title": "Live: tonight's fantasy leaders",
        "subtitle": "Current fantasy points in the games being played right now",
        "body": list_body([{"pos": x["position"], "name": x["PlayerName"],
                            "detail": f"{x['pts']} PTS · {x['reb']} REB · {x['ast']} AST vs {x['vs']}",
                            "side": f"<b>{num(x['CR'])}</b> CR", "big": num(x["fpt"]), "unit": "FPT LIVE"} for x in rows]),
        "hook": "🔴 Live fantasy leaders right now",
        "hook_he": "🔴 המובילים בפנטזי ברגע זה",
        "lines": [f"{surname(x['PlayerName'])} {num(x['fpt'])} FPT ({x['pts']}p {x['reb']}r {x['ast']}a)" for x in rows],
    }


PRE = [("consistent-by-position", post_consistent), ("hot-hand", post_hot), ("budget-picks", post_budget),
       ("value-kings", post_value), ("injury-watch", post_injuries), ("smart-picks", post_smart),
       ("captain-poll", post_captain_poll)]
POST = [("round-top-performers", post_top_performers), ("team-of-the-round", post_team_of_round),
        ("round-thread", post_round_thread), ("round-bargains", post_bargains), ("price-movers", post_price_movers)]
NIGHT = [("game-night", post_game_night)]
LIVE = [("live-leaders", post_live)]

TAG = "#EuroLeagueFantasy"
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
        if "thread" in card:
            thread = card["thread" if lang == "en" else "thread_he"]
            out[lang] = {"thread": [*thread, reply]}
            continue
        hook = card["hook" if lang == "en" else "hook_he"]
        main = "\n".join([hook, "", *card["lines"], "", TAG])
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
    """Build one batch. Returns (round, output dir, {id: post}). Each post is also written
    to <id>.json with its tweets in both languages, <id>.png when it has an image."""
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
        post = {"id": post_id, "round": rnd, "mode": mode, "tweets": tweets, "card": card,
                "image": None, "generated": datetime.now(timezone.utc).isoformat()}
        if "body" in card:
            png = out / f"{post_id}.png"
            render(card, badge, png)
            post["image"] = str(png)
        saved = {k: v for k, v in post.items() if k != "card"}
        (out / f"{post_id}.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n")
        made[post_id] = post

    # The README covers the whole folder, so a partial re-run (--only) does not drop the
    # posts it did not touch.
    listed = dict(made)
    for path in sorted(out.glob("*.json")):
        if path.stem not in listed:
            listed[path.stem] = json.loads(path.read_text())
    write_readme(rnd, mode, out, listed, ctx["notes"])
    if mode == "post" and not only:
        reddit_draft(rnd, made, out)
    return rnd, out, made, ctx["notes"]


def tweet_lengths(tweets):
    texts = []
    for lang in ("en", "he"):
        t = tweets[lang]
        texts += t.get("thread") or [t["main"], t["reply"]]
    return max(x_length(t) for t in texts)


def write_readme(rnd, mode, out, made, notes):
    title = {"pre": "preview", "post": "recap", "night": "game night", "live": "live"}[mode]
    md = [f"# Round {rnd} · {title} posts", f"Generated {datetime.now():%Y-%m-%d %H:%M}.", ""]
    for post_id, post in made.items():
        md += [f"## {post_id}"]
        if post["image"]:
            md += [f"![{post_id}]({Path(post['image']).name})", ""]
        for lang in ("en", "he"):
            t = post["tweets"][lang]
            md += [f"**{'English' if lang == 'en' else 'Hebrew'}**", ""]
            parts = t.get("thread") or [t["main"], f"↳ reply: {t['reply']}"]
            for part in parts:
                md += ["```", part, "```"]
            if t.get("poll"):
                md += [f"Poll ({t['poll']['minutes']} min): " + " / ".join(t["poll"]["options"]), ""]
        md.append("")
    if notes:
        md += ["## Notes", *[f"- {n}" for n in notes]]
    (out / "README.md").write_text("\n".join(md) + "\n")


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
    md = ["# What to post", f"Prepared {_local(now)}. Times are your local time.", ""]
    core = [i for i in items if i[2]]
    extra = [i for i in items if not i[2]]
    for title, group in (("Core posts", core), ("Optional (if you have time)", extra)):
        if not group:
            continue
        md += [f"## {title}", ""]
        for n, (when, post, _, folder) in enumerate(group, 1):
            t = post["tweets"]["en"]
            label = "now" if when <= now + timedelta(minutes=30) else _local(when)
            md += [f"### {n}. {post['id']} - post {label}"]
            if post.get("image"):
                md += [f"Image: `{Path(post['image']).relative_to(REPO)}`"]
            if t.get("thread"):
                md += ["Thread - post each part as a reply to the previous one:", ""]
                for part in t["thread"]:
                    md += ["```", part, "```"]
            else:
                md += ["", "Post:", "```", t["main"], "```"]
                if t.get("poll"):
                    md += [f"Add a poll with: {' / '.join(t['poll']['options'])} (open until the round locks)", ""]
                md += ["Then reply to your own post with:", "```", t["reply"], "```"]
            md += [f"Hebrew version: `{(Path(folder) / (post['id'] + '.json')).relative_to(REPO)}` → tweets.he", ""]
    if notes:
        md += ["## Notes", *[f"- {n}" for n in notes]]
    (OUT_ROOT / "PLAN.md").write_text("\n".join(md) + "\n")


def render_banner():
    """The X profile banner (1500x500), in the post cards' look."""
    out = OUT_ROOT / "profile"
    out.mkdir(parents=True, exist_ok=True)
    page = (SKILL / "banner.html").read_text()
    page = page.replace("{{css}}", (SKILL / "card.css").as_uri()).replace("{{mascot}}", MASCOT.as_uri())
    tmp = out / "_banner.html"
    tmp.write_text(page)
    png = out / "banner.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                    "--window-size=1500,500", "--virtual-time-budget=3000", "--allow-file-access-from-files",
                    f"--screenshot={png}", tmp.as_uri()], check=True, capture_output=True, timeout=90)
    tmp.unlink(missing_ok=True)
    return png


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["prepare", "pre", "post", "night", "live", "banner"])
    ap.add_argument("--round", type=int, help="round number (default: chosen from the schedule)")
    ap.add_argument("--date", help="game night date, YYYY-MM-DD (night mode; default today)")
    ap.add_argument("--only", help="comma-separated post ids")
    args = ap.parse_args()
    if args.mode == "banner":
        print(render_banner())
        return
    if args.mode == "prepare":
        items, notes = prepare()
        now = datetime.now(timezone.utc)
        for when, post, core, _ in items:
            label = "now" if when <= now + timedelta(minutes=30) else _local(when)
            print(f"{'★' if core else ' '} {label:22} {post['id']}  (longest tweet {tweet_lengths(post['tweets'])}/280)")
        for note in notes:
            print(f"! {note}")
        print(f"\nPlan: {(OUT_ROOT / 'PLAN.md').relative_to(REPO)}")
        return
    night = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None
    rnd, out, made, notes = generate(args.mode, args.round, set(args.only.split(",")) if args.only else None, night)
    for post_id, post in made.items():
        longest = tweet_lengths(post["tweets"])
        flag = "  ⚠ over X's 280 limit" if longest > 280 else ""
        print(f"✓ {post_id} (longest tweet {longest}/280){flag}")
    for note in notes:
        print(f"! {note}")
    print(f"\n{len(made)} posts in {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
