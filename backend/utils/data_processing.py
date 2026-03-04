# utils/data_processing.py

import pandas as pd
import numpy as np
from .s3_utils import load_from_s3
from datetime import datetime, timedelta
from functools import lru_cache

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
):
    """
    Loads player stats and merges:
      1) most recent CR file: player_cr_data_YYYY-MM-DD.csv (walk back day-by-day)
      2) optional injury report (injury_report.csv) on PlayerName

    Returns a row-level dataframe with columns like:
      PlayerName, position, CR, PIR, ... , InjuryStatus, Injury
    """
    player_stats_df = load_from_s3(player_stats_file)

    # Find & load the most recent CR file
    cr_df, cr_key = _load_latest_cr_df(prefix=cr_prefix, max_lookback_days=max_lookback_days)
    print(f"Cr data loaded from file {cr_key}")

    # Align names: "Last, First" -> "First Last"
    def format_name(name: str):
        parts = name.split(", ")
        return f"{parts[1].capitalize()} {parts[0].capitalize()}" if len(parts) == 2 else name

    player_stats_df = player_stats_df.copy()
    player_stats_df["PlayerName"] = player_stats_df["PlayerName"].apply(format_name)

    # Merge CR
    merged_df = pd.merge(player_stats_df, cr_df, on="PlayerName", how="left")
    merged_df["CR"] = pd.to_numeric(merged_df.get("CR"), errors="coerce")
    if "position" in merged_df.columns:
        merged_df["position"] = merged_df["position"].astype(str)

    # Merge Injuries (optional)
    if include_injuries:
        try:
            inj_df = load_injuries_df(injuries_key)  # assumes you added this helper earlier
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


def _load_latest_cr_df(prefix: str = "player_cr_data_", max_lookback_days: int = 14):
    """
    Try to load the most recent CR CSV by walking back from today, up to max_lookback_days.
    Returns (cr_df, key) on success.
    Raises FileNotFoundError if none found.
    """
    today = datetime.today().date()
    last_error = None

    for d in range(max_lookback_days + 1):
        day = today - timedelta(days=d)
        key = f"{prefix}_{day.isoformat()}.csv"
        try:
            cr_df = load_from_s3(key)
            if cr_df is not None and not cr_df.empty:
                print('cr columns', cr_df.columns)
                return cr_df, key
        except FileNotFoundError as e:
            last_error = e
            # try previous day
        except Exception as e:
            # If some transient/read error occurs, skip this date and try earlier
            last_error = e
            # continue loop

    raise FileNotFoundError(
        f"No CR file found with prefix '{prefix}' in the last {max_lookback_days} days."
    ) from last_error

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
    Calculate average PIR and standard deviation for each player
    over the last X games, carrying CR/position and (if present) InjuryStatus/Injury.
    """
    if "PIR" not in df.columns:
        print("PIR data is not available. Some features may be limited.")
        return pd.DataFrame()

    df_sorted = df.sort_values("GameCode", ascending=False)

    # Build a dynamic aggregation map
    base_firsts = {"CR": "first", "position": "first"}
    if "InjuryStatus" in df_sorted.columns:
        base_firsts["InjuryStatus"] = "first"
    if "Injury" in df_sorted.columns:
        base_firsts["Injury"] = "first"

    if last_x_games == 1:
        # std is 0 for a single game
        last_games_stats = (
            df_sorted.groupby("PlayerName")
                     .head(last_x_games)
                     .groupby("PlayerName")
                     .agg({**{"PIR": "mean"}, **base_firsts})
                     .reset_index()
        )
        # rename to match previous schema
        last_games_stats = last_games_stats.rename(columns={"PIR": "Average_PIR"})
        last_games_stats["StdDev_PIR"] = 0.0
        # reorder columns (safe; keeps any optional cols at end)
        ordered = ["PlayerName", "Average_PIR", "StdDev_PIR", "CR", "position", "InjuryStatus", "Injury"]
        last_games_stats = last_games_stats.reindex(columns=[c for c in ordered if c in last_games_stats.columns] +
                                                   [c for c in last_games_stats.columns if c not in ordered])
    else:
        agg_map = {"PIR": ["mean", "std"], **base_firsts}
        last_games_stats = (
            df_sorted.groupby("PlayerName")
                     .head(last_x_games)
                     .groupby("PlayerName")
                     .agg(agg_map)
                     .reset_index()
        )
        # Flatten MultiIndex columns from agg
        last_games_stats.columns = [
            "PlayerName",
            "Average_PIR",
            "StdDev_PIR",
            *[k for k in base_firsts.keys()]  # CR, position, [InjuryStatus], [Injury] in the same order
        ]
        # same friendly order
        ordered = ["PlayerName", "Average_PIR", "StdDev_PIR", "CR", "position", "InjuryStatus", "Injury"]
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
    
    # Columns to average
    stats_cols = {
        "PIR": "PIR",
        "Points": "Points",
        "TotalRebounds": "Rebounds",
        "Assistances": "Assists",
        "Steals": "Steals",
        "Turnovers": "Turnovers"
    }
    
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
    
    # Rounding
    for c in grouped.columns:
        if c.startswith("Average_"):
            grouped[c] = grouped[c].round(1)

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
@lru_cache(maxsize=32)
def load_injuries_df(key: str = "injury_report.csv") -> pd.DataFrame:
    """
    Load injuries CSV from S3 and normalize column names:
    expects columns like: player, team, position, injury, status (others are ignored).
    """
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

    return df

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
