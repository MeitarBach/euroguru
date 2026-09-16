# utils/data_processing.py

import re
import threading
import unicodedata
import pandas as pd
import numpy as np
from .s3_utils import load_from_s3, list_bucket
from datetime import datetime, timedelta

# Columns an archive stats file carries. Used to stand in for a missing S3 key,
# since load_from_s3 returns a column-less frame rather than raising.
STATS_BASE_COLUMNS = [
    "Season", "GameCode", "Team", "PlayerID", "PlayerName", "PIR",
    "MinutesPlayed", "Points", "TotalRebounds", "Assistances", "Steals",
    "Turnovers", "BlocksFavour", "Plusminus",
]

# Seasons were written by three different fetcher generations with three different
# vocabularies. Everything is folded onto the Euroleague boxscore names before any
# downstream code sees it, so the rest of the pipeline only knows one spelling.
COLUMN_ALIASES = {
    # 2024-era archive
    "Rebounds": "TotalRebounds",
    "Assists": "Assistances",
    "Blocks": "BlocksFavour",
    "Fouls": "FoulsCommited",
    # fantasy-API path
    "BlocksAgainst": "BlocksAgainst",
    "FoulsCommitted": "FoulsCommited",
    "FoulsDrawn": "FoulsReceived",
}

# Shot volume, needed for true shooting and usage.
_FGA_PARTS = ["FieldGoalsAttempted2", "FieldGoalsAttempted3"]
_FGM_PARTS = ["FieldGoalsMade2", "FieldGoalsMade3"]


def _parse_minutes(value):
    """
    "16:18" -> 16.3 minutes. "DNP", "", None -> NaN.

    The API reports minutes as a MM:SS string and marks non-appearances with the
    literal "DNP", so pd.to_numeric turns both into NaN and silently destroys the
    distinction between "played zero minutes" and "was not available". NaN is the
    honest answer for a DNP: it keeps them out of per-36 denominators and out of
    minutes averages instead of dragging them toward zero.
    """
    text = str(value).strip()
    if ":" not in text:
        return np.nan
    try:
        minutes, seconds = text.split(":")
        return int(minutes) + int(seconds) / 60
    except (ValueError, TypeError):
        return np.nan


def normalise_stats_columns(df):
    """Fold a season's column names onto the canonical vocabulary and derive minutes."""
    if df.empty:
        return df

    df = df.rename(columns={k: v for k, v in COLUMN_ALIASES.items() if k in df.columns})

    # The 2024 archive stores combined field goals plus a three-point split, so the
    # two-point split is recoverable by subtraction.
    if "FieldGoalsMade" in df.columns and "ThreePointersMade" in df.columns:
        for made_or_att, combined, threes in (
            ("Made", "FieldGoalsMade", "ThreePointersMade"),
            ("Attempted", "FieldGoalsAttempted", "ThreePointersAttempted"),
        ):
            if combined in df.columns and threes in df.columns:
                total = pd.to_numeric(df[combined], errors="coerce")
                three = pd.to_numeric(df[threes], errors="coerce")
                df[f"FieldGoals{made_or_att}3"] = three
                df[f"FieldGoals{made_or_att}2"] = total - three

    if "Minutes" in df.columns:
        df["MinutesPlayed"] = df["Minutes"].apply(_parse_minutes)

    return _drop_placeholder_columns(df)


# Stat columns that a real season cannot be uniformly zero in. The 2024 archive was
# written by a fetcher that only captured some fields and zero-filled the rest -
# Assists, FieldGoalsMade/Attempted and ThreePointers* are 0 in all 7,863 rows.
# Left alone they produce garbage: true shooting with no attempts divides points by
# free throws alone and reports 2840%.
_NEVER_ALL_ZERO = [
    "Points", "TotalRebounds", "Assistances", "Steals", "Turnovers",
    "FieldGoalsMade2", "FieldGoalsAttempted2", "FieldGoalsMade3", "FieldGoalsAttempted3",
    "FreeThrowsMade", "FreeThrowsAttempted", "Minutes",
]


def _drop_placeholder_columns(df, min_rows=50):
    """
    Discard stat columns that are zero in every row - they were never recorded.

    Only applied to whole-season frames (min_rows), since a genuinely all-zero column
    is plausible in a handful of games but not across thousands.
    """
    if len(df) < min_rows:
        return df

    dropped = []
    for col in _NEVER_ALL_ZERO:
        if col not in df.columns:
            continue
        values = pd.to_numeric(df[col], errors="coerce")
        if values.notna().any() and (values.fillna(0) == 0).all():
            dropped.append(col)

    if dropped:
        print(f"Ignoring never-recorded columns (all zero): {', '.join(dropped)}")
        df = df.drop(columns=dropped)
    return df


def _sum_available(df, columns):
    """Sum the columns that exist, as numerics. NaN when none are present."""
    present = [c for c in columns if c in df.columns]
    if not present:
        return pd.Series(np.nan, index=df.index, dtype="float64")
    return sum(pd.to_numeric(df[c], errors="coerce").fillna(0) for c in present)


