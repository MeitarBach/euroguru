#!/usr/bin/env python3
"""
Originals: one-off posts in formats the catalogue doesn't make. Claude invents 3-4 of
them every run (the brief: originals.md); this module is what they share - the batch's
frozen data, the stories sheet, photos placed by the head, the page chrome, rendering,
and writing post.md, ORIGINALS.md and the batch's block in social/POSTS.md.

    python3 originals.py facts social/round-09/pre [--refresh]     # stories to build on (+ the batch's data)
    python3 originals.py history                                    # formats already used, by batch
    python3 originals.py sheet "S. Vezenkov:OLY" "Y. Madar:HTA:2025"   # candidate photos side by side
    python3 social/round-09/pre/make.py [ids] [--out DIR] [--keep-html]  # build a batch's originals

A batch's originals live in its folder: make.py (written for the batch - the visuals,
the texts, the numbers behind them), a folder per post (post.md + <id>.png) and
ORIGINALS.md, the menu. Standard library only, like generate.py.
"""

import html
import itertools
import json
import math
import re
import struct
import subprocess
import sys
import zlib
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import generate as g

W, H = 1200, 1350  # every original's page; rendered at 2x (2400x2700, under X's 5 MB)
CACHE = g.OUT_ROOT / ".cache"  # finished games' boxscores and last season's stats: they never change
LAST_SEASON = str(int(g.SEASON) - 1)
BOXES = g.HEADSHOTS / "boxes.json"  # where the player is in each photo (photo_box)
# The typical cutout, for a photo photo_box can't read (an interlaced PNG).
DEFAULT_BOX = {"top": 0.035, "head_x": 0.49, "left": 0.13, "right": 0.86, "bottom": 0.999}
MASCOT = g.MASCOT.as_uri()
CATALOGUE = {pid for pid, _ in g.PRE + g.POST + g.NIGHT + g.LIVE}
POST_KEYS = ("id", "format", "title", "when", "html", "what", "en", "he", "numbers", "replies")

# The names fans use, by Euroleague code.
CLUB = {"ASV": "ASVEL", "BAR": "Barcelona", "BAS": "Baskonia", "BES": "Besiktas", "DUB": "Dubai",
        "HTA": "Hapoel", "IST": "Efes", "MAD": "Real Madrid", "MIL": "Milan", "MUN": "Bayern",
        "OLY": "Olympiacos", "PAM": "Valencia", "PAN": "Panathinaikos", "PAR": "Partizan", "PRS": "Paris",
        "RED": "Crvena Zvezda", "TEL": "Maccabi", "ULK": "Fenerbahçe", "VIR": "Virtus", "ZAL": "Zalgiris"}
POS_WORD = {"G": "guards", "F": "forwards", "C": "centers"}


# --- the batch -------------------------------------------------------------------------

def batch(path):
    """The batch a folder (or a file in it) is: social/round-XX/<pre | post | night-YYYY-MM-DD>."""
    out = Path(path).resolve()
    if out.suffix:
        out = out.parent
    m = re.fullmatch(r"round-(\d+)", out.parent.name)
    kind = "night" if out.name.startswith("night-") else out.name
    if not m or out.parent.parent != g.OUT_ROOT.resolve() or kind not in ("pre", "post", "night"):
        raise SystemExit(f"{path}: not a batch folder (social/round-XX/pre, post or night-YYYY-MM-DD)")
    night = date.fromisoformat(out.name[6:]) if kind == "night" else None
    return SimpleNamespace(out=out, round=int(m.group(1)), mode=kind, night=night,
                           rel=f"{out.parent.name}/{out.name}",
                           title=g.BATCH_TITLE[kind] + (f" {night:%a %d %b}" if night else ""))


def batch_games(D, b):
    """The codes of the batch's games: the round's, or one night's."""
    if b.mode == "night":
        return [x["code"] for x in D["games"]
                if datetime.fromisoformat(x["tipoff"]).astimezone(g.PARIS).date() == b.night]
    return [x["code"] for x in D["games"] if x["round"] == b.round]


# --- data: pulled once per batch, then frozen ---------------------------------------------

def data(b, refresh=False):
    """The batch's data. Pulled the first time and frozen in <batch>/.data.json, so the
    numbers written into its texts stay true however often its images are re-rendered.
    refresh=True pulls again - then re-check every number in the batch's texts.

    stats / form: /stats for the season / the last 3 games · logs: {name: [[round, FPT]]}
    games: the schedule (ISO tip-offs) · results: [[round, home, away, home margin]]
    dvp: the Matchups tab (picks = this round's forecasts) · inj: {"S VEZENKOV": ["OUT", "Knee"]}
    prices: /cr-history · coaches: /coaches · people: this season's rosters (born, country,
    height...) · lines (game night / recap): the batch's games, line by line, from the
    boxscores · plus, not frozen: last (last season's stats) and ratings (club ratings)."""
    path = b.out / ".data.json"
    if refresh or not path.exists():
        b.out.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(pull(b)))
    D = json.loads(path.read_text())
    D["last"] = last_season_stats()
    D["ratings"] = g.club_ratings([tuple(r) for r in D["results"]])
    return D


def pull(b):
    print("  pulling the batch's data: stats, games, matchups, prices, rosters, boxscores...", flush=True)
    games = g.schedule()
    D = {"pulled": datetime.now(timezone.utc).isoformat(timespec="minutes"), "round": b.round, "mode": b.mode,
         "stats": g.stats(100), "form": g.stats(3), "logs": g.game_scores(),
         "games": [{**x, "tipoff": x["tipoff"].isoformat()} for x in games], "results": g.results(),
         "dvp": g.api_get(f"/defense-vs-position?season={g.SEASON}"),
         "inj": {" ".join(k): v for k, v in g.injuries().items()},
         "prices": g.api_get(f"/cr-history?season={g.SEASON}"),
         "coaches": g.api_get(f"/coaches?season={g.SEASON}"),
         "people": [_person(r) for r in json.loads(g.fetch(g.PEOPLE_URL.format(season=g.SEASON))).get("data", [])
                    if r.get("type") == "J"]}
    if b.mode != "pre":  # tonight's games / the round's: the API only has them the next morning
        D["lines"] = game_lines(D, batch_games(D, b), final_only=True)
    return D


def _person(row):
    p = row.get("person") or {}
    return {"code": p.get("code"), "name": p.get("name"), "club": (row.get("club") or {}).get("code"),
            "born": (p.get("birthDate") or "")[:10], "country": (p.get("country") or {}).get("name"),
            "height": p.get("height"), "dorsal": row.get("dorsal"), "active": row.get("active")}


