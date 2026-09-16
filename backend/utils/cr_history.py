# utils/cr_history.py
"""
CR (price) history, assembled from the dated snapshots already in S3.

The fetcher has been writing one immutable ``player_cr_data_YYYY-MM-DD.csv`` per run
since the 2025-26 season, but nothing ever read more than the newest one. This module
stitches them into a per-season time series.

Two artefacts, deliberately:

  * the dated snapshots are the **source of truth** - append-only, never rewritten,
    so a bad run can only ever spoil a single day;
  * ``cr_history_{season}.csv`` is a **derived rollup**, regenerated from scratch by
    rebuild_cr_history(). Losing or corrupting it costs nothing.

Keeping the history in one appended file instead would mean rewriting every price we
have ever recorded on every run, since save_to_s3 is always a full put_object.
"""

import re
import threading
import unicodedata
from datetime import datetime

import pandas as pd

from .s3_utils import list_bucket, load_from_s3, save_to_s3
# season_for_date lives in data_processing because the CR-key resolution there needs it
# too, and importing it the other way round would make the two modules circular.
from .data_processing import _CR_KEY_RE, _name_key, season_for_date

SNAPSHOT_PREFIX = "player_cr_data"
HISTORY_PREFIX = "cr_history"

# The rollup's schema. Round is NaN for every snapshot written before the fetcher
# started stamping it, which is all of the 2025-26 season.
HISTORY_COLUMNS = [
    "Season", "Date", "Round", "PlayerID", "SeriesKey", "PlayerKey", "PlayerName",
    "position", "Team", "CR",
]


def _full_name_key(name: str) -> str:
    """
    Like data_processing._name_key but keeping the whole first name.

    _name_key truncates to an initial because that is all the two data sources share
    ("S. Larkin" vs "LARKIN, SHANE"), and that truncation collides real players:
    Carlik and Chris Jones both become "C|JONES", as do Devon and Donta Hall, and
    Moses and Mckinley Wright. Keeping the first name splits them again.
    """
    text = unicodedata.normalize("NFKD", str(name))
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = text.replace("-", " ").replace("'", "").replace(".", "")
    text = re.sub(r"\s+", " ", text).strip()

    if "," in text:
        last, first = text.split(",", 1)
    else:
        tokens = text.split(" ")
        first, last = (tokens[0], " ".join(tokens[1:])) if len(tokens) > 1 else ("", text)

    return f"{first.strip()}|{last.strip()}"


def _series_keys(df):
    """
    A stable per-player identity for one snapshot, good enough to never lose anyone.

    Each era of snapshots carries exactly enough to identify its own players, just not
    the same thing:

      * 2026-09-07 onwards - abbreviated names ("S. Vezenkov") but a real PlayerID.
      * everything before   - no PlayerID, but full names ("Carlik Jones").

    So prefer the id and fall back to the full name. The rollup is split by season and
    no season straddles the migration, so a key never has to span both forms.
    """
    # df.get() on a missing column returns None, and to_numeric(None) is a scalar NaN
    # rather than a column, so the absent case is made explicit.
    ids = (
        pd.to_numeric(df["PlayerID"], errors="coerce") if "PlayerID" in df.columns
        else pd.Series(pd.NA, index=df.index, dtype="Float64")
    )
    names = df["PlayerName"].map(_full_name_key)
    return [
        f"id:{int(pid)}" if pd.notna(pid) else name
        for pid, name in zip(ids, names)
    ]


def _snapshot_keys(index):
    """Dated CR snapshots, oldest first. The undated legacy file never matches."""
    keys = []
    for key in index:
        match = _CR_KEY_RE.match(key)
        if not match or match.group("prefix") != SNAPSHOT_PREFIX:
            continue
        try:
            datetime.strptime(match.group("date"), "%Y-%m-%d")
        except ValueError:
            continue
        keys.append(key)
    return sorted(keys)


def _snapshot_frame(key):
    """
    One snapshot, normalised to HISTORY_COLUMNS.

    Snapshots written before the Dunkest migration carry only PlayerName, CR and
    position - no PlayerID, Team, Season or Round - so every column is filled in
    defensively rather than assumed.
    """
    day = _CR_KEY_RE.match(key).group("date")
    df = load_from_s3(key)
    if df.empty or "PlayerName" not in df.columns or "CR" not in df.columns:
        return pd.DataFrame(columns=HISTORY_COLUMNS)

    out = pd.DataFrame({
        # The snapshot may carry its own Season/Round now; the filename date is still
        # authoritative for Season, since that is what splits the rollup files.
        "Season": season_for_date(day),
        "Date": day,
        "Round": pd.to_numeric(df.get("Round"), errors="coerce"),
        "PlayerID": pd.to_numeric(df.get("PlayerID"), errors="coerce"),
        "SeriesKey": _series_keys(df),
        # Kept alongside SeriesKey so a caller can still join this against the merged
        # stats frame, which identifies players by the initial+surname key everywhere.
        "PlayerKey": df["PlayerName"].map(_name_key),
        "PlayerName": df["PlayerName"].astype(str).str.strip(),
        "position": df.get("position", pd.Series(index=df.index, dtype=object)),
        "Team": df.get("Team", pd.Series(index=df.index, dtype=object)),
        "CR": pd.to_numeric(df["CR"], errors="coerce"),
    })
    return out.dropna(subset=["CR"])