def add_derived_stats(df):
    """
    Add the per-game rate metrics that actually drive fantasy decisions.

    Every metric is guarded on its inputs, because seasons differ in what they
    carry: 2024 has minutes and shooting but no plus-minus or starter flag, and the
    fantasy-sourced path has no minutes at all.
    """
    if df.empty:
        return df

    fga = _sum_available(df, _FGA_PARTS)
    fta = pd.to_numeric(df.get("FreeThrowsAttempted"), errors="coerce") \
        if "FreeThrowsAttempted" in df.columns else pd.Series(np.nan, index=df.index)
    tov = pd.to_numeric(df.get("Turnovers"), errors="coerce") \
        if "Turnovers" in df.columns else pd.Series(np.nan, index=df.index)
    pts = pd.to_numeric(df.get("Points"), errors="coerce") \
        if "Points" in df.columns else pd.Series(np.nan, index=df.index)

    if not fga.isna().all():
        df["FGA"] = fga
        df["FGM"] = _sum_available(df, _FGM_PARTS)

    # True shooting: points per shooting possession, where a trip to the line counts
    # as 0.44 of one. Zero attempts must be NaN, not 0% - a player who never shot
    # did not shoot badly.
    if not fga.isna().all() and not pts.isna().all():
        shooting_possessions = 2 * (fga + 0.44 * fta.fillna(0))
        df["TS%"] = 100 * pts / shooting_possessions.replace(0, np.nan)

    if "Assistances" in df.columns and "Turnovers" in df.columns:
        ast = pd.to_numeric(df["Assistances"], errors="coerce")
        df["AstTo"] = ast / tov.replace(0, np.nan)

    # Usage: share of the team's possessions a player used while on the floor.
    # Team totals come from the frame itself - every player in a game is present, so
    # grouping by game+team reconstructs the box score exactly.
    if "MinutesPlayed" in df.columns and not fga.isna().all() and {"GameCode", "Team"} <= set(df.columns):
        work = pd.DataFrame({
            "GameCode": df["GameCode"], "Team": df["Team"],
            "min": pd.to_numeric(df["MinutesPlayed"], errors="coerce").fillna(0),
            "fga": fga.fillna(0), "fta": fta.fillna(0), "tov": tov.fillna(0),
        })
        team = work.groupby(["GameCode", "Team"], dropna=False).agg(
            tmin=("min", "sum"), tfga=("fga", "sum"), tfta=("fta", "sum"), ttov=("tov", "sum")
        )
        joined = work.join(team, on=["GameCode", "Team"])
        player_poss = joined["fga"] + 0.44 * joined["fta"] + joined["tov"]
        team_poss = joined["tfga"] + 0.44 * joined["tfta"] + joined["ttov"]
        denominator = (joined["min"] * team_poss).replace(0, np.nan)
        df["Usage%"] = (100 * player_poss * (joined["tmin"] / 5) / denominator).values

    return df

# Dated CR snapshots: player_cr_data_YYYY-MM-DD.csv. The undated legacy
# player_cr_data.csv also sits in the bucket and must never match.
_CR_KEY_RE = re.compile(r"^(?P<prefix>.+)_(?P<date>\d{4}-\d{2}-\d{2})\.csv$")

# Merged frames keyed by the S3 objects they were built from, so a new upload
# invalidates them immediately rather than on a timer. Building one costs ~4s of
# S3 I/O while every downstream calculation is under 0.07s, so this is the whole
# difference between a slow page and an instant one. Frames are ~2.4MB each.
_frame_cache = {}
_injury_cache = {}
_cache_lock = threading.Lock()
_CACHE_MAX_ENTRIES = 8


def _cache_get(cache, key):
    with _cache_lock:
        return cache.get(key)


def _cache_put(cache, key, value):
    with _cache_lock:
        if key not in cache and len(cache) >= _CACHE_MAX_ENTRIES:
            cache.pop(next(iter(cache)))  # oldest insertion first
        cache[key] = value


def season_for_date(day):
    """
    Which season a calendar date belongs to.

    Euroleague seasons straddle two calendar years - 2025-26 runs October to May - and
    the app labels that season "2025". Play never starts before August, so the month
    alone decides it.

        2025-10-01 -> 2025      2026-03-06 -> 2025      2026-09-07 -> 2026
    """
    if isinstance(day, str):
        day = datetime.strptime(day, "%Y-%m-%d").date()
    return str(day.year if day.month >= 8 else day.year - 1)


def _dated_cr_keys(index, prefix="player_cr_data"):
    """Every dated snapshot as (key, date). The undated legacy file never matches."""
    found = []
    for key in index:
        match = _CR_KEY_RE.match(key)
        if not match or match.group("prefix") != prefix:
            continue
        try:
            day = datetime.strptime(match.group("date"), "%Y-%m-%d").date()
        except ValueError:
            continue
        found.append((key, day))
    return found


def _resolve_cr_key(index, season=None, prefix="player_cr_data", max_lookback_days=14):
    """
    Which CR snapshot to price a season from, chosen by the date in the filename.

    Filename date and LastModified genuinely disagree in this bucket - the
    2026-09-08 file was written on 2026-09-07 - and the filename is what the
    fetcher means by "that day's prices", so it wins.

    For a *past* season, the newest snapshot from within that season, with no lookback
    limit: those prices are final, and the 14-day window would hide every one of them.
    Without this, viewing 2025-26 priced Vezenkov at 17.0 - a September 2026 figure -
    when his season actually ended at 21.3, so the table and the price history
    contradicted each other.

    For the current season, or when the requested season has no snapshots of its own,
    the original behaviour: newest within the lookback window. Seasons 2023 and 2024
    predate any snapshot entirely and can only borrow current prices, which is what
    they have always done - a miss here would raise FileNotFoundError and 500 the app.
    """
    today = datetime.today().date()
    candidates = _dated_cr_keys(index, prefix)

    if season is not None and str(season) != season_for_date(today):
        in_season = [(k, d) for k, d in candidates if season_for_date(d) == str(season)]
        if in_season:
            return max(in_season, key=lambda pair: pair[1])[0]

    oldest = today - timedelta(days=max_lookback_days)
    in_window = [(k, d) for k, d in candidates if oldest <= d <= today]
    if not in_window:
        return None
    return max(in_window, key=lambda pair: pair[1])[0]


def format_name(name: str):
    """Align Euroleague's "Last, First" with the display form "First Last"."""
    parts = str(name).split(", ")
    return f"{parts[1].capitalize()} {parts[0].capitalize()}" if len(parts) == 2 else name


