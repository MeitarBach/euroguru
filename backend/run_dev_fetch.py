import os
import sys

from utils.data_fetchers import (
    backfill_player_stats,
    fetch_and_save_cr_data,
    fetch_and_update_fantasy_stats,
    fetch_and_update_player_stats,
    fetch_and_save_injury_report,
    fetch_and_save_defense_vs_position_data,
    fetch_and_save_schedule,
    latest_round,
)
from utils.cr_history import rebuild_cr_history

# The season the nightly fetch keeps up to date. Named rather than repeated so the
# stats files, the schedule and the season label cannot drift apart.
CURRENT_SEASON = "2026"


def _refuse_to_write_to_prod():
    """
    Stop a fetch that would write straight into the prod bucket.

    Everything below overwrites objects in whatever BUCKET_NAME points at, with data
    that has not been looked at yet. Prod is supposed to receive data only through
    promote.py, after it has rendered correctly locally - a stray BUCKET_NAME would
    otherwise route a half-finished backfill directly to the deployed app.
    """
    from utils.s3_utils import BUCKET_NAME

    prod = os.environ.get("PROD_BUCKET_NAME", "euroguru-prod")
    if BUCKET_NAME == prod:
        print(f"Refusing to run: BUCKET_NAME is {BUCKET_NAME!r}, the prod bucket.")
        print("Fetchers write unreviewed data. Point BUCKET_NAME at dev and use")
        print("`python promote.py` to publish once you have checked the result.")
        sys.exit(2)


def show_status(season="2025"):
    """
    Report what a season's stats file actually contains, without touching the API.

    Safe to run at any time, including while a backfill is in flight - it only reads
    the file that has been saved to S3 so far.

        python run_dev_fetch.py --status 2025
    """
    import pandas as pd
    from utils.s3_utils import load_from_s3

    data_file = f"player_stats_{season}.csv"
    df = load_from_s3(data_file)
    if df.empty:
        print(f"{data_file}: not present in S3 (or empty).")
        return 1

    games = sorted(pd.to_numeric(df["GameCode"], errors="coerce").dropna().astype(int).unique())
    full = set()
    if "Minutes" in df.columns:
        complete = df[df["Minutes"].notna()]
        full = set(pd.to_numeric(complete["GameCode"], errors="coerce").dropna().astype(int))

    print(f"{data_file}")
    print(f"  rows            : {len(df)}")
    print(f"  columns         : {len(df.columns)}")
    print(f"  games stored    : {len(games)}  (range {games[0]}-{games[-1]})")
    print(f"  full boxscore   : {len(full)} games")
    print(f"  players         : {df['PlayerName'].nunique()}")

    # Gaps *inside* the stored range. Anything past the highest stored game simply
    # has not been reached yet, which is a different thing from a hole and must not
    # be reported as "complete".
    highest = games[-1]
    gaps = [g for g in range(1, highest + 1) if g not in full]
    if gaps:
        runs, start, prev = [], gaps[0], gaps[0]
        for g in gaps[1:]:
            if g != prev + 1:
                runs.append((start, prev))
                start = g
            prev = g
        runs.append((start, prev))
        pretty = ", ".join(f"{a}" if a == b else f"{a}-{b}" for a, b in runs[:20])
        print(f"  gaps in 1-{highest}   : {len(gaps)} games -> {pretty}"
              + (" ..." if len(runs) > 20 else ""))
    else:
        print(f"  gaps in 1-{highest}   : none")

    # A full Euroleague season runs to roughly 400 games including playoffs.
    if highest < 400:
        print(f"  not yet reached : games {highest + 1}+ "
              f"(a full season runs to ~406; run --backfill {season} to continue)")
    return 0


def run_backfill(season="2025"):
    """
    Fill in the full boxscore (minutes, shooting splits, plus-minus) for a season.

    Safe to run repeatedly and designed to be: the Euroleague API throttles after
    roughly 75 consecutive requests, so one pass rarely covers a whole season. Each
    run picks up where the last left off and merges its results in.

        python run_dev_fetch.py --backfill 2025
    """
    data_file = f"player_stats_{season}.csv"
    season_code = f"E{season}"
    print(f"Backfilling {data_file} from {season_code}...")
    backfill_player_stats(data_file, season_code)
    return 0

