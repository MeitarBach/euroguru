from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import pandas as pd
import os
from pydantic import BaseModel

# Import utils (ensure these are refactored to remove streamlit dependency)
from utils.data_processing import load_and_merge_data, filter_by_cr_and_position
from utils.recommendations import recommend_players_v2

app = FastAPI(title="EuroGuru API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Data Loader ---
# In a real app, you might want to load this on startup or cache it properly.
DATA_FILES = {
    '2025': 'player_stats_2025.csv',
    '2024': 'player_stats_2024.csv',
    '2023': 'player_stats_2023.csv'
}

def get_data(season='2025'):
    filename = DATA_FILES.get(season)
    if not filename:
        raise HTTPException(status_code=404, detail="Season not found")
    
    # Check if file exists in current directory (backend root)
    if not os.path.exists(filename):
         # If not found locally, rely on S3 loader in logic, but passing local filename
         pass
         
    # Data processing logic expects file path or S3 key.
    # Assuming the copied logic works with S3, we use the key.
    # If using local mock, we might need to adjust logic.
    # For now, we assume the S3 bucket is accessible as it was in the original project.
    
    df = load_and_merge_data(filename, include_injuries=True)
    return df

@app.get("/")
def read_root():
    return {"message": "Welcome to EuroGuru API"}

@app.get("/api/filters")
def get_filters(season: str = '2025'):
    df = get_data(season)
    if df.empty:
        return {"positions": [], "min_cr": 0, "max_cr": 0}
        
    positions = sorted(df['position'].dropna().unique().tolist())
    return {
        "positions": ["All"] + positions,
        "min_cr": float(df['CR'].min()),
        "max_cr": float(df['CR'].max())
    }

class FilterParams(BaseModel):
    season: str = '2025'
    min_cr: float
    max_cr: float
    position: str
    last_x_games: Optional[int] = 0 # 0 means "All/Raw" mode? Or actually "Raw". Let's say 0 = Raw.

@app.post("/api/stats")
def get_stats(params: FilterParams):
    from utils.data_processing import calculate_player_averages

    df = get_data(params.season)
    if df.empty:
        return []
        
    filtered = filter_by_cr_and_position(df, params.min_cr, params.max_cr, params.position)
    
    # If user requests aggregation (e.g. Last 5 Games)
    if params.last_x_games and params.last_x_games > 0:
        # Calculate averages
        aggregated = calculate_player_averages(filtered, params.last_x_games)
        return aggregated.fillna(0).to_dict(orient="records")

    # Default: Raw records
    return filtered.head(200).fillna("").to_dict(orient="records")

@app.post("/api/stats/aggregated")
def get_aggregated_stats(params: FilterParams):
    from utils.data_processing import calculate_pir_stats
    
    df = get_data(params.season)
    if df.empty:
        return []
    
    # 1. First calculate stats on the WHOLE dataset (or filtered by position? usually filtered)
    filtered = filter_by_cr_and_position(df, params.min_cr, params.max_cr, params.position)
    
    if filtered.empty:
        return []

    # 2. Calculate aggregations (Avg PIR, StdDev)
    # Default to last 5 games if not specified, or use all if user says so (logic in util?)
    last_x = params.last_x_games if params.last_x_games else 100
    
    stats_df = calculate_pir_stats(filtered, last_x)
    
    # Return as records
    return stats_df.fillna(0).to_dict(orient="records")


class RecommendationParams(BaseModel):
    season: str = '2025'
    min_cr: float
    max_cr: float
    last_x_games: int = 5
    alpha: float = 0.85
    weight_efficiency: float = 2.0
    weight_mean_pir: float = 1.0
    weight_consistency: float = 1.0

@app.post("/api/recommend")
def get_recommendations(params: RecommendationParams):
    df = get_data(params.season)
    if df.empty:
        return []

    # 1. Filter by CR first (optimization)
    filtered_df = df[(df['CR'] >= params.min_cr) & (df['CR'] <= params.max_cr)].copy()

    recs = recommend_players_v2(
        filtered_df,
        last_x_games=params.last_x_games,
        alpha=params.alpha,
        weight_efficiency=params.weight_efficiency,
        weight_mean_pir=params.weight_mean_pir,
        weight_consistency=params.weight_consistency
    )
    
    if recs is None or recs.empty:
        return []
        
    return recs.head(20).fillna("").to_dict(orient="records")

@app.get("/api/dashboard")
def get_dashboard_data(season: str = '2025'):
    from utils.data_processing import load_injuries_df, calculate_pir_stats
    
    # 1. Load Data
    df = get_data(season)
    if df.empty:
        return {"widgets": {}, "injuries": []}

    # --- Widget 1: "Who's Hot 🔥" (Last 3 Games) ---
    stats_hot = calculate_pir_stats(df, last_x_games=3)
    hot_players = stats_hot.sort_values('Average_PIR', ascending=False).head(5)
    
    # --- Widget 2: "Consistent Elite 🎯" (Last 5 Games, Avg PIR > 15, Lowest StdDev) ---
    stats_cons = calculate_pir_stats(df, last_x_games=5)
    # Filter for elite scorers first
    elite = stats_cons[stats_cons['Average_PIR'] > 15]
    if elite.empty:
        # Fallback if no one is averaging > 15 (early season?) -> take top 20 scorers
        elite = stats_cons.sort_values('Average_PIR', ascending=False).head(20)
    
    # Sort by Consistency (Lowest StdDev)
    consistent_players = elite.sort_values('StdDev_PIR', ascending=True).head(5)

    # --- Widget 3: "Budget Picks 💰" (Last 5 Games, CR < 10, Highest Avg PIR) ---
    # Re-use stats_cons (Last 5 games is good baseline)
    budget = stats_cons[stats_cons['CR'] <= 10]
    budget_players = budget.sort_values('Average_PIR', ascending=False).head(5)

    widgets = {
        "hot": hot_players.fillna(0).to_dict(orient="records"),
        "consistent": consistent_players.fillna(0).to_dict(orient="records"),
        "budget": budget_players.fillna(0).to_dict(orient="records")
    }

    # 4. Injuries (if available)
    injuries = []
    try:
        inj_df = load_injuries_df()
        if not inj_df.empty:
             injuries = inj_df.head(10).fillna("").to_dict(orient="records")
    except:
        pass

    return {
        "widgets": widgets,
        "injuries": injuries
    }

