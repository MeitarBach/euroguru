# utils/rounds.py
"""
Each round's lineup lock, for the teams and leagues in Supabase.

A team's lineup freezes at the round's first tip-off and opens again three hours after
its last one - enough for the last game to finish. The database enforces that window
(a trigger refuses lineup edits inside it, and a pg_cron job saves every team's lineup
when it starts), so it needs the windows in its `rounds` table.

They come from schedule_{season}.csv, whose dates and times are Paris time - the same
reading lib/live/schedule.js gives them. Rather than hold a service-role key for
Supabase, this module only prints the upsert; the /euroguru-data skill applies it
through the Supabase MCP after a promote, which is also when a postponed game would
have moved a window.

    python -m utils.rounds 2026 > rounds.sql
"""

import sys
from datetime import timedelta
from zoneinfo import ZoneInfo

import pandas as pd

PARIS = ZoneInfo("Europe/Paris")
UNLOCK_AFTER_LAST_TIPOFF = timedelta(hours=3)


def round_windows(schedule):
    """
    [{season, round, lock_at, unlock_at}] from a schedule frame, both datetimes UTC.

    A game without a parseable date or time is left out of its round's window rather
    than guessed at; a round with none left is skipped.
    """
    df = schedule.copy()
    tipoff = pd.to_datetime(df["Date"].astype(str) + " " + df["StartTime"].astype(str),
                            format="%Y-%m-%d %H:%M", errors="coerce")
    df["tipoff"] = tipoff.dt.tz_localize(PARIS, ambiguous="NaT", nonexistent="NaT").dt.tz_convert("UTC")
    df = df[df["tipoff"].notna()]

    windows = []
    for (season, rnd), games in df.groupby(["Season", "Round"]):
        windows.append({
            "season": int(season),
            "round": int(rnd),
            "lock_at": games["tipoff"].min(),
            "unlock_at": games["tipoff"].max() + UNLOCK_AFTER_LAST_TIPOFF,
        })
    return sorted(windows, key=lambda w: (w["season"], w["round"]))


def upsert_sql(windows):
    """One statement that inserts or moves every window."""
    if not windows:
        return ""
    values = ",\n".join(
        f"  ({w['season']}, {w['round']}, '{w['lock_at'].isoformat()}', '{w['unlock_at'].isoformat()}')"
        for w in windows
    )
    return (
        "insert into public.rounds (season, round, lock_at, unlock_at) values\n"
        f"{values}\n"
        "on conflict (season, round) do update\n"
        "  set lock_at = excluded.lock_at, unlock_at = excluded.unlock_at;"
    )


if __name__ == "__main__":
    from utils.s3_utils import load_from_s3

    season = sys.argv[1] if len(sys.argv) > 1 else "2026"
    print(upsert_sql(round_windows(load_from_s3(f"schedule_{season}.csv"))))