def _drop_ambiguous(df):
    """
    Remove series keys that mean two different players on the same day.

    _series_keys resolves the known collisions, so this should now find nothing; it
    stays as the guard for a case neither an id nor a full name can separate - genuine
    namesakes in the same snapshot. There the existing merge rule applies: a wrong CR
    is worse than a missing one.

    Returns (frame, dropped_row_count).
    """
    conflicts = (
        df.groupby(["Date", "SeriesKey"])["CR"].nunique(dropna=True)
        .reset_index(name="_distinct")
    )
    bad = conflicts[conflicts["_distinct"] > 1][["Date", "SeriesKey"]]
    if bad.empty:
        return df, 0

    marked = df.merge(bad.assign(_bad=True), on=["Date", "SeriesKey"], how="left")
    kept = marked[marked["_bad"].isna()].drop(columns=["_bad"])
    return kept, len(df) - len(kept)


def build_cr_history_frame(index=None):
    """
    Every dated snapshot stitched into one long frame. Reads only; writes nothing.

    One row per player per snapshot date, identified by SeriesKey (see _series_keys).
    """
    index = index if index is not None else list_bucket()
    keys = _snapshot_keys(index)
    if not keys:
        return pd.DataFrame(columns=HISTORY_COLUMNS)

    frames = [f for f in (_snapshot_frame(k) for k in keys) if not f.empty]
    if not frames:
        return pd.DataFrame(columns=HISTORY_COLUMNS)

    history = pd.concat(frames, ignore_index=True)
    history, dropped = _drop_ambiguous(history)
    if dropped:
        print(f"CR history: dropped {dropped} rows with ambiguous name keys")

    history = history.drop_duplicates(subset=["Date", "SeriesKey"], keep="last")
    return history.sort_values(["Season", "Date", "SeriesKey"], ignore_index=True)[HISTORY_COLUMNS]


def history_key(season):
    return f"{HISTORY_PREFIX}_{season}.csv"


def rebuild_cr_history(index=None):
    """
    Regenerate every cr_history_{season}.csv from the snapshots.

    Idempotent and non-destructive: it reads the snapshots, writes only cr_history_*
    keys, and rebuilding after a corrupted write loses nothing. Returns {season: rows}.
    """
    history = build_cr_history_frame(index)
    if history.empty:
        print("CR history: no snapshots found, nothing to write.")
        return {}

    written = {}
    for season, group in history.groupby("Season"):
        key = history_key(season)
        save_to_s3(key, group.reset_index(drop=True))
        written[season] = len(group)
        print(f"CR history: {key} <- {len(group)} rows, "
              f"{group['Date'].nunique()} snapshots, {group['SeriesKey'].nunique()} players")
    return written


def load_cr_history(season, index=None):
    """
    A season's history, from the rollup when it exists and from the snapshots when it
    does not, so the endpoint works before rebuild_cr_history() has ever run.
    """
    index = index if index is not None else list_bucket()
    key = history_key(season)
    if key in index:
        df = load_from_s3(key)
        if not df.empty:
            return df

    history = build_cr_history_frame(index)
    if history.empty:
        return history
    return history[history["Season"] == str(season)].reset_index(drop=True)


_payload_cache = {}
_payload_lock = threading.Lock()
_PAYLOAD_MAX_ENTRIES = 8


def cr_history_payload(season, index=None):
    """
    The API response for one season, cached against the S3 objects it was built from.

    Same invalidation rule as the merged-frame cache in data_processing: the key
    carries every source object's LastModified, so a fresh snapshot or a rebuilt
    rollup is picked up on the next request with no TTL and no restart.
    """
    index = index if index is not None else list_bucket()
    key = history_key(season)

    if key in index:
        cache_key = (season, key, index[key])
    else:
        # Falling back to the snapshots - the cache key has to cover all of them.
        cache_key = (season, tuple((k, index[k]) for k in _snapshot_keys(index)))

    with _payload_lock:
        hit = _payload_cache.get(cache_key)
    if hit is not None:
        return hit

    df = load_cr_history(season, index)
    payload = {"season": str(season), "players": series_by_player(df)}

    with _payload_lock:
        if cache_key not in _payload_cache and len(_payload_cache) >= _PAYLOAD_MAX_ENTRIES:
            _payload_cache.pop(next(iter(_payload_cache)))
        _payload_cache[cache_key] = payload
    return payload


def series_by_player(df):
    """
    Long frame -> one record per player, newest-price-last, ordered by biggest riser.

    'first' and 'last' are that player's own first and last observed prices, which is
    not necessarily the season's first and last snapshot: players get priced mid-season
    and drop out, and pretending otherwise would invent movement that never happened.
    """
    if df.empty:
        return []

    df = df.sort_values(["SeriesKey", "Date"])
    players = []
    for key, group in df.groupby("SeriesKey", sort=False):
        crs = group["CR"].tolist()
        latest = group.iloc[-1]
        players.append({
            "playerKey": key,
            "nameKey": latest["PlayerKey"],
            "playerName": latest["PlayerName"],
            "position": latest["position"] if pd.notna(latest["position"]) else "",
            "team": latest["Team"] if pd.notna(latest["Team"]) else "",
            "first": crs[0],
            "last": crs[-1],
            "change": round(crs[-1] - crs[0], 2),
            "series": [
                {
                    "date": row.Date,
                    "round": None if pd.isna(row.Round) else int(row.Round),
                    "cr": row.CR,
                }
                for row in group.itertuples()
            ],
        })

    players.sort(key=lambda p: p["change"], reverse=True)
    return players
