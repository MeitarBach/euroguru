# utils/data_fetchers.py

import os
import time
import xml.etree.ElementTree as ET
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from .s3_utils import load_from_s3, save_to_s3
from .cr_history import season_for_date

load_dotenv()

FANTASY_API_BASE = "https://fantaking-api.dunkest.com/api/v1"
FANTASY_ORIGIN = "https://euroleaguefantasy.euroleaguebasketball.net"
FANTASY_PAGE_SIZE = 100  # the API rejects per_page > 100

# Dunkest prices head coaches alongside players ("Head Coach" is a 4th position
# value); the analytics only cover players, so anything outside this map is dropped.
POSITION_MAP = {"Guard": "G", "Forward": "F", "Center": "C"}

# The round table has no minutes column, so a row with every counting stat at zero
# is indistinguishable from a genuine scoreless game. Treating it as a DNP keeps
# bench players from dragging every average down. Flip to False once real round
# data confirms how the API represents a player who did not play.
DROP_ALL_ZERO_ROWS = True

# API column -> our column. Names on the right match the map already used by
# calculate_player_averages() so its Average_* output works without changes.
FANTASY_STAT_COLUMNS = {
    "pts": "Points",
    "reb": "TotalRebounds",
    "ast": "Assistances",
    "stl": "Steals",
    "tov": "Turnovers",
    "blk": "Blocks",
    "blka": "BlocksAgainst",
    "fd": "FoulsDrawn",
    "pf": "FoulsCommitted",
    "fg_missed": "FGMissed",
    "ft_missed": "FTMissed",
}

# PIR = (pts + reb + ast + stl + blk + fouls drawn)
#       - (missed FG + missed FT + turnovers + blocks against + fouls committed)
PIR_POSITIVE = ["Points", "TotalRebounds", "Assistances", "Steals", "Blocks", "FoulsDrawn"]
PIR_NEGATIVE = ["FGMissed", "FTMissed", "Turnovers", "BlocksAgainst", "FoulsCommitted"]


def _fantasy_token():
    token = os.environ.get("DUNKEST_API_TOKEN")
    if not token:
        raise RuntimeError(
            "DUNKEST_API_TOKEN is not set. Copy the Bearer token from the EuroLeague "
            "Fantasy site (DevTools -> Network -> any fantaking-api request) into "
            "backend/.env. See backend/.env.example."
        )
    return token


def _competition_id(competition_id=None):
    return str(competition_id or os.environ.get("DUNKEST_COMPETITION_ID", "49"))


def _fetch_fantasy_rows(competition_id, extra_params=None):
    """
    Page through the fantasy stats table and return one dict per player.

    The endpoint returns data.columns (names) plus data.players[].row (positional
    values), so each row is zipped back against the header. The player's stable
    id is carried through as PlayerID, which is what lets stats and CR join
    exactly instead of by name.
    """
    headers = {
        "accept": "*/*",
        "authorization": f"Bearer {_fantasy_token()}",
        "content-type": "application/json",
        # The API rejects requests that do not look like they came from the site.
        "origin": FANTASY_ORIGIN,
        "referer": f"{FANTASY_ORIGIN}/",
    }
    url = f"{FANTASY_API_BASE}/competitions/{competition_id}/stats/players/table"

    rows = []
    page = 1
    while True:
        params = {
            "stats_type": "avg",
            "sort_by": "fpt",
            "sort_order": "desc",
            "active_players": "true",
            "per_page": FANTASY_PAGE_SIZE,
            "page": page,
        }
        params.update(extra_params or {})

        response = requests.get(url, headers=headers, params=params, timeout=20)
        if response.status_code == 401:
            raise RuntimeError(
                "Fantasy API rejected DUNKEST_API_TOKEN (401). The token has expired - "
                "copy a fresh one from the EuroLeague Fantasy site into backend/.env."
            )
        if response.status_code == 403:
            raise RuntimeError(
                f"Fantasy API returned 403 for competition {competition_id}. The token's "
                "account is not enrolled in that competition - check DUNKEST_COMPETITION_ID."
            )
        response.raise_for_status()

        payload = response.json()
        data = payload.get("data") or {}
        columns = data.get("columns") or []
        if not columns:
            break

        for player in data.get("players") or []:
            row = dict(zip(columns, player.get("row", [])))
            row["PlayerID"] = player.get("id")
            rows.append(row)

        meta = payload.get("meta") or {}
        if page >= meta.get("last_page", 1):
            break
        page += 1

    return rows