def run_schedule(season):
    """
    Fetch one season's fixture list: who played whom, home or away, on what date.

    Archive seasons need this run once - their fixtures never change - which is what
    gives the game log an opponent for 2024 and 2025.

        python run_dev_fetch.py --schedule 2025
    """
    print(f"Fetching schedule for {season}...")
    fetch_and_save_schedule(season)
    return 0


def run_fetch():
    print("Starting manual fetch for DEV bucket...")

    # CR is load-bearing: every endpoint merges it, so a failure here breaks the
    # whole app. Tracked separately so the run can exit non-zero instead of
    # printing an error nobody notices.
    cr_ok = True

    # Rounds first, only so the CR snapshot can be stamped with the round it belongs
    # to - the price API does not report one. A failure here must not stop CR from
    # being fetched, so the round simply stays unknown.
    print("\n--- Fetching/Updating Fantasy Player Stats ---")
    round_number = None
    try:
        fantasy_df = fetch_and_update_fantasy_stats(
            "player_stats_fantasy_2026.csv", season_label="E2026"
        )
        round_number = latest_round(fantasy_df)
        print(f"Fantasy player stats updated successfully (latest round: {round_number}).")
    except Exception as e:
        print(f"Error updating fantasy player stats: {e}")

    print("\n--- Fetching CR Data ---")
    try:
        fetch_and_save_cr_data(round_number=round_number)
        print("CR Data fetched successfully.")
    except Exception as e:
        cr_ok = False
        print(f"Error fetching CR Data: {e}")

    # Derived from the dated snapshots above; safe to re-run and never touches them.
    print("\n--- Rebuilding CR History ---")
    try:
        rebuild_cr_history()
        print("CR history rebuilt successfully.")
    except Exception as e:
        print(f"Error rebuilding CR history: {e}")

    # Fallback source, kept until the per-round fantasy ingest has been validated
    # against real games. See the plan's "unvalidatable dependency" note.
    print("\n--- Fetching/Updating Player Stats (Euroleague fallback) ---")
    try:
        fetch_and_update_player_stats("player_stats_2026.csv", "E2026")
        print("Player Stats updated successfully.")
    except Exception as e:
        print(f"Error updating Player Stats: {e}")

    # The only source that knows who played whom, where and when. Cheap (one request)
    # and worth re-running: unplayed fixtures get rescheduled through the season.
    print("\n--- Fetching Schedule ---")
    try:
        fetch_and_save_schedule(CURRENT_SEASON)
        print("Schedule fetched successfully.")
    except Exception as e:
        print(f"Error fetching Schedule: {e}")

    print("\n--- Fetching Injury Report ---")
    try:
        fetch_and_save_injury_report()
        print("Injury Report fetched successfully.")
    except Exception as e:
        print(f"Error fetching Injury Report: {e}")

    print("\n--- Fetching Defense vs Position ---")
    try:
        fetch_and_save_defense_vs_position_data()
        print("Defense vs Position fetched successfully.")
    except Exception as e:
        print(f"Error fetching Defense vs Position: {e}")

    print("\nAll tasks completed.")
    return 0 if cr_ok else 1

if __name__ == "__main__":
    # --status is read-only; everything else writes.
    if "--status" not in sys.argv:
        _refuse_to_write_to_prod()

    if "--status" in sys.argv:
        idx = sys.argv.index("--status")
        season = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else "2025"
        sys.exit(show_status(season))
    if "--backfill" in sys.argv:
        idx = sys.argv.index("--backfill")
        season = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else "2025"
        sys.exit(run_backfill(season))
    if "--schedule" in sys.argv:
        idx = sys.argv.index("--schedule")
        season = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else CURRENT_SEASON
        sys.exit(run_schedule(season))
    sys.exit(run_fetch())