def last_season_stats():
    """Last season's averages, per player. It's over, so they are cached once."""
    path = CACHE / f"E{LAST_SEASON}" / "stats.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(g.api_post("/stats", {"season": LAST_SEASON, "position": "All", "min_cr": 0,
                                                         "max_cr": 100, "last_x_games": 100})))
    return json.loads(path.read_text())


def boxscore(code):
    """A game's boxscore; a finished one is cached for good."""
    path = CACHE / "boxscores" / f"E{g.SEASON}" / f"{code}.json"
    if path.exists():
        return json.loads(path.read_text())
    raw = g.fetch(g.BOXSCORE_URL.format(code=code))
    if not raw.strip():
        return None
    box = json.loads(raw)
    if not box.get("Live"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return box


PARTS = ("pts", "reb", "ast", "stl", "blk", "fd", "miss", "missft", "to", "blka", "pf")


def _parts(line):
    """A boxscore line's PIR, part by part (the costs negative). They add up to its PIR."""
    v = lambda k: line.get(k) or 0  # noqa: E731
    return {"pts": v("Points"), "reb": v("TotalRebounds"), "ast": v("Assistances"), "stl": v("Steals"),
            "blk": v("BlocksFavour"), "fd": v("FoulsReceived"),
            "miss": -(v("FieldGoalsAttempted2") - v("FieldGoalsMade2") + v("FieldGoalsAttempted3") - v("FieldGoalsMade3")),
            "missft": -(v("FreeThrowsAttempted") - v("FreeThrowsMade")), "to": -v("Turnovers"),
            "blka": -v("BlocksAgainst"), "pf": -v("FoulsCommited")}


def _matcher(D):
    """(club, boxscore name) -> the priced player, matched like generate.round_scores."""
    full, last = defaultdict(list), defaultdict(list)
    for p in D["stats"]:
        initial, surname = g.name_parts(p["PlayerName"])
        full[(g.el_code(p), initial, surname)].append(p)
        last[(g.el_code(p), surname)].append(p)

    def match(club, name):
        initial, surname = g.name_parts(name)
        hits = full.get((club, initial, surname)) or []
        if len(hits) != 1:
            hits = last.get((club, surname)) or []
        return hits[0] if len(hits) == 1 else None
    return match


def _minutes(text):
    mm, ss = (str(text).split(":") + ["0"])[:2]
    return int(mm or 0) + int(ss or 0) / 60


def game_lines(D, codes, final_only=False):
    """Every player's line in these games: his PIR part by part, PIR, the win bonus and FPT
    (PIR + 10% of |PIR| for a win, once the game is final), matched to the priced players."""
    match, games, out = _matcher(D), {x["code"]: x for x in D["games"]}, []
    for code in codes:
        box = boxscore(code)
        if not box or (final_only and box.get("Live")):
            continue
        teams = [t for t in box.get("Stats") or [] if t.get("PlayersStats")]
        points = {t["PlayersStats"][0]["Team"].strip(): sum(x["Points"] or 0 for x in t["PlayersStats"]) for t in teams}
        x = games.get(code, {})
        for t in teams:
            club = t["PlayersStats"][0]["Team"].strip()
            won = (not box.get("Live") and len(points) > 1
                   and points[club] > max(v for k, v in points.items() if k != club))
            for line in t["PlayersStats"]:
                mins = str(line.get("Minutes") or "").upper()
                if mins in ("", "DNP"):
                    continue
                pir = line.get("Valuation") or 0
                p = match(club, line["Player"])
                out.append({"code": code, "round": x.get("round"), "team": club,
                            "vs": x.get("away") if club == x.get("home") else x.get("home"),
                            "name": p["PlayerName"] if p else g.display_name(line["Player"]), "priced": bool(p),
                            "pos": p["position"] if p else None, "cr": p["CR"] if p else None,
                            "min": _minutes(mins), "parts": _parts(line), "pir": pir, "won": won,
                            "fpt": round(pir + (0.1 * abs(pir) if won else 0), 1)})
    return out


def anatomy(D):
    """What each priced player's FPT is made of, per game, over the season's played games:
    {name: {name, team, pos, cr, games, min, parts {pts, reb, ast, stl, blk, fd, miss, missft,
    to, blka, pf}, pir, fpt (his average as the site shows it), bonus (fpt - pir: the win
    bonus a game)}}. The parts add up to pir."""
    by = defaultdict(list)
    for line in game_lines(D, [x["code"] for x in D["games"] if x["played"]]):
        if line["priced"]:
            by[line["name"]].append(line)
    rows, out = _lookup(D, "stats"), {}
    for name, lines in by.items():
        n = len(lines)
        parts = {k: sum(x["parts"][k] for x in lines) / n for k in PARTS}
        pir = sum(x["pir"] for x in lines) / n
        if abs(sum(parts.values()) - pir) > 0.01:
            print(f"  ! {name}: the parts add up to {sum(parts.values()):.2f}, his PIR is {pir:.2f}")
        p = rows[name]
        out[name] = {"name": name, "team": lines[0]["team"], "pos": p["position"], "cr": p["CR"], "games": n,
                     "min": sum(x["min"] for x in lines) / n, "parts": parts, "pir": pir,
                     "fpt": p["Average_Score"], "bonus": p["Average_Score"] - pir}
    return out


# --- lookups and checks --------------------------------------------------------------------

def _lookup(D, key):
    cache = D.setdefault("_lookup", {})
    if key not in cache:
        cache[key] = {r["PlayerName"]: r for r in D[key]}
    return cache[key]


def player(D, name):
    """His season row from /stats, by the name the API uses (e.g. 'C. Jones (PAR)')."""
    return _lookup(D, "stats")[name]


def form(D, name):
    """His average over his last 3 games."""
    return _lookup(D, "form")[name]["Average_Score"]


def log(D, name):
    """{round: FPT} for every game he played."""
    return {r: fpt for r, fpt in D["logs"].get(name, [])}


def hi_lo(D, name):
    games = list(log(D, name).values())
    return max(games), min(games)


def last(D, name):
    """His row from last season's stats, or None (not in the league, or the name is ambiguous)."""
    initial, surname = g.name_parts(name)
    rows = [p for p in D["last"] if g.name_parts(p["PlayerName"])[1] == surname]
    exact = [p for p in rows if g.name_parts(p["PlayerName"])[0] == initial]
    for pool in (exact, rows):
        if len(pool) == 1:
            return pool[0]
    return None


def hurt(D, name):
    """'OUT' / 'GTD' when the injury report has him, else None."""
    report = D["inj"].get(" ".join(g.name_parts(name)))
    return report[0] if report else None


def people(D):
    """{player name: his roster entry (born, country, height, dorsal)} for the priced players."""
    if "_people" not in D:
        full, last_ = defaultdict(list), defaultdict(list)
        for r in D["people"]:
            initial, surname = g.name_parts(r["name"])
            full[(r["club"], initial, surname)].append(r)
            last_[(r["club"], surname)].append(r)
        D["_people"] = {}
        for p in D["stats"]:
            initial, surname = g.name_parts(p["PlayerName"])
            hits = full.get((g.el_code(p), initial, surname)) or last_.get((g.el_code(p), surname)) or []
            if len(hits) == 1:
                D["_people"][p["PlayerName"]] = hits[0]
    return D["_people"]


def rounds_played(D):
    """The last round whose games are all played."""
    rounds = defaultdict(list)
    for x in D["games"]:
        rounds[x["round"]].append(x["played"])
    done = [r for r, played in rounds.items() if all(played)]
    return max(done, default=0)


def min_games(D):
    """Games a player needs to count as a regular: 5 after 7 rounds, 3 at least."""
    return max(3, math.ceil(0.7 * rounds_played(D)))


def regulars(D, healthy=False):
    n = min_games(D)
    return [p for p in D["stats"] if (p["GamesPlayed"] or 0) >= n and not (healthy and hurt(D, p["PlayerName"]))]


METRICS = {"fpt": ("FPT a game", lambda p: p["Average_Score"] or 0),
           "value": ("FPT per CR", lambda p: (p["Average_Score"] or 0) / p["CR"] if p["CR"] else 0),
           "per36": ("FPT per 36 min", lambda p: p["Per36_Score"] or 0)}


def rank(D, name, key="fpt"):
    """Where he ranks among the regulars, and who would rank above him with fewer games.
    Run it before writing "the most", "#1" or "the best": if anyone is listed, the claim
    needs its qualifier ("(5+ games)")."""
    label, f = METRICS[key]
    n, me = min_games(D), player(D, name)
    reg = [p["PlayerName"] for p in sorted(regulars(D), key=f, reverse=True)]
    head = (f"#{reg.index(name) + 1} of {len(reg)} in {label} with {n}+ games" if name in reg
            else f"not a regular ({me['GamesPlayed']} games, {n}+ needed)")
    above = sorted((p for p in D["stats"] if 0 < (p["GamesPlayed"] or 0) < n and f(p) > f(me)), key=f, reverse=True)
    if not above:
        return head + ", and at any number of games"
    return head + "; ahead of him with fewer games: " + ", ".join(
        f"{p['PlayerName']} {f(p):.2f} ({p['GamesPlayed']} g)" for p in above[:4])


def fixture(D, club, rnd=None):
    """A club's game in a round (the batch's by default): vs, home, tipoff (aware datetime),
    played, and the model's win chance and expected margin (generate.coach_outlook)."""
    rnd = rnd or D["round"]
    for x in D["games"]:
        if x["round"] == rnd and club in (x["home"], x["away"]):
            home = x["home"] == club
            edge = D["ratings"].get(x["home"], 0) - D["ratings"].get(x["away"], 0) + g.HOME_EDGE
            p_home = g.coach_outlook(edge)[1]
            return {"code": x["code"], "home": home, "vs": x["away"] if home else x["home"],
                    "tipoff": datetime.fromisoformat(x["tipoff"]), "played": x["played"],
                    "win": p_home if home else 1 - p_home, "margin": edge if home else -edge}
    return None


def day(dt):
    """The weekday of a tip-off, as Europe sees it ('Wednesday'). Images show the day only:
    the audience spans three time zones."""
    return dt.astimezone(g.PARIS).strftime("%A")


def local(when):
    """A time (aware datetime or ISO text) in the user's local time: 'Mon 26 Oct, 10:15'."""
    when = datetime.fromisoformat(when) if isinstance(when, str) else when
    return when.astimezone().strftime("%a %d %b, %H:%M")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def softness(rank_p36, teams=20):
    """'the softest', '4th softest', '2nd toughest' for a defense ranked 1 (softest) to `teams`."""
    if rank_p36 <= teams // 2:
        return "the softest" if rank_p36 == 1 else f"{ordinal(rank_p36)} softest"
    rank_p36 = teams + 1 - rank_p36
    return "the toughest" if rank_p36 == 1 else f"{ordinal(rank_p36)} toughest"


def round_parts(values, total, fixed=(0,), digits=1):
    """Each value rounded, nudged so the column adds up to `total` rounded: the values that
    were rounded the furthest move first, and the `fixed` ones (the headline) never move."""
    shown, step0, total = [round(v, digits) for v in values], 10 ** -digits, round(total, digits)
    while round(sum(shown) - total, digits) != 0:
        step = -step0 if sum(shown) > total else step0
        i = max((k for k in range(len(values)) if k not in fixed),
                key=lambda k: (shown[k] - values[k]) * (1 if step < 0 else -1))
        shown[i] = round(shown[i] + step, digits)
    return shown


# --- photos --------------------------------------------------------------------------------

def photo(name, club, season=None):
    """His official cutout (750x1000, transparent) as a local file: this season's, or - with
    `season` ("2025") - the one from that season's roster, in that jersey (club = his club then)."""
    path = g.headshot(name, club, season or g.SEASON)
    if not path:
        raise SystemExit(f"No photo for {name} ({club}{', ' + season if season else ''}): a big-photo post needs "
                         "one - fix the name or club, or pick another player.")
    return path


def _alpha_rows(path):
    """The alpha channel of an 8-bit RGBA, non-interlaced PNG, row by row (no Pillow here)."""
    raw = Path(path).read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, w, h = 8, b"", 0, 0
    while pos < len(raw):
        n, kind = struct.unpack(">I4s", raw[pos:pos + 8])
        body = raw[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if (depth, ctype, interlace) != (8, 6, 0):
                raise ValueError(f"a PNG this can't read (depth {depth}, color type {ctype}, interlace {interlace})")
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    data_, bpp, stride = zlib.decompress(idat), 4, w * 4
    prev, rows, i = bytearray(stride), [], 0
    for _ in range(h):
        f, line = data_[i], bytearray(data_[i + 1:i + 1 + stride])
        i += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x - bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a, b, c = line[x - bpp] if x >= bpp else 0, prev[x], prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line[3::4]))
        prev = line
    return w, h, rows