def fetch_and_save_cr_data(competition_id=None, round_number=None):
    """
    Fetch player pricing (CR) from the EuroLeague Fantasy API and save it to S3.

    Each run writes its own dated object, so the bucket accumulates an append-only
    price history that nothing ever rewrites. utils/cr_history.py stitches those
    snapshots into the per-season series the Price Tracker chart reads.

    round_number is how many rounds had been played when the prices were read, which
    the API does not report - the caller knows it from the round fetch. It is left
    blank when unknown rather than guessed; every snapshot written before this
    existed has it blank too.

    Unlike the other fetchers this raises rather than returning an empty frame:
    CR is load-bearing for every endpoint, and swallowing the failure is what let
    the previous outage go unnoticed for six months.
    """
    competition_id = _competition_id(competition_id)
    rows = _fetch_fantasy_rows(competition_id)
    if not rows:
        raise RuntimeError(
            f"Fantasy API returned no players for competition {competition_id}."
        )

    raw = pd.DataFrame(rows)
    raw = raw[raw["position"].isin(POSITION_MAP)]

    today = datetime.today()
    cr_df = pd.DataFrame({
        "PlayerID": raw["PlayerID"],
        "PlayerName": raw["name"].astype(str).str.strip(),
        "CR": pd.to_numeric(raw["quotation"], errors="coerce"),
        "position": raw["position"].map(POSITION_MAP),
        "Team": raw["team"].astype(str),
        # Appended, never inserted: readers of the older snapshots key off column
        # names, so adding columns at the end keeps every existing file valid.
        "Season": season_for_date(today.date()),
        "Round": round_number,
    })

    filename = f"player_cr_data_{today.strftime('%Y-%m-%d')}.csv"

    save_to_s3(filename, cr_df)
    print(f"Player CR and Position data saved to {filename} ({len(cr_df)} players"
          + (f", round {round_number})" if round_number else ", round unknown)"))
    return cr_df


def _fantasy_round_frame(competition_id, round_number, season_label):
    """
    Fetch one round's totals and shape them like a game log row per player.

    Each team plays once per regular-season round, so a round's totals are that
    player's game. Returns an empty frame when the round has not been played.
    """
    rows = _fetch_fantasy_rows(
        competition_id,
        {"stats_type": "tot", "matchdays": str(round_number)},
    )
    if not rows:
        return pd.DataFrame()

    raw = pd.DataFrame(rows)
    raw = raw[raw["position"].isin(POSITION_MAP)]
    if raw.empty:
        return pd.DataFrame()

    out = pd.DataFrame({
        "Season": season_label,
        # Stored as GameCode so the existing sort, dedupe and GamesPlayed count
        # keep working against the archive schema.
        "GameCode": round_number,
        "Team": raw["team"].astype(str),
        "PlayerID": raw["PlayerID"],
        "PlayerName": raw["name"].astype(str).str.strip(),
        "position": raw["position"].map(POSITION_MAP),
        "CR": pd.to_numeric(raw["quotation"], errors="coerce"),
        "FPT": pd.to_numeric(raw["fpt"], errors="coerce"),
    })

    for source, dest in FANTASY_STAT_COLUMNS.items():
        out[dest] = pd.to_numeric(raw.get(source), errors="coerce").fillna(0)

    out["PIR"] = out[PIR_POSITIVE].sum(axis=1) - out[PIR_NEGATIVE].sum(axis=1)

    if DROP_ALL_ZERO_ROWS:
        activity = (
            out[list(FANTASY_STAT_COLUMNS.values())].abs().sum(axis=1)
            + out["FPT"].fillna(0).abs()
        )
        out = out[activity > 0]

    return out


def latest_round(df):
    """
    Highest round present in a fantasy game log, or None for an empty/absent one.

    The fantasy path stores the round in GameCode (see _fantasy_round_frame), so this
    is "how many rounds have been played" as far as the stored data knows.
    """
    if df is None or df.empty or "GameCode" not in df.columns:
        return None
    rounds = pd.to_numeric(df["GameCode"], errors="coerce").dropna()
    return int(rounds.max()) if not rounds.empty else None


