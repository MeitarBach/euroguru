from utils.data_fetchers import fetch_and_save_cr_data, fetch_and_update_player_stats, fetch_and_save_injury_report, fetch_and_save_defense_vs_position_data

def run_fetch():
    print("Starting manual fetch for DEV bucket...")

    print("\n--- Fetching CR Data ---")
    try:
        fetch_and_save_cr_data()
        print("CR Data fetched successfully.")
    except Exception as e:
        print(f"Error fetching CR Data: {e}")

    print("\n--- Fetching/Updating Player Stats (2025) ---")
    try:
        fetch_and_update_player_stats("player_stats_2025.csv", "E2025")
        print("Player Stats updated successfully.")
    except Exception as e:
        print(f"Error updating Player Stats: {e}")

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

if __name__ == "__main__":
    run_fetch()