def _box(path, threshold=40):
    w, h, rows = _alpha_rows(path)
    spans = []
    for a in rows:
        xs = [x for x in range(0, w, 2) if a[x] > threshold]
        spans.append((xs[0], xs[-1]) if xs else None)
    ys = [y for y, s in enumerate(spans) if s]
    if not ys:
        raise ValueError("an empty photo")
    top, bottom = ys[0], ys[-1]
    head = [s for s in spans[top:top + int(0.12 * h)] if s]  # the top 12% of the frame from his top: the head
    return {"w": w, "h": h, "top": top / h, "bottom": bottom / h,
            "left": min(s[0] for s in spans if s) / w, "right": max(s[1] for s in spans if s) / w,
            "head_x": sum((a + b) / 2 for a, b in head) / len(head) / w}


def photo_box(path):
    """Where the player is in a cutout, as fractions of the frame: top, bottom, left, right
    of the figure and head_x, the middle of his head. Cached per file; a photo this can't
    read (interlaced) gets the typical box, and the run says so."""
    path = Path(path).resolve()
    home = g.HEADSHOTS.resolve()
    key = f"{path.relative_to(home) if path.is_relative_to(home) else path}:{path.stat().st_size}"
    cache = json.loads(BOXES.read_text()) if BOXES.exists() else {}
    if key not in cache:
        try:
            cache[key] = _box(path)
        except ValueError as exc:
            print(f"  ! {path.name}: {exc} - head position estimated; check the render")
            return dict(DEFAULT_BOX)
        BOXES.parent.mkdir(parents=True, exist_ok=True)
        BOXES.write_text(json.dumps(cache, indent=1))
    return cache[key]


