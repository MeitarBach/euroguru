"""Dump every season's merged game rows, schedule and price history from the bucket to
data/ (read-only on the bucket). Run with the backend venv from backend/."""
import json, sys
from pathlib import Path
sys.path.insert(0, ".")
import main
from utils.cr_history import cr_history_payload

out = Path(sys.argv[1])
for season in ["2023", "2024", "2025", "2026"]:
    df = main.get_data(season)
    df.to_csv(out / f"games_{season}.csv", index=False)
    print(season, df.shape, sorted(df["Round"].dropna().unique())[-3:] if "Round" in df else "no Round")
    try:
        (out / f"cr_{season}.json").write_text(json.dumps(cr_history_payload(season)))
    except Exception as e:
        print("cr", season, e)