def fetch_and_update_fantasy_stats(data_file, competition_id=None, season_label=None,
                                   max_rounds=45):
    """
    Build a per-round game log from the EuroLeague Fantasy API and update it in S3,
    deduplicating at the player+round level.
    """
    competition_id = _competition_id(competition_id)
    season_label = season_label or f"C{competition_id}"

    df = load_from_s3(data_file)
    if not df.empty:
        print(f"Loaded existing data with {len(df)} rows.")
    else:
        print("No existing data found.")

    # Start from the newest stored round rather than the one after it: a round
    # still in progress keeps changing, and the dedupe below keeps the latest copy.
    last_stored_round = (
        int(df["GameCode"].max()) if not df.empty and "GameCode" in df.columns else 0
    )
    start_round = max(1, last_stored_round)

    collected = []
    consecutive_failures = 0
    max_failures = 5

    for round_number in range(start_round, max_rounds + 1):
        print(f"Fetching round; matchday={round_number}")
        try:
            round_df = _fantasy_round_frame(competition_id, round_number, season_label)
        except RuntimeError:
            # Auth/config problems are not "no data yet" - fail loudly.
            raise
        except Exception as e:
            print(f"Error for round={round_number}: {e}")
            consecutive_failures += 1
            round_df = pd.DataFrame()

        if round_df.empty:
            print(f"No player data for round={round_number}.")
            consecutive_failures += 1
        else:
            consecutive_failures = 0
            collected.append(round_df)

        if consecutive_failures >= max_failures:
            print(f"Reached {max_failures} consecutive empty rounds. Stopping fetch.")
            break

    if not collected:
        print("No new round data fetched.")
        return df

    new_df = pd.concat(collected, ignore_index=True)
    combined_df = pd.concat([df, new_df], ignore_index=True) if not df.empty else new_df
    deduplicated_df = combined_df.drop_duplicates(subset=["GameCode", "PlayerID"], keep="last")

    save_to_s3(data_file, deduplicated_df)
    print(f"Updated fantasy stats file saved with {len(deduplicated_df)} unique rows.")
    return deduplicated_df

# Every stat the Euroleague boxscore exposes, kept verbatim under its own name so
# this file is the canonical schema. The fetcher previously kept only 6 of these and
# discarded the rest, which is why minutes and shooting splits were unavailable.
BOXSCORE_FIELDS = [
    "IsStarter", "IsPlaying", "Minutes", "Points",
    "FieldGoalsMade2", "FieldGoalsAttempted2", "FieldGoalsMade3", "FieldGoalsAttempted3",
    "FreeThrowsMade", "FreeThrowsAttempted",
    "OffensiveRebounds", "DefensiveRebounds", "TotalRebounds",
    "Assistances", "Steals", "Turnovers",
    "BlocksFavour", "BlocksAgainst",
    "FoulsCommited", "FoulsReceived",  # "Commited" is the API's own spelling
    "Plusminus",
]

EUROLEAGUE_BOXSCORE_URL = "https://live.euroleague.net/api/Boxscore"

# The API allows roughly 60-75 requests before it starts returning 429, and the
# cooldown that follows costs far more time than pacing would have. Rather than
# guess a fixed safe rate, the backfill adapts: it starts gently, eases off after a
# throttle, and creeps faster again while requests keep succeeding.
BOXSCORE_REQUEST_DELAY = 2.0
BOXSCORE_MIN_DELAY = 1.0
BOXSCORE_MAX_DELAY = 5.0


class _AdaptivePace:
    """Self-tuning delay between boxscore requests."""

    def __init__(self, delay=BOXSCORE_REQUEST_DELAY):
        self.delay = delay
        self._streak = 0

    def ok(self):
        # Speed up slowly, and only after a sustained run of clean requests.
        self._streak += 1
        if self._streak >= 10:
            self._streak = 0
            self.delay = max(BOXSCORE_MIN_DELAY, self.delay * 0.8)

    def throttled(self):
        self._streak = 0
        self.delay = min(BOXSCORE_MAX_DELAY, self.delay * 1.5)
        print(f"  easing off: {self.delay:.1f}s between requests")

    def wait(self):
        time.sleep(self.delay)


def _boxscore_row(player, team_stat, game_code, season_code):
    """Flatten one player's boxscore line, keeping every field the API returns."""
    row = {
        'Season': season_code,
        'GameCode': game_code,
        'Team': team_stat['Team'],
        'PlayerID': str(player.get('Player_ID', '')).strip(),
        'PlayerName': str(player.get('Player', '')).strip(),
        'PIR': player.get('Valuation', None),
    }
    for field in BOXSCORE_FIELDS:
        row[field] = player.get(field, None)
    return row


