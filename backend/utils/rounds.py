# utils/rounds.py
"""
Each round's lineup lock and every game's tip-off, for the teams and Watch Rooms in
Supabase.

A team's lineup freezes at the round's first tip-off and opens again three hours after
its last one - enough for the last game to finish. The database enforces that window
(a trigger refuses lineup edits inside it, and a pg_cron job saves every team's lineup
when it starts), so it needs the windows in its `rounds` table. A Watch Room's chat is open from an hour
before each tip-off to an hour after the game, so the database also keeps every
game's tip-off, in `fixtures`.

While a round is on, a team can still sub and move the armband, but a player whose game
has started can only move down the lineup. So `fixtures` carries each game's two clubs,
and `player_clubs` each priced player's club, keyed like a lineup ("id:<n>").

They come from schedule_{season}.csv, whose dates and times are Paris time - the same
reading lib/live/schedule.js gives them. Rather than hold a service-role key for
Supabase, this module only prints the upsert; the /euroguru-data skill applies it
through the Supabase MCP after a promote, which is also when a postponed game would
have moved a window.

    python -m utils.rounds 2026 > rounds.sql   # the upserts: rounds, fixtures, player clubs
"""

import sys
from datetime import timedelta
from zoneinfo import ZoneInfo

import pandas as pd

PARIS = ZoneInfo("Europe/Paris")
UNLOCK_AFTER_LAST_TIPOFF = timedelta(hours=3)


def _tipoffs(schedule):
    """The schedule with a UTC `tipoff`; games without a parseable date or time dropped."""
    df = schedule.copy()
    tipoff = pd.to_datetime(df["Date"].astype(str) + " " + df["StartTime"].astype(str),
                            format="%Y-%m-%d %H:%M", errors="coerce")
    df["tipoff"] = tipoff.dt.tz_localize(PARIS, ambiguous="NaT", nonexistent="NaT").dt.tz_convert("UTC")
    return df[df["tipoff"].notna()]


def round_windows(schedule):
    """
    [{season, round, lock_at, unlock_at}] from a schedule frame, both datetimes UTC.

    A game without a parseable date or time is left out of its round's window rather
    than guessed at; a round with none left is skipped.
    """
    df = _tipoffs(schedule)

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


def _club(text):
    text = str(text).strip() if pd.notna(text) else ""
    return text or None


def fixtures(schedule):
    """[{season, game_code, round, tipoff, home, away}], tip-off in UTC - what the chat
    hours and the in-round subs read. Clubs are Euroleague codes."""
    df = _tipoffs(schedule)
    return [
        {"season": int(g.Season), "game_code": int(g.GameCode), "round": int(g.Round), "tipoff": g.tipoff,
         "home": _club(getattr(g, "HomeCode", None)), "away": _club(getattr(g, "AwayCode", None))}
        for g in df.itertuples(index=False)
        if pd.notna(g.Round) and pd.notna(g.GameCode)
    ]


def _text(value):
    """A SQL literal: quoted text, or null."""
    return "null" if value is None else "'" + str(value).replace("'", "''") + "'"


def fixtures_sql(games):
    """One statement that inserts or moves every game's tip-off and clubs."""
    if not games:
        return ""
    values = ",\n".join(
        f"  ({g['season']}, {g['game_code']}, {g['round']}, '{g['tipoff'].isoformat()}', "
        f"{_text(g.get('home'))}, {_text(g.get('away'))})"
        for g in games
    )
    return (
        "insert into public.fixtures (season, game_code, round, tipoff, home, away) values\n"
        f"{values}\n"
        "on conflict (season, game_code) do update\n"
        "  set round = excluded.round, tipoff = excluded.tipoff, home = excluded.home, away = excluded.away;"
    )


def player_clubs(season, df):
    """
    [{season, player_key, club}]: each priced player's current club, as a Euroleague code -
    his latest game's club, or for a player with no game yet the fantasy game's club,
    translated (the same reading /api/headshots makes). Only players keyed by id, the
    only keys a lineup holds.
    """
    from utils.data_processing import DUNKEST_TEAM_CODES

    if df.empty or not {"PlayerKey", "TeamCode"} <= set(df.columns):
        return []
    roster = df[df["CR"].notna()] if "CR" in df.columns else df
    roster = roster[roster["PlayerKey"].astype(str).str.match(r"^id:\d+$")]
    if "GameCode" in roster.columns:
        roster = roster.sort_values("GameCode", na_position="first")
    latest = roster.groupby("PlayerKey").last()
    out = []
    for key, row in latest.iterrows():
        club = _club(row.get("TeamCode")) or DUNKEST_TEAM_CODES.get(str(row.get("Team", "")).strip().upper())
        if club:
            out.append({"season": int(season), "player_key": key, "club": club})
    return out


def player_clubs_sql(rows):
    """One statement that inserts or moves every player's club."""
    if not rows:
        return ""
    values = ",\n".join(f"  ({r['season']}, {_text(r['player_key'])}, {_text(r['club'])})" for r in rows)
    return (
        "insert into public.player_clubs (season, player_key, club) values\n"
        f"{values}\n"
        "on conflict (season, player_key) do update set club = excluded.club;"
    )


if __name__ == "__main__":
    from contextlib import redirect_stdout
    from utils.s3_utils import load_from_s3

    season = sys.argv[1] if len(sys.argv) > 1 else "2026"
    # The loaders print what they read; that goes to stderr, so stdout is only SQL.
    with redirect_stdout(sys.stderr):
        from main import get_data  # the merged player data every endpoint reads
        schedule = load_from_s3(f"schedule_{season}.csv")
        df = get_data(season)
    print(upsert_sql(round_windows(schedule)))
    print()
    print(fixtures_sql(fixtures(schedule)))
    print()
    print(player_clubs_sql(player_clubs(season, df)))