def _name_key(name: str) -> str:
    """
    Reduce a player name to an initial+surname key so the two sources can be joined.

    The fantasy API only exposes an abbreviated first name ("S. Larkin"), so that is
    the most information both sides share. All three encountered spellings collapse
    to the same key: "LARKIN, SHANE", "Shane Larkin" and "S. Larkin" -> "S|LARKIN".
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

    return f"{first.strip()[:1]}|{last.strip()}"


def score_metric(df):
    """Which metric the unified Score column holds for this frame."""
    if "FPT" in df.columns and df["FPT"].notna().any():
        return "FPT"
    return "PIR"

# def load_and_merge_data(player_stats_file: str,
#                         cr_prefix: str = "player_cr_data",
#                         max_lookback_days: int = 14):
#     """
#     Loads player stats and merges with the most recent CR data file named like:
#     player_cr_data_YYYY-MM-DD.csv. Walks back day-by-day if today's file is missing.
#     """
#     player_stats_df = load_from_s3(player_stats_file)
#
#     # Find & load the most recent CR file
#     cr_df, cr_key = _load_latest_cr_df(prefix=cr_prefix, max_lookback_days=max_lookback_days)
#     print(f"Cr data loaded from file {cr_key}")
#
#     # Align names: "Last, First" -> "First Last"
#     def format_name(name: str):
#         parts = name.split(", ")
#         return f"{parts[1].capitalize()} {parts[0].capitalize()}" if len(parts) == 2 else name
#
#     player_stats_df = player_stats_df.copy()
#     player_stats_df['PlayerName'] = player_stats_df['PlayerName'].apply(format_name)
#
#     merged_df = pd.merge(player_stats_df, cr_df, on="PlayerName", how="left")
#     merged_df['CR'] = pd.to_numeric(merged_df.get('CR'), errors='coerce')
#     if 'position' in merged_df.columns:
#         merged_df['position'] = merged_df['position'].astype(str)
#
#     return merged_df

def load_and_merge_data(
    player_stats_file: str,
    cr_prefix: str = "player_cr_data",
    max_lookback_days: int = 14,
    include_injuries: bool = True,
    injuries_key: str = "injury_report.csv",
    season: str = None,
):
    """
    Loads player stats and merges:
      1) most recent CR file: player_cr_data_YYYY-MM-DD.csv
      2) optional injury report (injury_report.csv) on PlayerName

    Returns a row-level dataframe with columns like:
      PlayerName, position, CR, PIR, ... , InjuryStatus, Injury

    Result is cached against the S3 objects it was built from. One bucket listing
    (~0.18s) both resolves which files to use and decides whether a cached frame is
    still current, so a fetch-script upload is picked up on the very next request
    without a restart or a TTL wait.

    `season` picks the prices: an archive season is priced from its own final snapshot
    rather than from today's. The cache key carries the resolved CR key, so two seasons
    pricing from different snapshots cache separately without any extra bookkeeping.
    """
    candidates = [player_stats_file] if isinstance(player_stats_file, str) else list(player_stats_file)
    index = list_bucket()
    cr_key = _resolve_cr_key(
        index, season=season, prefix=cr_prefix, max_lookback_days=max_lookback_days
    )

    # A season with no schedule file yet - 2023, or one whose fixtures are unpublished -
    # simply goes without the opponent columns rather than failing.
    schedule_key = f"schedule_{season}.csv" if season else None
    if schedule_key not in index:
        schedule_key = None

    cache_key = (
        tuple((c, index.get(c)) for c in candidates),
        cr_key,
        index.get(cr_key),
        schedule_key,
        index.get(schedule_key),
        injuries_key if include_injuries else None,
        index.get(injuries_key) if include_injuries else None,
    )
    cached = _cache_get(_frame_cache, cache_key)
    if cached is not None:
        # Hand out a copy: filter_by_cr_and_position returns a slice of its input,
        # so a caller writing to one would otherwise poison the cache.
        return cached.copy()

    merged_df = _build_merged_frame(
        candidates, cr_key, index, include_injuries, injuries_key, max_lookback_days,
        schedule_key,
    )
    _cache_put(_frame_cache, cache_key, merged_df)
    return merged_df.copy()


def _build_merged_frame(candidates, cr_key, index, include_injuries, injuries_key,
                        max_lookback_days, schedule_key=None):
    """Do the actual S3 loads and merges. Only runs on a cache miss."""
    player_stats_df, stats_key = _load_first_available(candidates)
    print(f"Player stats loaded from file {stats_key}")

    # Normalise before anything else touches the frame, so the merge, the aggregates
    # and the API all see one vocabulary regardless of which fetcher wrote the season.
    player_stats_df = normalise_stats_columns(player_stats_df)
    player_stats_df = add_derived_stats(player_stats_df)

    if cr_key is None:
        raise FileNotFoundError(
            f"No CR file found with prefix 'player_cr_data' in the last "
            f"{max_lookback_days} days."
        )
    cr_df = load_from_s3(cr_key)
    print(f"Cr data loaded from file {cr_key}")

    # Opponent, home/away, date and the real round. Joined before the CR merge, which
    # does an outer join that adds priced-but-gameless rows - those have no fixture and
    # would only dilute the coverage figure this reports.
    if schedule_key:
        schedule_df = load_from_s3(schedule_key)
        print(f"Schedule loaded from file {schedule_key}")
        player_stats_df = _merge_schedule(player_stats_df, schedule_df)

    # Fantasy-sourced rows carry FPT and share the CR file's player ids, so they join
    # exactly. Archive rows only share a name, which needs the fuzzy key.
    if "FPT" in player_stats_df.columns:
        merged_df = _merge_cr_by_player_id(player_stats_df, cr_df)
    else:
        merged_df = _merge_cr_by_name(player_stats_df, cr_df)

    merged_df["CR"] = pd.to_numeric(merged_df.get("CR"), errors="coerce")

    # A stable identity the client can join against the CR history, which is keyed by
    # the same function. Matching on the display name does not work: format_name turns
    # "WRIGHT IV, MCKINLEY" into "Mckinley Wright iv" while the snapshot spells him
    # "Mckinley Wright Iv", and the aggregations group by name so PlayerID is gone by
    # the time the API responds.
    merged_df["PlayerKey"] = merged_df["PlayerName"].apply(
        lambda name: _name_key(name) if pd.notna(name) else None
    )

    if "position" in merged_df.columns:
        # fillna before the cast: astype(str) would turn NaN into the string "nan",
        # which then shows up as a selectable entry in the position dropdown.
        merged_df["position"] = merged_df["position"].fillna("").astype(str)

    merged_df = _apply_score(merged_df)

    # Merge Injuries (optional)
    if include_injuries:
        try:
            inj_df = load_injuries_df(injuries_key, index=index)
        except Exception:
            inj_df = pd.DataFrame()

        if inj_df is not None and not inj_df.empty:
            # Keep only the minimal columns and de-duplicate by player
            cols = [c for c in ["Player", "InjuryStatus", "Injury"] if c in inj_df.columns]
            inj_min = inj_df[cols].drop_duplicates(subset=["Player"]) if "Player" in cols else pd.DataFrame()
            if not inj_min.empty:
                merged_df = merged_df.merge(
                    inj_min,
                    left_on="PlayerName",
                    right_on="Player",
                    how="left",
                    suffixes=("", "_inj"),
                ).drop(columns=[c for c in ["Player"] if c in merged_df.columns])

        # fill NaNs to keep hovers clean
        for c in ["InjuryStatus", "Injury"]:
            if c in merged_df.columns:
                merged_df[c] = merged_df[c].fillna("")

    return merged_df