def _get_boxscore_with_backoff(game_code, season_code, max_attempts=8, pace=None):
    """
    Fetch one boxscore, backing off on rate limits.

    The API serves a steady trickle happily but starts returning 429 after roughly
    75 consecutive requests, and a 429 says "slow down", not "this game does not
    exist". Conflating the two is what previously truncated a season at game 78.
    Returns the parsed body, or None if it could not be retrieved at all.
    """
    url = f"{EUROLEAGUE_BOXSCORE_URL}?gamecode={game_code}&seasoncode={season_code}"
    # Deliberately short and capped. The caller's pacer already slows the sustained
    # request rate, so this only needs to re-probe often enough to notice the moment
    # the limit lifts. An earlier version escalated to 180s per attempt and spent
    # 15 minutes asleep on a single game while the API was answering 200s again.
    delay = 5
    max_delay = 30

    for attempt in range(max_attempts):
        try:
            response = requests.get(url, timeout=20)
            if response.status_code == 429:
                if pace:
                    pace.throttled()
                time.sleep(delay)
                delay = min(delay * 2, max_delay)
                continue
            response.raise_for_status()
            if pace:
                pace.ok()
            # Some game codes answer 200 with a completely empty body - game 396 of
            # E2025 does, permanently, while 395 and 397 are fine. That is a hole in
            # their data, not a transport problem, so report it as "no game here"
            # rather than retrying it eight times and stalling the backfill.
            if not response.text.strip():
                return {}
            return response.json()
        except (ValueError, requests.exceptions.RequestException) as e:
            print(f"  gameCode={game_code} attempt {attempt + 1} failed: {e}")
            time.sleep(delay)
            delay = min(delay * 2, max_delay)

    return None


def backfill_player_stats(data_file, season_code, max_games=450, budget=None):
    """
    Fill in the full boxscore for games that are missing it, and merge the result in.

    Resumable on purpose. The Euroleague API throttles hard after roughly 75
    consecutive requests and can stay throttled for a long time, so a season cannot
    reliably be rebuilt in one pass. Each run fetches whatever it can, merges it into
    what is already stored and saves; running it repeatedly converges on a complete
    season. `budget` caps how many games one run will fetch.

    A game counts as needing work if it has no rows yet, or if its rows predate the
    widened schema (no Minutes), which is how the 6-column 2025 file gets upgraded
    game by game rather than all at once.
    """
    existing = load_from_s3(data_file)
    have_full = set()
    if not existing.empty and 'GameCode' in existing.columns:
        if 'Minutes' in existing.columns:
            complete = existing[existing['Minutes'].notna()]
            have_full = set(pd.to_numeric(complete['GameCode'], errors='coerce').dropna().astype(int))
        print(f"{data_file}: {existing['GameCode'].nunique()} games stored, "
              f"{len(have_full)} already have the full boxscore.")

    new_rows = []
    empty_games = 0
    max_empty = 5
    fetched = 0
    unfetchable = 0
    max_unfetchable = 5
    pace = _AdaptivePace()

    for game_code in range(1, max_games + 1):
        if game_code in have_full:
            empty_games = 0  # a stored game proves the season reaches at least here
            continue
        if budget is not None and fetched >= budget:
            print(f"Reached this run's budget of {budget} games; stopping early.")
            break

        data = _get_boxscore_with_backoff(game_code, season_code, pace=pace)
        if data is None:
            # One stubborn game should not block the rest of the season. Only give up
            # when several in a row fail, which means a real outage rather than a
            # single bad record.
            unfetchable += 1
            print(f"Could not fetch game {game_code}; skipping it.")
            if unfetchable >= max_unfetchable:
                print(f"{max_unfetchable} games in a row could not be fetched - "
                      f"stopping this run and keeping what we have. Re-run to continue.")
                break
            pace.wait()
            continue
        unfetchable = 0

        if not data.get('Stats'):
            empty_games += 1
            if empty_games >= max_empty:
                print(f"{max_empty} consecutive unplayed games at {game_code}; "
                      f"treating that as the end of the season.")
                break
        else:
            empty_games = 0
            fetched += 1
            for team_stat in data['Stats']:
                for player in team_stat['PlayersStats']:
                    new_rows.append(_boxscore_row(player, team_stat, game_code, season_code))
            if fetched % 10 == 0:
                print(f"  ...{fetched} games fetched this run, now at game {game_code} "
                      f"({pace.delay:.1f}s pace)")

        pace.wait()

    if not new_rows:
        print(f"Nothing new fetched for {season_code}; {data_file} unchanged.")
        return existing

    new_df = pd.DataFrame(new_rows)
    combined = pd.concat([existing, new_df], ignore_index=True) if not existing.empty else new_df
    # keep='last' means a freshly fetched wide row supersedes the old narrow one.
    combined = combined.drop_duplicates(subset=['GameCode', 'PlayerID'], keep='last')

    save_to_s3(data_file, combined)
    upgraded = combined['Minutes'].notna().sum() if 'Minutes' in combined.columns else 0
    print(f"{data_file}: {len(combined)} rows over {combined['GameCode'].nunique()} games; "
          f"{upgraded} rows now carry the full boxscore (+{len(new_df)} this run).")
    return combined