def place(path, height, head_x, top=None, bottom=None, cls="", style=""):
    """An <img> of a cutout `height` px tall, standing so the middle of his head is at
    x = head_x (page px). Give `top` (the frame's top edge) or `bottom` (its bottom edge)."""
    box = photo_box(path)
    width = height * box.get("w", 750) / box.get("h", 1000)
    left = head_x - box["head_x"] * width
    pos = f"top:{top}px;" if top is not None else f"top:{bottom - height}px;"
    return (f'<img class="cut {cls}" src="{Path(path).as_uri()}" '
            f'style="left:{left:.0f}px;{pos}height:{height}px;width:{width:.0f}px;{style}" alt="">')


def sheet(specs):
    """Candidate photos side by side, the head line dashed - to choose poses before a
    layout. Specs: "S. Vezenkov:OLY", or "Y. Madar:HTA:2025" for last season's photo."""
    cells = []
    for spec in specs:
        name, club, season = (spec.split(":") + ["", ""])[:3]
        path = photo(name, club or None, season or None)
        box = photo_box(path)
        cells.append(f'<div class="c"><img src="{path.as_uri()}" alt=""><i style="left:{box["head_x"] * 100:.1f}%"></i>'
                     f'<b>{html.escape(name)} · {club}{" · " + season if season else ""}</b></div>')
    css = ("* { margin: 0; box-sizing: border-box; } body { background: #18181b; color: #fff; display: grid;"
           " grid-template-columns: repeat(4, 300px); font: 600 16px -apple-system, sans-serif; }"
           " .c { position: relative; height: 430px; border: 1px solid #333; }"
           " .c img { position: absolute; left: 0; top: 0; width: 300px; height: 400px; }"
           " .c i { position: absolute; top: 0; height: 400px; border-left: 2px dashed #f87171; }"
           " .c b { position: absolute; left: 8px; bottom: 6px; }")
    doc = f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(cells)}</body></html>'
    print(render(doc, CACHE / "sheet.png", size=(1200, 430 * math.ceil(len(cells) / 4)), scale=1))


# --- the page ------------------------------------------------------------------------------