def _load_first_available(candidates):
    """
    Load the first candidate stats file that actually has rows.

    Lets a season name both its fantasy-sourced file and the Euroleague fallback, and
    stands in a correctly-shaped empty frame when neither exists yet - load_from_s3
    returns a column-less frame for a missing key, which would blow up downstream.
    """
    if isinstance(candidates, str):
        candidates = [candidates]

    for filename in candidates:
        df = load_from_s3(filename)
        if df is not None and not df.empty:
            return df.copy(), filename

    return pd.DataFrame(columns=STATS_BASE_COLUMNS), (candidates[-1] if candidates else "")


def _cr_for_merge(cr_df):
    """
    Rename the CR side's identity columns so a merge cannot produce _x/_y pairs.
    Team in particular is read downstream by calculate_player_averages and the UI.
    """
    cr = cr_df.rename(columns={"PlayerName": "CRPlayerName", "Team": "CRTeam"})
    keep = ["PlayerID", "CRPlayerName", "CR", "position", "CRTeam"]
    return cr[[c for c in keep if c in cr.columns]].copy()


def _coalesce_identity(merged_df):
    """Fill identity columns from the CR side for players with no stats rows."""
    for target, source in (("PlayerName", "CRPlayerName"), ("Team", "CRTeam")):
        if source not in merged_df.columns:
            continue
        if target in merged_df.columns:
            merged_df[target] = merged_df[target].fillna(merged_df[source])
        else:
            merged_df[target] = merged_df[source]
        merged_df = merged_df.drop(columns=[source])
    return merged_df


def _merge_cr_by_player_id(stats_df, cr_df):
    """
    Current seasons: stats and CR come from the same API, so join on the stable
    player id. Pricing is refreshed from the latest CR file rather than trusting
    the copy frozen into each round's rows.
    """
    if "PlayerID" not in cr_df.columns or "PlayerID" not in stats_df.columns:
        return _merge_cr_by_name(stats_df, cr_df)

    stats_df = stats_df.drop(columns=[c for c in ["CR", "position"] if c in stats_df.columns])
    stats_df["PlayerID"] = pd.to_numeric(stats_df["PlayerID"], errors="coerce")

    cr = _cr_for_merge(cr_df)
    cr["PlayerID"] = pd.to_numeric(cr["PlayerID"], errors="coerce")
    cr = cr.drop_duplicates(subset=["PlayerID"], keep="last")

    merged = stats_df.merge(cr, on="PlayerID", how="outer")
    return _coalesce_identity(merged)


def _merge_cr_by_name(stats_df, cr_df):
    """
    Archive seasons and the Euroleague fallback: the sources share only a name, and
    the fantasy API abbreviates first names, so both sides reduce to _name_key.
    """
    stats_df = stats_df.copy()
    stats_df["_mk"] = stats_df["PlayerName"].apply(_name_key)
    stats_df["PlayerName"] = stats_df["PlayerName"].apply(format_name)

    cr = _cr_for_merge(cr_df)
    if "CRPlayerName" not in cr.columns:
        return stats_df.drop(columns=["_mk"])
    cr["_mk"] = cr["CRPlayerName"].apply(_name_key)

    # The API lists some players twice under different ids. Those rows agree on
    # everything that matters here, so collapse them rather than treating them as a
    # name clash - otherwise real players get dropped for being their own duplicate.
    dedupe_on = [c for c in ["_mk", "CR", "position", "CRTeam"] if c in cr.columns]
    cr = cr.drop_duplicates(subset=dedupe_on, keep="first")

    # What survives is a genuine collision: different players sharing a surname and
    # first initial (D. Hall of OLY vs MIL). Dropping the whole colliding group is
    # what keeps the merge from fanning out the stats frame and corrupting every
    # per-player aggregate - a wrong CR is worse than a missing one.
    ambiguous = cr["_mk"].duplicated(keep=False)
    if ambiguous.any():
        print(f"Dropping ambiguous CR names: {sorted(cr.loc[ambiguous, 'CRPlayerName'])}")
        cr = cr[~ambiguous]

    merged = stats_df.merge(cr.drop(columns=["PlayerID"], errors="ignore"), on="_mk", how="outer")
    merged = _coalesce_identity(merged)
    return merged.drop(columns=["_mk"])


SCHEDULE_COLUMNS = ["TeamCode", "Opponent", "OpponentName", "IsHome", "GameDate", "Round"]