def fetch_and_update_player_stats(data_file, season_code):
    """
    Fetch new game data from the Euroleague API and update the player stats file in S3
    with deduplication at the player+game level.
    """
    # Load existing data from S3
    df = load_from_s3(data_file)
    if not df.empty:
        print(f"Loaded existing data with {len(df)} rows.")
    else:
        print("No existing data found.")

    last_stored_game_code = df['GameCode'].max() if not df.empty else 0

    # Define game codes to fetch, starting from the last stored one
    new_game_codes = range(last_stored_game_code + 1, last_stored_game_code + 1000)
    all_player_data = []
    consecutive_failures = 0  # Counter for consecutive failures
    max_failures = 5          # Stop fetching after 5 consecutive failures

    for game_code in new_game_codes:
        print(f"Fetching game; gameCode={game_code}")
        api_endpoint = f"https://live.euroleague.net/api/Boxscore?gamecode={game_code}&seasoncode={season_code}"

        try:
            response = requests.get(api_endpoint, timeout=10)
            response.raise_for_status()  # Raises error if status code is not 200

            data = response.json()

            if 'Stats' not in data:
                # If 'Stats' is missing, treat it as a failure
                print(f"No stats found for gameCode={game_code}.")
                consecutive_failures += 1
            else:
                # Reset failure counter on success
                consecutive_failures = 0  

                # Process data into a flat structure
                for team_stat in data['Stats']:
                    for player in team_stat['PlayersStats']:
                        all_player_data.append(_boxscore_row(player, team_stat, game_code, season_code))

        except requests.exceptions.ReadTimeout:
            print(f"Timeout for gameCode={game_code}.")
            consecutive_failures += 1
        except (ValueError, requests.exceptions.RequestException) as e:
            print(f"Error for gameCode={game_code}: {e}")
            consecutive_failures += 1
        except Exception as e:
            print(f"Unexpected error for gameCode={game_code}: {e}")
            consecutive_failures += 1

        # Stop fetching if consecutive failures reach the limit
        if consecutive_failures >= max_failures:
            print(f"Reached {max_failures} consecutive failures. Stopping fetch.")
            break

    # Create a new DataFrame for fetched data
    if all_player_data:
        new_df = pd.DataFrame(all_player_data)

        # Combine existing data with new data
        if not df.empty:
            combined_df = pd.concat([df, new_df], ignore_index=True)
        else:
            combined_df = new_df

        # Deduplicate by GameCode + PlayerID
        deduplicated_df = combined_df.drop_duplicates(subset=['GameCode', 'PlayerID'], keep='last')

        # Save deduplicated data back to S3
        save_to_s3(data_file, deduplicated_df)
        print(f"Updated stats file saved with {len(deduplicated_df)} unique rows.")
        return deduplicated_df

    # If no new data was fetched, return the existing df
    return df

SCHEDULE_URL = "https://api-live.euroleague.net/v1/schedules"


