# utils/headshots.py
"""
Every priced player's official headshot, for the Live tab's court view.

The photos live with EuroLeague (its people API lists each club's roster with an image
URL per player); nothing is stored here. The fantasy data knows a player only by the
fantasy game's id and an abbreviated name, so the two are joined the way the social
cards' headshot() does it - club + initial + surname, then looser - and a match counts
only when exactly one person fits, which keeps namesakes (two C. Joneses) apart.

Clubs come along too: coaches have no photo, so their tile shows the club's crest. So do
the players' full names ("Kendrick Nunn" for the fantasy game's "K. Nunn"), which the
player searches match against - nobody types an initial.

Kept in memory for half a day per season; the endpoint is edge-cached on top of that,
so EuroLeague is asked about once a day. A failure answers empty maps - the court falls
back to initials rather than the page failing.
"""

import re
import threading
import time

import requests

from .data_processing import _name_key, DUNKEST_TEAM_CODES

PEOPLE_URL = ("https://api-live.euroleague.net/v2/competitions/E/seasons/E{season}/people"
              "?personType=J&limit=1000")  # players only; the default page stops at 500
TTL_SECONDS = 12 * 3600

_cache = {}
_lock = threading.Lock()

SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}


def _key(name):
    """_name_key() without a generational suffix: EuroLeague writes "BACOT JR., ARMANDO",
    the fantasy game "A. Bacot" or "P. Baldwin Jr". Also drops the "(CZV)" the app adds
    to tell namesakes apart."""
    initial, surname = _name_key(re.sub(r"\s*\([^)]*\)$", "", str(name))).split("|", 1)
    return f"{initial}|{' '.join(w for w in surname.split() if w not in SUFFIXES)}"


def _full_name(name):
    """EuroLeague's "NUNN, KENDRICK" / "WRIGHT IV, MCKINLEY" as "Kendrick Nunn" / "Mckinley Wright Iv"."""
    last, _, first = str(name).partition(",")
    return " ".join(f"{first.strip()} {last.strip()}".split()).title()


def _people(season):
    """[{club, key, surname, code, name, url, active}] for everyone with a headshot, and {club: crest}."""
    res = requests.get(PEOPLE_URL.format(season=season), timeout=10)
    res.raise_for_status()
    people, crests = [], {}
    for row in res.json().get("data", []):
        club = (row.get("club") or {})
        code = club.get("code")
        crest = (club.get("images") or {}).get("crest")
        if code and crest:
            crests.setdefault(code, crest)
        url = (row.get("images") or {}).get("headshot")
        if row.get("type") != "J" or not url or not code:
            continue
        key = _key(row["person"]["name"])
        people.append({"club": code, "key": key, "surname": key.split("|", 1)[1],
                       "code": row["person"]["code"], "name": _full_name(row["person"]["name"]),
                       "url": url, "active": row.get("active")})
    return people, crests


def _match(name, club, people):
    """The one person this player is, or None when no rule gives a single answer.
    Within his club first; by name alone only when his club is unknown - a known club
    with no match means no photo, not a namesake's (Milan's M. Wright is not Dubai's)."""
    key = _key(name)
    surname = key.split("|", 1)[1]
    same = [p for p in people if p["surname"] == surname]
    pools = [[p for p in same if p["club"] == club and p["key"] == key],
             [p for p in same if p["club"] == club]]
    if not club:
        pools.append([p for p in same if p["key"] == key])
    for pool in pools:
        if len({p["code"] for p in pool}) == 1:
            return sorted(pool, key=lambda p: not p["active"])[0]
    return None


def headshots_payload(season, df):
    """{"players": {PlayerKey: url}, "names": {PlayerKey: full name}, "crests": {club code: url}}
    for the season's priced players."""
    season = str(season)
    with _lock:
        hit = _cache.get(season)
        if hit and time.time() - hit[0] < TTL_SECONDS:
            return hit[1]

    try:
        people, crests = _people(season)
    except Exception as exc:  # a missing photo is a cosmetic loss, not a failed page
        print(f"[headshots] people API unavailable for {season}: {exc}")
        return {"players": {}, "names": {}, "crests": {}}

    players, names = {}, {}
    if not df.empty and {"PlayerKey", "PlayerName", "TeamCode"} <= set(df.columns):
        roster = df[df["CR"].notna()] if "CR" in df.columns else df
        # The latest club of each player, as calculate_player_averages reports it.
        latest = roster.sort_values("GameCode", na_position="first").groupby("PlayerKey").last()
        for key, row in latest.iterrows():
            # A player with no game yet has only the fantasy game's club code.
            club = row["TeamCode"] if isinstance(row["TeamCode"], str) else \
                DUNKEST_TEAM_CODES.get(str(row.get("Team", "")).strip().upper())
            person = _match(row["PlayerName"], club, people)
            if person:
                players[key] = person["url"]
                names[key] = person["name"]

    payload = {"players": players, "names": names, "crests": crests}
    with _lock:
        _cache[season] = (time.time(), payload)
    return payload