# Dunkest and Euroleague both name the same 20 clubs but disagree on 11 of the codes.
# The fantasy stats carry Dunkest's, the schedule carries Euroleague's, and an opponent
# cannot be looked up without translating between them. Defined here rather than beside
# the fetcher because this is where it is consumed, and because data_fetchers already
# imports from this module.
DUNKEST_TEAM_CODES = {
    "ASV": "ASV",  # LDLC Asvel Villeurbanne
    "BAR": "BAR",  # FC Barcelona
    "BAY": "MUN",  # FC Bayern Munich
    "BJK": "BES",  # Besiktas Istanbul
    "CZV": "RED",  # Crvena Zvezda Belgrade
    "DUB": "DUB",  # Dubai Basketball
    "EFS": "IST",  # Anadolu Efes Istanbul
    "FBT": "ULK",  # Fenerbahce Istanbul
    "HTA": "HTA",  # Hapoel Tel Aviv
    "KBA": "BAS",  # Baskonia Vitoria-Gasteiz
    "MIL": "MIL",  # Olimpia Milan
    "MTA": "TEL",  # Maccabi Tel Aviv
    "OLY": "OLY",  # Olympiacos Piraeus
    "PAO": "PAN",  # Panathinaikos Athens
    "PAR": "PAR",  # Partizan Belgrade
    "PBB": "PRS",  # Paris Basketball
    "RMB": "MAD",  # Real Madrid
    "VBC": "PAM",  # Valencia Basket
    "VIR": "VIR",  # Virtus Bologna
    "ZAL": "ZAL",  # Zalgiris Kaunas
}

# Words that carry no club identity, so two teams are never matched on them.
_TEAM_STOPWORDS = {"BC", "FC", "BASKET", "BASKETBALL", "CLUB", "TEAM"}


def _team_tokens(name):
    text = unicodedata.normalize("NFKD", str(name))
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    return {t for t in text.split() if t and t not in _TEAM_STOPWORDS}


def _side_of(team, home_name, home_code, away_name, away_code):
    """
    Which side of a fixture a stats row's team is on: 'home', 'away', or None.

    The stats and the schedule do not agree on a team's name. Archive rows carry the full
    club name, which drifts with sponsorship *within a single season* - 2025-26 has both
    "BASKONIA VITORIA-GASTEIZ" and "KOSNER BASKONIA VITORIA-GASTEIZ" - while the 2023
    archive carries a three-letter code instead. So: try the code, then score the name by
    shared words and take the better side.

    A tie means the row cannot be placed, and None leaves the columns empty rather than
    guessing an opponent, which is the same rule the CR merge applies to ambiguous names.
    """
    value = str(team).strip().upper()
    if value and value == str(home_code).upper():
        return "home"
    if value and value == str(away_code).upper():
        return "away"

    tokens = _team_tokens(team)
    if not tokens:
        return None
    home_score = len(tokens & _team_tokens(home_name))
    away_score = len(tokens & _team_tokens(away_name))
    if home_score > away_score:
        return "home"
    if away_score > home_score:
        return "away"
    return None


def _merge_schedule(stats_df, schedule_df):
    """
    Attach the opponent, home/away, date and real round to every game row.

    Two join shapes, because GameCode means two different things depending on which
    fetcher wrote the season:

      * boxscore archives - GameCode is a game id, so it identifies the fixture directly;
      * the fantasy feed  - GameCode is the round, shared by every team that week, so the
        fixture is found by (round, team) instead.

    Rows that cannot be placed keep empty values. Reporting a wrong opponent would be
    worse than reporting none, and silence here would be invisible in the UI.
    """
    if stats_df.empty or schedule_df is None or schedule_df.empty:
        return stats_df
    if "GameCode" not in stats_df.columns or "Team" not in stats_df.columns:
        return stats_df

    schedule = schedule_df.copy()
    schedule["GameCode"] = pd.to_numeric(schedule["GameCode"], errors="coerce")
    schedule = schedule.dropna(subset=["GameCode"])

    fantasy = "FPT" in stats_df.columns
    if fantasy:
        # One row per (round, team): each club plays once a round, so this is unique.
        lookup = {}
        for row in schedule.itertuples():
            rnd = row.Round
            if pd.isna(rnd):
                continue
            lookup[(int(rnd), row.HomeCode)] = (row.HomeCode, row.AwayCode, row.AwayTeam,
                                                True, row.Date, int(rnd))
            lookup[(int(rnd), row.AwayCode)] = (row.AwayCode, row.HomeCode, row.HomeTeam,
                                                False, row.Date, int(rnd))
    else:
        fixtures = {int(r.GameCode): r for r in schedule.itertuples()}

    codes = pd.to_numeric(stats_df["GameCode"], errors="coerce")
    resolved = []
    unmapped = set()
    for game_code, team in zip(codes, stats_df["Team"]):
        if pd.isna(game_code):
            resolved.append((None,) * 6)
            continue

        if fantasy:
            # The fantasy feed uses Dunkest's team codes, not Euroleague's.
            dunkest_code = str(team).strip().upper()
            euro_code = DUNKEST_TEAM_CODES.get(dunkest_code)
            if euro_code is None:
                unmapped.add(dunkest_code)
            resolved.append(lookup.get((int(game_code), euro_code), (None,) * 6))
            continue

        fixture = fixtures.get(int(game_code))
        if fixture is None:
            resolved.append((None,) * 6)
            continue

        side = _side_of(team, fixture.HomeTeam, fixture.HomeCode,
                        fixture.AwayTeam, fixture.AwayCode)
        if side is None:
            resolved.append((None,) * 6)
        elif side == "home":
            resolved.append((fixture.HomeCode, fixture.AwayCode, fixture.AwayTeam,
                             True, fixture.Date,
                             None if pd.isna(fixture.Round) else int(fixture.Round)))
        else:
            resolved.append((fixture.AwayCode, fixture.HomeCode, fixture.HomeTeam,
                             False, fixture.Date,
                             None if pd.isna(fixture.Round) else int(fixture.Round)))

    out = stats_df.copy()
    for i, column in enumerate(SCHEDULE_COLUMNS):
        out[column] = [item[i] for item in resolved]

    # Nullable integer, not float: a column of ints with a None in it becomes float64,
    # and the API would then serve round 47 as 47.0 for the UI to render verbatim.
    out["Round"] = pd.array(out["Round"], dtype="Int64")

    if unmapped:
        # A club that joined the league since this map was written. Loud, because the
        # symptom is a silently empty opponent for every one of that team's players.
        print(f"Schedule merge: unknown Dunkest team codes {sorted(unmapped)} - "
              "add them to DUNKEST_TEAM_CODES")

    placed = out["Opponent"].notna().sum()
    total = len(out)
    if placed < total:
        print(f"Schedule merge: {total - placed} of {total} rows have no fixture match")
    return out