def _schedule_date(text):
    """'Apr 10, 2026' -> '2026-04-10'. Returns None for a fixture with no date yet."""
    if not text:
        return None
    try:
        return datetime.strptime(text.strip(), "%b %d, %Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def fetch_and_save_schedule(season):
    """
    Fetch a season's fixture list from Euroleague and save it to S3.

    This is the only source in the app that knows which two teams met, which of them was
    at home, what date they played and which round it was - none of that exists in the
    boxscore or fantasy feeds. The app reads the saved file; nothing on a request path
    ever calls this endpoint.

    /v1/schedules rather than /v1/results: results only lists games already played and
    returns nothing for a season that has not started, while schedules carries published
    fixtures either way. `game` is the same identifier the boxscore calls `gamecode`,
    which is what lets this join to the stored player stats.

    Raises rather than writing an empty file - a blank schedule would quietly blank the
    opponent everywhere, which is the failure mode the CR fetcher was hardened against.
    """
    season_code = f"E{season}"
    response = requests.get(SCHEDULE_URL, params={"seasonCode": season_code}, timeout=20)
    response.raise_for_status()

    items = ET.fromstring(response.content).findall("item")
    if not items:
        raise RuntimeError(
            f"Euroleague schedule returned no fixtures for {season_code}. The season may "
            "not be published yet."
        )

    rows = []
    for item in items:
        game = pd.to_numeric(item.findtext("game"), errors="coerce")
        if pd.isna(game):
            continue
        rows.append({
            "Season": str(season),
            # Named GameCode because that is what the stored player stats call it.
            "GameCode": int(game),
            "Round": pd.to_numeric(item.findtext("gameday"), errors="coerce"),
            "Date": _schedule_date(item.findtext("date")),
            "HomeTeam": (item.findtext("hometeam") or "").strip(),
            "HomeCode": (item.findtext("homecode") or "").strip(),
            "AwayTeam": (item.findtext("awayteam") or "").strip(),
            "AwayCode": (item.findtext("awaycode") or "").strip(),
            "Played": (item.findtext("played") or "").strip().lower() == "true",
        })

    schedule_df = pd.DataFrame(rows).sort_values("GameCode", ignore_index=True)
    filename = f"schedule_{season}.csv"
    save_to_s3(filename, schedule_df)
    print(f"Schedule saved to {filename} ({len(schedule_df)} fixtures, "
          f"{int(schedule_df['Played'].sum())} played)")
    return schedule_df


def fetch_and_save_injury_report():
    """
    Fetch EuroLeague injury report from Rotowire and save it to S3 as injury_report_YYYY-MM-DD.csv.
    Returns the cleaned DataFrame.
    """
    api_url = "https://www.rotowire.com/euro/tables/injury-report.php?team=ALL&pos=ALL"

    try:
        response = requests.get(api_url, timeout=10)
        response.raise_for_status()
        injuries = response.json()
    except Exception as e:
        print(f"[injury] fetch error: {e}")
        return pd.DataFrame()

    injuries_df = pd.DataFrame(injuries)

    # Drop columns if they exist (keeps it robust to schema changes)
    for col in ["ID", "playerURL", "rDate"]:
        if col in injuries_df.columns:
            injuries_df = injuries_df.drop(columns=col)

    # Light cleanup
    if "Player" in injuries_df.columns:
        injuries_df["Player"] = injuries_df["Player"].astype(str).str.strip()

    filename = f"injury_report.csv"

    save_to_s3(filename, injuries_df)
    print(f"Injury report saved to {filename}")
    return injuries_df

def fetch_and_save_defense_vs_position_data():
    """
    Fetch 'defense vs position' data from Dunkest API for Guards, Forwards, and Centers,
    combine them, and save to S3.
    """
    positions = {
        1: 'Guard',
        2: 'Forward',
        3: 'Center'
    }
    
    all_data = []

    for pos_id, pos_name in positions.items():
        # URL provided by user
        url = f"https://www.dunkest.com/api/stats/defense-vs-position?season_id=23&stats_id=25&position_id={pos_id}"
        print(f"Fetching defense data for {pos_name} (ID: {pos_id})...")
        
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # The API returns a list of objects. We add them to our master list.
            # We'll attach the position name/id to each row if it's not already there clearly.
            # However, looking at standard API responses, it's safer to add it explicitly.
            for row in data:
                row['Position'] = pos_name
                row['PositionID'] = pos_id
                all_data.append(row)
                
        except Exception as e:
            print(f"Error fetching data for {pos_name}: {e}")

    if not all_data:
        print("No defense vs position data fetched.")
        return pd.DataFrame()

    df = pd.DataFrame(all_data)
    
    # Generate filename with today's date
    today = datetime.today().strftime("%Y-%m-%d")
    filename = f"defense_vs_position_{today}.csv"

    save_to_s3(filename, df)
    print(f"Defense vs Position data saved to {filename} with {len(df)} rows.")
    return df