BASE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1200px; height: 1350px; overflow: hidden; }
body { font-family: -apple-system, "SF Pro Display", Inter, "Helvetica Neue", Arial, sans-serif; color: #fff;
  background: #07060b; position: relative; -webkit-font-smoothing: antialiased; }
.disp { font-family: "Avenir Next Condensed", "DIN Condensed", Impact, sans-serif; font-weight: 800; }
.cut { position: absolute; object-fit: contain; }
header.top { position: absolute; z-index: 50; left: 48px; right: 48px; top: 34px; height: 56px;
  display: flex; align-items: center; justify-content: space-between; }
.logo { display: flex; align-items: center; gap: 12px; }
.logo img { height: 50px; }
.logo span { font-size: 29px; font-weight: 800; letter-spacing: -0.5px; text-shadow: 0 2px 14px rgba(0,0,0,.45); }
.badge { font-size: 15px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; padding: 9px 16px;
  border-radius: 999px; color: #ede9fe; background: rgba(20, 12, 40, 0.55); border: 1px solid rgba(167, 139, 250, 0.55);
  backdrop-filter: blur(6px); }
footer.foot { position: absolute; z-index: 50; left: 0; right: 0; bottom: 0; height: 58px; padding: 0 48px;
  display: flex; align-items: center; justify-content: space-between; font-size: 19px;
  background: linear-gradient(90deg, rgba(76, 45, 150, 0.96), rgba(40, 24, 82, 0.96));
  border-top: 1px solid rgba(167, 139, 250, 0.45); }
footer .url { font-weight: 800; letter-spacing: 0.2px; }
footer .pitch { color: #ddd6fe; }
"""


def chrome(badge):
    """The brand frame every original carries: logo + badge on top, the site in the footer."""
    return (f'<header class="top"><div class="logo"><img src="{MASCOT}" alt=""><span>EuroGuru</span></div>'
            f'<div class="badge">{html.escape(badge)}</div></header>'
            '<footer class="foot"><span class="url">eurogurufantasy.com</span>'
            '<span class="pitch">Live fantasy points · stats · smart picks</span></footer>')


def page(css, body):
    """A whole 1200x1350 page: BASE, then the post's own css."""
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{BASE}{css}</style></head>'
            f'<body>{body}</body></html>')


def render(doc, png, size=(W, H), scale=2, keep=False):
    """A page to a PNG with headless Chrome, at `scale`x (2400x2700 by default)."""
    png.parent.mkdir(parents=True, exist_ok=True)
    tmp = png.parent / f"_{png.stem}.html"
    tmp.write_text(doc)
    try:
        subprocess.run([g.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--force-device-scale-factor={scale}", f"--window-size={size[0]},{size[1]}",
                        "--virtual-time-budget=4000", "--allow-file-access-from-files",
                        f"--screenshot={png}", tmp.as_uri()], check=True, capture_output=True, timeout=120)
    finally:
        if not keep:
            tmp.unlink(missing_ok=True)
    return png


# --- building a batch ---------------------------------------------------------------------

def _fence(text):
    return ["```", text, "```"]


def _decimals(text):
    return re.findall(r"\d+\.\d+", text)


def _reply(b, pid, lang):
    return g.REPLY[lang].format(url=g.utm(f"r{b.round:02d}-{pid}", lang))


def build(posts, b, notes=(), ideas=()):
    """Render the batch's originals - all of them, or the ids named on the command line -
    and write each one's post.md, the batch's ORIGINALS.md (the menu: every post in
    `posts`, the `notes`, then the `ideas` not made) and its block in social/POSTS.md.
    A post: {id, format, title, when, html (a function returning the page), what, en, he,
    numbers [lines; "  - " for sub-points], replies [likely comments and the answer]}.
    --out DIR writes it all there instead (to compare) and leaves POSTS.md alone;
    --keep-html keeps each page's HTML next to its PNG."""
    args = sys.argv[1:]
    out = Path(args[args.index("--out") + 1]).resolve() if "--out" in args else b.out
    only = [a for i, a in enumerate(args) if not a.startswith("--") and not (i and args[i - 1] == "--out")]
    ids = [p.get("id") for p in posts]
    problems = [f"{p.get('id')}: no {', '.join(k for k in POST_KEYS if k not in p)}"
                for p in posts if any(k not in p for k in POST_KEYS)]
    problems += [f"{i}: a catalogue post's id - pick another" for i in ids if i in CATALOGUE]
    problems += [f"{i}: used twice" for i in sorted(set(ids)) if ids.count(i) > 1]
    problems += [f"{i}: no such post" for i in only if i not in ids]
    problems += [f"{p['id']}: the {lang.upper()} text is {g.x_length(p[lang])} characters - X allows 280"
                 for p in posts for lang in ("en", "he") if p.get(lang) and g.x_length(p[lang]) > 280]
    if problems:
        raise SystemExit("Not built:\n  " + "\n  ".join(problems))

    D = data(b)
    for p in posts:
        if only and p["id"] not in only:
            continue
        doc = p["html"]()
        png = render(doc, out / p["id"] / f"{p['id']}.png", keep="--keep-html" in args)
        _write_post(p, b, out, D)
        en, he, mb = g.x_length(p["en"]), g.x_length(p["he"]), png.stat().st_size / 1e6
        print(f"✓ {p['id']}: EN {en}/280 · HE {he}/280 · {mb:.1f} MB · {png}")
        missing = [x for x in _decimals(p["en"]) if x not in doc]
        if missing:
            print(f"  ! in the text, not in the image: {', '.join(missing)} - make sure they agree")
        if sorted(_decimals(p["en"])) != sorted(_decimals(p["he"])):
            print(f"  ! EN and HE numbers differ: {_decimals(p['en'])} / {_decimals(p['he'])}")
        if max(en, he) > 275:
            print("  ! over 275 characters - tight; trim if you can")
        if mb >= 5:
            print("  ! X takes up to 5 MB - render this one at scale 1.8")
    _write_menu(posts, b, out, D, notes, ideas)
    if out == b.out:
        update_plan(posts, b)
    print(f"\n{(out / 'ORIGINALS.md')}")


def _write_post(p, b, out, D):
    """post.md: when and what, the post, the reply with the link, the numbers behind it,
    answers ready for the comments, then the Hebrew version."""
    pid = p["id"]
    md = [f"# {p['title']}", "",
          f"Round {b.round} · original · {p['format']} · post **{p['when']}**.", "", p["what"], "",
          f"Attach: `{pid}.png`", "", f"![{pid}]({pid}.png)", "",
          "## Post", "", *_fence(p["en"]), "", f"{g.x_length(p['en'])} characters.", "",
          "## Then reply to your own post with (the link goes here)", "", *_fence(_reply(b, pid, "en")), "",
          "## The numbers behind it", "", f"Data as of {local(D['pulled'])}.", "",
          *[x if x.startswith("  ") else f"- {x}" for x in p["numbers"]], "",
          "## When the replies come in", "", *[f"- {x}" for x in p["replies"]], "",
          "---", "", "## עברית (Hebrew)", "", "### פוסט - אותה תמונה", "", *_fence(p["he"]), "",
          f"{g.x_length(p['he'])} characters.", "", "### Then reply to your own post with (the link goes here)", "",
          *_fence(_reply(b, pid, "he")), ""]
    (out / pid).mkdir(parents=True, exist_ok=True)
    (out / pid / "post.md").write_text("\n".join(md))


def _lock(D, b):
    tips = [x["tipoff"] for x in D["games"] if x["round"] == b.round]
    return local(min(tips)) if b.mode == "pre" and tips else None


def _write_menu(posts, b, out, D, notes, ideas):
    """ORIGINALS.md: the batch's originals as a menu - a table, then each one's image and text."""
    lock = _lock(D, b)
    md = [f"# Round {b.round} originals · {b.title}", "",
          f"{len(posts)} one-off posts, each in a format the catalogue doesn't make: options, post the ones you like. "
          "Times are your local time." + (f" The round locks **{lock}**." if lock else ""),
          "Each folder's post.md has the reply with the link, the numbers behind the post, replies for the "
          "comments, and the Hebrew version.", "",
          "| # | When | Post | Format | Folder |", "|---|---|---|---|---|",
          *[f"| {i} | {p['when']} | {p['title']} | {p['format']} | [{p['id']}]({p['id']}/post.md) |"
            for i, p in enumerate(posts, 1)], ""]
    if notes:
        md += [*[f"- {x}" for x in notes], ""]
    for i, p in enumerate(posts, 1):
        md += ["---", "", f"## {i}. {p['title']} · {p['when']}", "", f"![{p['id']}]({p['id']}/{p['id']}.png)", "",
               *_fence(p["en"]), ""]
    if ideas:
        md += ["---", "", "## Other ideas (not made)", "", 'Say "make #N" for any of them.', "",
               *[f"{i}. {x}" for i, x in enumerate(ideas, len(posts) + 1)], ""]
    (out / "ORIGINALS.md").write_text("\n".join(md))


def update_plan(posts, b):
    """This batch's block at the end of social/POSTS.md - generate.py prepare keeps it for as
    long as the batch is current."""
    plan = g.OUT_ROOT / "POSTS.md"
    text = plan.read_text() if plan.exists() else "# EuroGuru posts\n"
    rel = b.rel
    block = [f"<!-- originals {rel} -->", "---", "", f"## ✦ Originals · Round {b.round} {b.title}",
             f"Options in their own formats - post the ones you like. The menu, with notes and other ideas: "
             f"[{rel}/ORIGINALS.md]({rel}/ORIGINALS.md)", "",
             "| When | Post | Format | Folder |", "|---|---|---|---|",
             *[f"| {p['when']} | ✦ {p['title']} | {p['format']} | [{rel}/{p['id']}]({rel}/{p['id']}/post.md) |"
               for p in posts], ""]
    for p in posts:
        folder = f"{rel}/{p['id']}"
        block += [f"### ✦ {p['title']} - post {p['when']}",
                  f"Folder: [`{folder}/`]({folder}/post.md) (the numbers behind it, answers for the comments "
                  "and the Hebrew version are in post.md)", "",
                  f"Attach: `{folder}/{p['id']}.png`", "", f"![{p['id']}]({folder}/{p['id']}.png)", "",
                  "#### Post", "", *_fence(p["en"]), "",
                  "#### Then reply to your own post with (the link goes here)", "", *_fence(_reply(b, p["id"], "en")), ""]
    block = "\n".join([*block, "<!-- /originals -->"])
    mine = next((m for m in g.ORIGINALS_BLOCK.finditer(text) if m.group(1) == rel), None)
    if mine:
        text = text[:mine.start()] + block + text[mine.end():]
    else:
        notes = text.find("\n---\n\n## Notes")
        text = (text[:notes + 1] + block + "\n" + text[notes:] if notes >= 0
                else text.rstrip("\n") + "\n\n" + block + "\n")
    if g.ORIGINALS_NOTE not in text:
        table = re.search(r"^\| # \| When \|.*\n(?:\|.*\n)*", text, re.M)
        if table:
            text = text[:table.end()] + "\n" + g.ORIGINALS_NOTE + "\n" + text[table.end():]
    plan.write_text(text)


# --- history: the formats already used --------------------------------------------------

def history():
    """Every original made so far, from each batch's ORIGINALS.md: batch, format, id, title."""
    rows = []
    for menu in sorted(g.OUT_ROOT.glob("round-*/*/ORIGINALS.md")):
        rel = menu.parent.relative_to(g.OUT_ROOT).as_posix()
        for line in menu.read_text().splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")] if line.startswith("|") else []
            if len(cells) >= 4 and cells[0].isdigit():
                pid = re.search(r"\[([^\]]+)\]", cells[-1])
                rows.append((rel, cells[3] if len(cells) >= 5 else "?", pid.group(1) if pid else cells[-1], cells[2]))
    if not rows:
        print("No originals yet.")
        return
    for rel, fmt, pid, title in rows:
        print(f"{rel:22} {fmt:32} {pid:32} {title}")
    print("\nThe code behind each batch's originals: social/<batch>/make.py")


# --- facts: the stories sheet ---------------------------------------------------------------

def facts(b, refresh=False):
    """Compact lists from the batch's data, lens by lens - raw material for ideas. Every
    number in it comes from the snapshot the batch's posts will use."""
    D = data(b, refresh)
    n, played = min_games(D), rounds_played(D)
    reg, ok = regulars(D), regulars(D, healthy=True)
    A = anatomy(D)
    say = print

    def nm(name):  # injured players carry their status, so nobody features them as a pick
        status = hurt(D, name)
        return g.display_name(name) + (f" ({status})" if status else "")
    f1 = lambda x: f"{x:.1f}"  # noqa: E731
    say(f"== Round {b.round} · {b.title} · data as of {local(D['pulled'])} · rounds 1-{played} played · "
        f"regulars = {n}+ games ({len(reg)} players) ==")

    # The round: games by day (your time), who the model favours, the coaches.
    games = sorted((x for x in D["games"] if x["round"] == b.round), key=lambda x: x["tipoff"])
    if games:
        say(f"-- Round {b.round} games (your time) · model's favourite · lock {local(games[0]['tipoff'])}")
        for d, xs in itertools.groupby(games, key=lambda x: local(x["tipoff"])[:10]):
            row = []
            for x in xs:
                f = fixture(D, x["home"], b.round)
                fav, win = (x["home"], f["win"]) if f["win"] >= 0.5 else (x["away"], 1 - f["win"])
                row.append(f"{x['home']}-{x['away']} {local(x['tipoff'])[-5:]} ({fav} {win:.0%}){' ✓' if x['played'] else ''}")
            say(f"  {d}: " + " · ".join(row))
        coach = sorted(((g.coach_outlook(fixture(D, c["TeamCode"], b.round)["margin"])[0], c) for c in D["coaches"]
                        if fixture(D, c["TeamCode"], b.round)), key=lambda t: -t[0])
        cs = lambda t: f"{t[1]['CoachName']} ({t[1]['TeamCode']}, {t[1]['CR']} CR) {t[0]:+.1f}"  # noqa: E731
        say("-- Coaches, expected points: " + " · ".join(map(cs, coach[:3])) + " | lowest: " + " · ".join(map(cs, coach[-2:])))

    # Matchups (the Matchups tab): who gets a soft defense, who a tough one.
    dvp = D["dvp"]
    teams = {t["code"]: t for t in dvp["teams"]}
    if b.mode == "pre":
        if dvp.get("round") != b.round:
            say(f"   (the Matchups data is for Round {dvp.get('round')})")
        picks = [p for p in dvp["picks"] if (p.get("fpt") or 0) >= 10 and not p.get("injury") and not hurt(D, p["player"])]
        pk = lambda p: (f"{nm(p['player'])} ({p['team']} {p['pos']}) vs {p['vs']} x{p['factor']:.2f} → {f1(p['projected'])} "  # noqa: E731
                        f"(avg {f1(p['fpt'])}; {p['vs']} {softness(teams[p['vs']]['pos'][p['pos']]['rank_p36'], len(teams))} "
                        f"on {p['pos']})")
        say("-- Matchups ☀️ +15% or more: " + " · ".join(map(pk, sorted((p for p in picks if p["factor"] >= 1.15),
                                                                          key=lambda p: -p["projected"])[:4])))
        say("-- Matchups ⛈️ -15% or less: " + " · ".join(map(pk, sorted((p for p in picks if p["factor"] <= 0.85),
                                                                          key=lambda p: -p["fpt"])[:4])))
        for pos in "GFC":
            order = sorted(teams.values(), key=lambda t: t["pos"][pos]["rank_p36"])
            say(f"   D vs {POS_WORD[pos]}: softest {', '.join(t['code'] for t in order[:3])} · "
                f"toughest {', '.join(t['code'] for t in order[::-1][:3])}")

    # Tonight / the round, from the boxscores - and the preview's forecasts graded.
    if b.mode != "pre":
        lines = [x for x in D.get("lines", []) if x["priced"]]
        say(f"-- {'Tonight' if b.mode == 'night' else f'Round {b.round}'}: {len({x['code'] for x in lines})} games final")
        top = sorted(lines, key=lambda x: -x["fpt"])
        say("   top: " + " · ".join(f"{nm(x['name'])} ({x['team']}) {f1(x['fpt'])} ({x['parts']['pts']}p "
                                    f"{x['parts']['reb']}r {x['parts']['ast']}a{', W' if x['won'] else ''})" for x in top[:8]))
        vs_avg = [(x["fpt"] - player(D, x["name"])["Average_Score"], x) for x in lines
                  if (player(D, x["name"])["Average_Score"] or 0) >= 8]
        vs_avg.sort(key=lambda t: -t[0])
        say("   over his average: " + " · ".join(f"{nm(x['name'])} {f1(x['fpt'])} ({d:+.1f})" for d, x in vs_avg[:5]))
        say("   under his average: " + " · ".join(f"{nm(x['name'])} {f1(x['fpt'])} ({d:+.1f})" for d, x in vs_avg[::-1][:5]))
        pre = g.OUT_ROOT / f"round-{b.round:02d}" / "pre" / ".data.json"
        if pre.exists():
            picks = {p["player"]: p for p in json.loads(pre.read_text())["dvp"]["picks"]}
            graded = sorted(((x["fpt"] - picks[x["name"]]["projected"], x, picks[x["name"]]) for x in lines
                             if x["name"] in picks and abs(picks[x["name"]]["factor"] - 1) >= 0.15), key=lambda t: abs(t[0]))
            say("   the preview's forecasts (±15% matchups), closest first: " + " · ".join(
                f"{nm(x['name'])} {f1(p['projected'])} → {f1(x['fpt'])}" for _, x, p in graded[:4])
                + " | furthest: " + " · ".join(f"{nm(x['name'])} {f1(p['projected'])} → {f1(x['fpt'])}"
                                                for _, x, p in graded[::-1][:3]))
        else:
            say("   (no preview snapshot for this round - no forecasts to grade)")

    # Leaders - and who would top them with fewer games.
    for key in ("fpt", "value", "per36"):
        label, f = METRICS[key]
        pool = [p for p in reg if key != "per36" or (p["Average_Minutes"] or 0) >= 10]
        top = sorted(pool, key=f, reverse=True)[:5]
        say(f"-- {label}: " + " · ".join(f"{nm(p['PlayerName'])} {f(p):.2f}" for p in top))
        say(f"   #1: {rank(D, top[0]['PlayerName'], key)}")

    # Same price: a star, or two cheaper players for exactly his price.
    by_cr = defaultdict(list)
    for p in ok:
        by_cr[round(p["CR"] * 10)].append(p)
    deals = {}
    for s in (p for p in ok if p["CR"] >= 15):
        for a in ok:
            for c in by_cr.get(round(s["CR"] * 10) - round(a["CR"] * 10), []):
                if s is not a and s is not c and a["PlayerName"] < c["PlayerName"]:
                    gap = a["Average_Score"] + c["Average_Score"] - s["Average_Score"]
                    if gap > deals.get(s["PlayerName"], (-99,))[0]:
                        deals[s["PlayerName"]] = (gap, s, a, c)
    best = sorted(deals.values(), key=lambda t: -t[0])[:4]
    say("-- Same price, one star or two: " + " · ".join(
        f"{nm(s['PlayerName'])} {s['CR']} CR {f1(s['Average_Score'])} = {nm(a['PlayerName'])} {a['CR']} + "
        f"{nm(c['PlayerName'])} {c['CR']} → {f1(a['Average_Score'] + c['Average_Score'])}" for _, s, a, c in best))

    # Same points, different FPT: what each FPT is made of.
    areg = [x for x in A.values() if x["games"] >= n and x["min"] >= 15]
    pairs = []
    for a, c in itertools.combinations([x for x in areg if x["cr"] >= 8], 2):
        if abs(a["parts"]["pts"] - c["parts"]["pts"]) <= 0.4:
            hi, lo = (a, c) if a["fpt"] > c["fpt"] else (c, a)
            pairs.append((hi["fpt"] - lo["fpt"], hi, lo))
    pairs.sort(key=lambda t: -t[0])
    seen, shown = set(), []
    for gap, h, lo in pairs:  # each player once, so the list isn't one player against everyone
        if h["name"] not in seen and lo["name"] not in seen:
            seen |= {h["name"], lo["name"]}
            shown.append((h, lo))
    say("-- Same points, different FPT: " + " · ".join(
        f"{nm(h['name'])} {f1(h['parts']['pts'])}p → {f1(h['fpt'])} vs {nm(lo['name'])} {f1(lo['parts']['pts'])}p → {f1(lo['fpt'])}"
        for h, lo in shown[:4]))
    beyond = sorted(areg, key=lambda x: x["fpt"] - x["parts"]["pts"])
    say("   FPT beyond his points, most: " + " · ".join(f"{nm(x['name'])} +{f1(x['fpt'] - x['parts']['pts'])}" for x in beyond[::-1][:4])
        + " | least: " + " · ".join(f"{nm(x['name'])} {x['fpt'] - x['parts']['pts']:+.1f}" for x in beyond[:3]))

    # The stats nobody counts: what earns FPT besides points, and what costs it.
    lens = {"fouls drawn": lambda x: x["parts"]["fd"], "rebounds": lambda x: x["parts"]["reb"],
            "steals + blocks": lambda x: x["parts"]["stl"] + x["parts"]["blk"], "win bonus": lambda x: x["bonus"],
            "turnovers (cost)": lambda x: -x["parts"]["to"], "fouls (cost)": lambda x: -x["parts"]["pf"] - x["parts"]["blka"],
            "missed shots (cost)": lambda x: -x["parts"]["miss"] - x["parts"]["missft"]}
    say("-- Hidden stats, a game: " + " | ".join(
        f"{label}: " + ", ".join(f"{nm(x['name'])} {f1(f(x))}" for x in sorted(areg, key=f, reverse=True)[:3])
        for label, f in lens.items()))

    # Form: the last 3 games against the season.
    moves = sorted(((form(D, p["PlayerName"]) - p["Average_Score"], p) for p in ok
                    if p["PlayerName"] in _lookup(D, "form") and p["Average_Score"] >= 8), key=lambda t: -t[0])
    say("-- Last 3 vs season, up: " + " · ".join(f"{nm(p['PlayerName'])} {f1(form(D, p['PlayerName']))} ({d:+.1f})" for d, p in moves[:5]))
    say("   down: " + " · ".join(f"{nm(p['PlayerName'])} {f1(form(D, p['PlayerName']))} ({d:+.1f})" for d, p in moves[::-1][:5]))

    # Boom or bust, among the top 30.
    top30 = sorted(reg, key=lambda p: -p["Average_Score"])[:30]
    swing = sorted(top30, key=lambda p: -(p["StdDev_Score"] or 0))
    say("-- Boom or bust (top 30, spread): " + " · ".join(
        f"{nm(p['PlayerName'])} ±{f1(p['StdDev_Score'])} (hi {f1(hi_lo(D, p['PlayerName'])[0])}, lo {f1(hi_lo(D, p['PlayerName'])[1])})"
        for p in swing[:4]))
    floors = sorted(top30, key=lambda p: -hi_lo(D, p["PlayerName"])[1])
    say("   steadiest: " + " · ".join(f"{nm(p['PlayerName'])} ±{f1(p['StdDev_Score'])}" for p in swing[::-1][:3])
        + " | best floor: " + " · ".join(f"{nm(p['PlayerName'])} never under {f1(hi_lo(D, p['PlayerName'])[1])}" for p in floors[:3]))

    # Prices since the start of the season.
    moved = [p for p in D["prices"]["players"] if p.get("change") is not None and p["playerName"] in _lookup(D, "stats")]
    moved.sort(key=lambda p: -p["change"])
    pm = lambda p: f"{nm(p['playerName'])} {p['first']}→{p['last']}"  # noqa: E731
    say("-- Price since Round 0, up: " + " · ".join(map(pm, moved[:5])) + " | down: " + " · ".join(map(pm, moved[::-1][:4])))

    # Last season against this one.
    jumps = []
    for p in reg:
        q = last(D, p["PlayerName"])
        if q and (q["GamesPlayed"] or 0) >= 10:
            moved_club = g.el_code(q) != g.el_code(p)
            jumps.append((p["Average_Score"] - q["Average_Score"], p, q, moved_club))
    jumps.sort(key=lambda t: -t[0])
    jp = lambda t: (f"{nm(t[1]['PlayerName'])} {f1(t[2]['Average_Score'])}→{f1(t[1]['Average_Score'])}"  # noqa: E731
                    + (f" ({g.el_code(t[2])}→{g.el_code(t[1])})" if t[3] else ""))
    say("-- Last season (10+ games) → now, up: " + " · ".join(map(jp, jumps[:5])))
    say("   down: " + " · ".join(map(jp, jumps[::-1][:3])))

    # Hindsight: the best scores of each round.
    by_round = defaultdict(list)
    for name, rows in D["logs"].items():
        for r, fpt in rows:
            by_round[r].append((fpt, name))
    say("-- Best of each round: " + " | ".join(
        f"R{r} " + ", ".join(f"{nm(name)} {f1(fpt)}" for fpt, name in sorted(by_round[r], reverse=True)[:2])
        for r in sorted(by_round)))

    # People: birthdays, countries, the tallest and the youngest.
    who = people(D)
    today = datetime.now().date()
    bdays = []
    for p in D["stats"]:
        r = who.get(p["PlayerName"])
        if r and r["born"] and (p["GamesPlayed"] or 0) >= 1:
            born = date.fromisoformat(r["born"])
            nxt = born.replace(year=today.year)
            if nxt < today:
                nxt = nxt.replace(year=today.year + 1)
            if (nxt - today).days <= 10:
                bdays.append((nxt, p, nxt.year - born.year))
    say("-- Birthdays in the next 10 days: " + (" · ".join(f"{nm(p['PlayerName'])} ({g.el_code(p)}) turns {age} {d:%a %d %b}"
                                                            for d, p, age in sorted(bdays, key=lambda t: t[0])) or "none"))
    nations = defaultdict(list)
    for p in reg:
        if who.get(p["PlayerName"], {}).get("country"):
            nations[who[p["PlayerName"]]["country"]].append(p)
    usa = nations.pop("United States of America", [])
    ranked = sorted(nations.items(), key=lambda t: -sum(p["Average_Score"] for p in t[1]))
    say(f"-- Countries (regulars; the USA has {len(usa)}), FPT a game added up: " + " · ".join(
        f"{c} {len(ps)}: {f1(sum(p['Average_Score'] for p in ps))} (best {nm(max(ps, key=lambda p: p['Average_Score'])['PlayerName'])})"
        for c, ps in ranked[:7]))
    known = [(p, who[p["PlayerName"]]) for p in top30 if p["PlayerName"] in who]
    tall = sorted((t for t in known if t[1]["height"]), key=lambda t: t[1]["height"])
    old = sorted((t for t in known if t[1]["born"]), key=lambda t: t[1]["born"])
    if tall and old:
        say(f"   top 30: shortest {nm(tall[0][0]['PlayerName'])} {tall[0][1]['height']} cm · tallest "
            f"{nm(tall[-1][0]['PlayerName'])} {tall[-1][1]['height']} cm · oldest {nm(old[0][0]['PlayerName'])} "
            f"(born {old[0][1]['born'][:4]}) · youngest {nm(old[-1][0]['PlayerName'])} (born {old[-1][1]['born'][:4]})")

    # The injury report: never feature these as a pick.
    status = defaultdict(list)
    for key, (tag, injury) in D["inj"].items():
        status[tag].append(f"{key.title()}{f' ({injury.lower()})' if injury else ''}")
    say("-- Injury report: " + " | ".join(f"{k}: {', '.join(sorted(v))}" for k, v in sorted(status.items())))


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("facts", "history", "sheet"):
        raise SystemExit(__doc__)
    if args[0] == "facts":
        if len(args) < 2:
            raise SystemExit("facts <batch folder>, e.g. social/round-09/pre")
        facts(batch(args[1]), refresh="--refresh" in args)
    elif args[0] == "history":
        history()
    else:
        sheet(args[1:])


if __name__ == "__main__":
    main()