def _apply_score(df):
    """
    Unified metric column: fantasy points where the source provides them, PIR for the
    archive seasons that predate the fantasy API. Comparing the two across seasons is
    meaningless, but only one season is ever in view, and the API reports which metric
    is in play via score_metric() so the UI can label the column honestly.
    """
    if score_metric(df) == "FPT":
        score = pd.to_numeric(df["FPT"], errors="coerce")
        if "PIR" in df.columns:
            score = score.fillna(pd.to_numeric(df["PIR"], errors="coerce"))
    elif "PIR" in df.columns:
        score = pd.to_numeric(df["PIR"], errors="coerce")
    else:
        score = pd.Series(np.nan, index=df.index, dtype="float64")

    df["Score"] = score
    return df


def _load_latest_cr_df(prefix: str = "player_cr_data", max_lookback_days: int = 14):
    """
    Load the most recent CR CSV within the lookback window. Returns (cr_df, key).
    Raises FileNotFoundError if none found.

    Previously this probed S3 day by day, costing up to 15 sequential GETs (1.9s
    measured) to find one file. One bucket listing answers the same question.
    """
    index = list_bucket()
    key = _resolve_cr_key(index, prefix=prefix, max_lookback_days=max_lookback_days)
    if key is None:
        raise FileNotFoundError(
            f"No CR file found with prefix '{prefix}' in the last {max_lookback_days} days."
        )
    return load_from_s3(key), key


def filter_by_cr_and_position(df, min_cr, max_cr, position):
    """
    Filter the dataframe by CR range and position.
    """
    if position != "All":
        df = df[df['position'] == position]
    return df[(df['CR'] >= min_cr) & (df['CR'] <= max_cr)]

# def calculate_pir_stats(df, last_x_games):
#     """
#     Calculate average PIR and standard deviation for each player
#     considering the last X games.
#     """
#     if 'PIR' not in df.columns:
#         print("PIR data is not available. Some features may be limited.")
#         return pd.DataFrame()
#
#     df_sorted = df.sort_values('GameCode', ascending=False)
#
#     # If user selects "1" game, standard deviation is always zero for that single game
#     if last_x_games == 1:
#         last_games_stats = (
#             df_sorted.groupby('PlayerName')
#                      .head(last_x_games)
#                      .groupby('PlayerName')
#                      .agg({'PIR': 'mean', 'CR': 'first', 'position': 'first'})
#                      .reset_index()
#         )
#         last_games_stats['StdDev_PIR'] = 0
#         last_games_stats.columns = ['PlayerName', 'Average_PIR', 'CR', 'position', 'StdDev_PIR']
#     else:
#         last_games_stats = (
#             df_sorted.groupby('PlayerName')
#                      .head(last_x_games)
#                      .groupby('PlayerName')
#                      .agg({'PIR': ['mean', 'std'], 'CR': 'first', 'position': 'first'})
#                      .reset_index()
#         )
#         last_games_stats.columns = ['PlayerName', 'Average_PIR', 'StdDev_PIR', 'CR', 'position']
#
#     return last_games_stats

def calculate_pir_stats(df, last_x_games):
    """
    Calculate the average score and standard deviation for each player over the last
    X games, carrying CR/position and (if present) InjuryStatus/Injury.

    Operates on the unified Score column (fantasy points for current seasons, PIR for
    the archives) - see _apply_score.
    """
    if "Score" not in df.columns:
        print("Score data is not available. Some features may be limited.")
        return pd.DataFrame()

    df_sorted = df.sort_values("GameCode", ascending=False)

    # Build a dynamic aggregation map. Team is carried so the dashboard widgets can
    # show it - they render it, and without it every row showed a blank team.
    base_firsts = {"CR": "first", "position": "first"}
    if "Team" in df_sorted.columns:
        base_firsts["Team"] = "first"
    # See calculate_player_averages: constant within a PlayerName group.
    if "PlayerKey" in df_sorted.columns:
        base_firsts["PlayerKey"] = "first"
    if "InjuryStatus" in df_sorted.columns:
        base_firsts["InjuryStatus"] = "first"
    if "Injury" in df_sorted.columns:
        base_firsts["Injury"] = "first"

    ordered = ["PlayerName", "Average_Score", "StdDev_Score", "Average_Minutes",
               "CR", "position", "InjuryStatus", "Injury"]

    # Minutes averages honestly; TS% and Usage% are ratios and are recomputed from
    # totals afterwards rather than averaged per game.
    extra_means = {c: "mean" for c in ["MinutesPlayed"] if c in df_sorted.columns}

    if last_x_games == 1:
        # std is 0 for a single game
        last_games_stats = (
            df_sorted.groupby("PlayerName")
                     .head(last_x_games)
                     .groupby("PlayerName")
                     .agg({"Score": "mean", **extra_means, **base_firsts})
                     .reset_index()
        )
        last_games_stats = last_games_stats.rename(columns={"Score": "Average_Score"})
        last_games_stats["StdDev_Score"] = 0.0
    else:
        agg_map = {"Score": ["mean", "std"], **extra_means, **base_firsts}
        last_games_stats = (
            df_sorted.groupby("PlayerName")
                     .head(last_x_games)
                     .groupby("PlayerName")
                     .agg(agg_map)
                     .reset_index()
        )
        # Flatten by NAME, not by position. This previously assigned a hand-written
        # list of labels over whatever pandas emitted, so adding any aggregate
        # shifted every following column - republishing CR values under another
        # column's name with no error raised. Joining the MultiIndex levels keeps
        # each value attached to the column it came from.
        last_games_stats.columns = [
            "_".join(part for part in col if part).strip("_") if isinstance(col, tuple) else col
            for col in last_games_stats.columns
        ]
        last_games_stats = last_games_stats.rename(columns={
            "Score_mean": "Average_Score",
            "Score_std": "StdDev_Score",
            **{f"{col}_first": col for col in base_firsts},
            **{f"{col}_mean": col for col in extra_means},
        })

    # Present the rate stats under the same Average_* convention the rest of the API
    # uses, so the frontend has one naming rule to follow.
    last_games_stats = last_games_stats.rename(columns={"MinutesPlayed": "Average_Minutes"})

    rates = (
        df_sorted.groupby("PlayerName")
                 .head(last_x_games)
                 .groupby("PlayerName")
                 .apply(_rate_aggregates, include_groups=False)
                 .apply(pd.Series)
                 .reset_index()
    )
    if not rates.empty and len(rates.columns) > 1:
        last_games_stats = last_games_stats.merge(rates, on="PlayerName", how="left")
    for col in ["Average_Score", "StdDev_Score", "Average_Minutes", "Average_TS", "Average_Usage"]:
        if col in last_games_stats.columns:
            last_games_stats[col] = pd.to_numeric(last_games_stats[col], errors="coerce").round(1)

    # friendly order (safe; keeps any optional cols at end)
    last_games_stats = last_games_stats.reindex(columns=[c for c in ordered if c in last_games_stats.columns] +
                                               [c for c in last_games_stats.columns if c not in ordered])

    return last_games_stats

