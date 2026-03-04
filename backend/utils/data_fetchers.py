# utils/data_fetchers.py

import requests
import pandas as pd
from datetime import datetime
from .s3_utils import load_from_s3, save_to_s3

def fetch_and_save_cr_data():
    """
    Fetch CR data from the dunkest API and save it to S3.
    """
    # Construct URL parameters dynamically
    base_url = "https://www.dunkest.com/api/stats/table"
    params = [
        "season_id=23",
        "mode=dunkest",
        "stats_type=tot",
        "player_search=",
        "min_cr=4",
        "max_cr=35",
        "sort_by=pdk",
        "sort_order=desc",
        "iframe=yes"
    ]

    # Add weeks 1-40
    for w in range(1, 41):
        params.append(f"weeks%5B%5D={w}")
    
    # Add rounds 1-80
    for r in range(1, 81):
        params.append(f"rounds%5B%5D={r}")

    api_url = f"{base_url}?{'&'.join(params)}"

    response = requests.get(api_url)
    cr_data = response.json()

    cr_df = pd.DataFrame(cr_data)
    cr_df['PlayerName'] = cr_df['first_name'] + ' ' + cr_df['last_name']
    cr_df = cr_df[['PlayerName', 'cr', 'position']].rename(columns={'cr': 'CR'})
    cr_df['CR'] = pd.to_numeric(cr_df['CR'], errors='coerce')
    cr_df['position'] = cr_df['position'].astype(str)

    today = datetime.today().strftime("%Y-%m-%d")
    filename = f"player_cr_data_{today}.csv"

    save_to_s3(filename, cr_df)
    print(f"Player CR and Position data saved to {filename}")
    return cr_df

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
                        player_info = {
                            'Season': season_code,
                            'GameCode': game_code,
                            'Team': team_stat['Team'],
                            'PlayerID': player.get('Player_ID', '').strip(),
                            'PlayerName': player.get('Player', '').strip(),
                            'PIR': player.get('Valuation', None)
                        }
                        all_player_data.append(player_info)

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

