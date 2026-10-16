# utils/coaches.py
"""
Head coaches: who coaches which club, and at what price.

The fantasy game prices a coach beside the players - the same stats table, with
"Head Coach" as a fourth position - and scores them on their club's result alone:

    win by 21+  +25     win by 11-20  +20     win by 1-10  +10
    lose by 1-10 -5     lose by 11-20 -10     lose by 21+  -20

That table reproduces every coach's season FPT exactly (checked against the API's
own win_1-10 ... loss_20 counts). The API also counts win_ot / loss_ot apart; no game
had gone to overtime when this was written, so what those are worth is unknown.

The players' files never see a coach (data_fetchers.POSITION_MAP drops them), so they
get ``coaches_{season}.csv`` of their own, rewritten by every CR fetch. The Live tab
does the scoring, from the live game feed; this only says who the coaches are.
"""

import threading

import pandas as pd

from .data_processing import DUNKEST_TEAM_CODES
from .s3_utils import list_bucket, load_from_s3, save_to_s3

COACH_POSITION = "Head Coach"


def coaches_key(season):
    return f"coaches_{season}.csv"


def coaches_frame(raw):
    """
    The coaches among the fantasy API's stats rows, one per club.

    TeamCode is the Euroleague code the live feed uses - what a coach's game is found
    by - translated with the same map the players' teams go through.
    """
    coaches = raw[raw["position"] == COACH_POSITION]
    team = coaches["team"].astype(str).str.strip().str.upper()
    return pd.DataFrame({
        "CoachID": coaches["PlayerID"],
        "CoachName": coaches["name"].astype(str).str.strip(),
        "Team": team,
        "TeamCode": team.map(DUNKEST_TEAM_CODES),
        "CR": pd.to_numeric(coaches["quotation"], errors="coerce"),
    }).sort_values("Team").reset_index(drop=True)


def save_coaches(raw, season):
    """Write the season's coaches file from the CR fetch's rows. Never raises."""
    try:
        df = coaches_frame(raw)
    except Exception as e:
        print(f"Head coaches not saved: {e}")
        return None
    if df.empty:
        print("No head coaches in the fantasy rows - coaches file left as it was.")
        return None
    key = coaches_key(season)
    save_to_s3(key, df)
    print(f"Head coaches saved to {key} ({len(df)} coaches)")
    return df


_cache = {}
_cache_lock = threading.Lock()


def coaches_payload(season, index=None):
    """
    The season's coaches as records, cached against the file's LastModified.

    Raises FileNotFoundError when no CR fetch has written the file for the season yet.
    """
    index = index if index is not None else list_bucket()
    key = coaches_key(season)
    if key not in index:
        raise FileNotFoundError(f"{key} is not in the bucket yet")

    cache_key = (season, index[key])
    with _cache_lock:
        if cache_key in _cache:
            return _cache[cache_key]

    df = load_from_s3(key)
    records = [
        {
            "CoachID": int(r.CoachID),
            "CoachName": r.CoachName,
            "Team": r.Team,
            "TeamCode": r.TeamCode if isinstance(r.TeamCode, str) else None,
            "CR": float(r.CR) if pd.notna(r.CR) else None,
        }
        for r in df.itertuples()
    ]

    with _cache_lock:
        _cache.clear()
        _cache[cache_key] = records
    return records