def calculate_player_averages(df, last_x_games):
    """
    Calculate average stats (Points, Reb, Ast, PIR) for each player
    over the last X games. Returns row-level averages.
    """
    if df.empty:
        return pd.DataFrame()

    df_sorted = df.sort_values("GameCode", ascending=False)
    
    # Columns to average. Score is the unified metric; the rest depend on what the
    # season's source actually carried, and missing ones are skipped below.
    stats_cols = {
        "Score": "Score",
        "MinutesPlayed": "Minutes",
        "Points": "Points",
        "TotalRebounds": "Rebounds",
        "Assistances": "Assists",
        "Steals": "Steals",
        "Turnovers": "Turnovers",
        "BlocksFavour": "Blocks",
        "OffensiveRebounds": "OffRebounds",
        "Plusminus": "PlusMinus",
        "FGA": "FGA",
    }
    # TS%, Usage% and AST/TO are deliberately NOT in this map. They are ratios, and
    # the mean of per-game ratios is not the season ratio - one 1-for-1 night can
    # score 300% true shooting and drag the average into nonsense (2024 produced an
    # "average" TS of 725%). They are computed from summed components below instead.

    # Ensure they exist and are numeric
    valid_cols = []
    rename_map = {}
    for col, new_name in stats_cols.items():
        if col in df.columns:
            valid_cols.append(col)
            rename_map[col] = new_name
            # Ensure numeric
            df_sorted[col] = pd.to_numeric(df_sorted[col], errors='coerce')

    if not valid_cols:
        return df # return raw if no stats
    
    base_firsts = {"CR": "first", "position": "first", "Team": "first"}
    # Constant within a group - the grouping is by PlayerName and the key is derived
    # from it - so "first" is exact, not a sample.
    if "PlayerKey" in df_sorted.columns:
        base_firsts["PlayerKey"] = "first"
    if "InjuryStatus" in df_sorted.columns:
        base_firsts["InjuryStatus"] = "first"

    # Aggregation
    agg_map = {c: "mean" for c in valid_cols}
    agg_map.update(base_firsts)
    # Also count games
    agg_map["GameCode"] = "count"

    grouped = (
        df_sorted.groupby("PlayerName")
                 .head(last_x_games)
                 .groupby("PlayerName")
                 .agg(agg_map)
                 .reset_index()
    )
    
    # Rename for frontend friendliness
    # e.g. Points -> Average_Points
    final_rename = {k: f"Average_{v}" for k, v in rename_map.items()}
    final_rename["GameCode"] = "GamesPlayed"
    grouped = grouped.rename(columns=final_rename)

    grouped = _add_season_derived(grouped, df_sorted, last_x_games)

    # Rounding
    for c in grouped.columns:
        if c.startswith("Average_"):
            grouped[c] = grouped[c].round(1)

    return grouped


def _rate_aggregates(window):
    """
    Season rates built from summed components, never from averaged per-game ratios.

    A ratio has to be recomputed from its totals: true shooting is season points over
    season shooting possessions. Usage is the exception - a correct season figure
    needs team totals per game - so it is averaged, but weighted by minutes so a
    two-minute cameo cannot count as much as a full game.
    """
    out = {}
    total = lambda col: pd.to_numeric(window[col], errors="coerce").fillna(0).sum() \
        if col in window.columns else np.nan

    pts, fga, fta = total("Points"), total("FGA"), total("FreeThrowsAttempted")
    if not pd.isna(pts) and not pd.isna(fga):
        shooting_possessions = 2 * (fga + 0.44 * (0 if pd.isna(fta) else fta))
        out["Average_TS"] = round(100 * pts / shooting_possessions, 1) if shooting_possessions else np.nan

    ast, tov = total("Assistances"), total("Turnovers")
    if not pd.isna(ast) and not pd.isna(tov):
        out["Average_AstTo"] = round(ast / tov, 2) if tov else np.nan

    if "Usage%" in window.columns and "MinutesPlayed" in window.columns:
        usage = pd.to_numeric(window["Usage%"], errors="coerce")
        minutes = pd.to_numeric(window["MinutesPlayed"], errors="coerce")
        valid = usage.notna() & minutes.notna() & (minutes > 0)
        if valid.any():
            out["Average_Usage"] = round(
                float((usage[valid] * minutes[valid]).sum() / minutes[valid].sum()), 1
            )

    return out


def _add_season_derived(grouped, df_sorted, last_x_games):
    """
    Metrics that only make sense once per-game rows have been aggregated:
    rate-per-36, value for money, form, and how often the player starts.
    """
    window = df_sorted.groupby("PlayerName").head(last_x_games)
    rates = (
        window.groupby("PlayerName")
              .apply(_rate_aggregates, include_groups=False)
              .apply(pd.Series)
              .reset_index()
    )
    if not rates.empty and len(rates.columns) > 1:
        grouped = grouped.merge(rates, on="PlayerName", how="left")

    # Volatility of the score. Computed here rather than in the caller's agg_map:
    # that map is a flat {column: "mean"} and a two-aggregate entry would turn its
    # result into a MultiIndex, which is the positional-flatten hazard that had to be
    # rewritten out of calculate_pir_stats. A separate groupby keeps the shape flat.
    if "Score" in df_sorted.columns:
        spread = (
            window.groupby("PlayerName")["Score"]
                  .std()
                  .round(1)
                  .reset_index(name="StdDev_Score")
        )
        grouped = grouped.merge(spread, on="PlayerName", how="left")

    if "Average_Score" in grouped.columns and "Average_Minutes" in grouped.columns:
        minutes = grouped["Average_Minutes"].replace(0, np.nan)
        grouped["Per36_Score"] = (grouped["Average_Score"] / minutes * 36).round(1)

    # Value: score per credit. The single most direct answer to "is this player
    # worth their price".
    if "Average_Score" in grouped.columns and "CR" in grouped.columns:
        cr = pd.to_numeric(grouped["CR"], errors="coerce").replace(0, np.nan)
        grouped["Value"] = (grouped["Average_Score"] / cr).round(3)

    # Form and minutes trend: last 3 games against the window's own baseline, so a
    # rising role or a cooling streak is visible without reading a game log.
    recent = (
        df_sorted.groupby("PlayerName")
                 .head(3)
                 .groupby("PlayerName")
                 .agg(_recent_score=("Score", "mean"),
                      **({"_recent_minutes": ("MinutesPlayed", "mean")}
                         if "MinutesPlayed" in df_sorted.columns else {}))
                 .reset_index()
    )
    grouped = grouped.merge(recent, on="PlayerName", how="left")

    if "Average_Score" in grouped.columns:
        grouped["Form"] = (grouped["_recent_score"] - grouped["Average_Score"]).round(1)
    if "_recent_minutes" in grouped.columns and "Average_Minutes" in grouped.columns:
        grouped["MinutesTrend"] = (grouped["_recent_minutes"] - grouped["Average_Minutes"]).round(1)
    grouped = grouped.drop(columns=[c for c in ["_recent_score", "_recent_minutes"]
                                    if c in grouped.columns])

    # Starter rate over the same window.
    if "IsStarter" in df_sorted.columns:
        starts = (
            df_sorted.groupby("PlayerName")
                     .head(last_x_games)
                     .groupby("PlayerName")["IsStarter"]
                     .apply(lambda s: 100 * pd.to_numeric(s, errors="coerce").fillna(0).mean())
                     .reset_index(name="StarterPct")
        )
        grouped = grouped.merge(starts, on="PlayerName", how="left")
        grouped["StarterPct"] = grouped["StarterPct"].round(0)

    return grouped

def get_dominant_players(df):
    """
    Filter out players that are 'dominated' by others in terms of PIR.
    A player A is dominated if another player B has a higher Average_PIR
    and a lower StdDev_PIR.
    """
    if df.empty:
        return df

    dominant_players = []
    for i, player in df.iterrows():
        dominated = False
        for j, other_player in df.iterrows():
            if (other_player['Average_PIR'] > player['Average_PIR'] and
                    other_player['StdDev_PIR'] < player['StdDev_PIR']):
                dominated = True
                break
        if not dominated:
            dominant_players.append(player)
    return pd.DataFrame(dominant_players)

# --- Injuries helpers --- #
def load_injuries_df(key: str = "injury_report.csv", index=None) -> pd.DataFrame:
    """
    Load injuries CSV from S3 and normalize column names:
    expects columns like: player, team, position, injury, status (others are ignored).

    Cached against the object's LastModified. This used to be @lru_cache'd, which
    never expired - the report is refetched daily but a long-running server would
    serve the copy it read at startup forever. Pass `index` to reuse a listing the
    caller already has instead of taking another one.
    """
    if index is None:
        index = list_bucket()

    cache_key = (key, index.get(key))
    cached = _cache_get(_injury_cache, cache_key)
    if cached is not None:
        return cached.copy()

    try:
        df = load_from_s3(key)
    except Exception as e:
        print(f"Could not load injuries: {e}")
        return pd.DataFrame()

    if df is None or df.empty:
        return pd.DataFrame()

    # Map raw -> canonical
    rename = {
        "firstname": "First Name",
        "lastname": "Last Name",
        "player": "Player",
        "team": "Team",
        "position": "Position",
        "injury": "Injury",
        "status": "InjuryStatus",
    }
    df = df.rename(columns={c: rename.get(c, c) for c in df.columns})

    # Light cleanup
    for c in ["Player", "Team", "Position", "Injury", "InjuryStatus", "Notes"]:
        if c in df.columns:
            df[c] = df[c].astype(str).str.strip()

    # Friendly sort if available
    sort_cols = [c for c in ["Team", "Player"] if c in df.columns]
    if sort_cols:
        df = df.sort_values(sort_cols).reset_index(drop=True)

    _cache_put(_injury_cache, cache_key, df)
    return df.copy()

def add_injury_badge(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds 'InjuryBadge' column used in Plotly hover.
    Only two cases are shown:
      - OUT  -> '<br><b>Injury Status:</b> OUT (Reason) ❌'
      - Game Time Decision -> '<br><b>Injury Status:</b> Game Time Decision (Reason) ❔'
    Everything else → empty string (nothing shown).
    """
    out = df.copy()
    if out.empty:
        out["InjuryBadge"] = ""
        return out

    def fmt(status, detail):
        s = (str(status or "").strip())
        d = str(detail or "").strip()
        reason = f" ({d})" if d else ""

        # normalize for comparison, but preserve display text
        sl = s.lower()

        if sl == "out":
            return f"<br><b>Injury Status:</b> OUT{reason} ❌"
        if sl == "game time decision":
            return f"<br><b>Injury Status:</b> Game Time Decision{reason} ❓"
        return ""  # any other value → show nothing

    status_col = "InjuryStatus" if "InjuryStatus" in out.columns else None
    injury_col = "Injury" if "Injury" in out.columns else None

    if status_col:
        out["InjuryBadge"] = [
            fmt(out.at[i, status_col], out.at[i, injury_col] if injury_col else "")
            for i in out.index
        ]
    else:
        out["InjuryBadge"] = ""

    return out
