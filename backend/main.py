from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import pandas as pd
import os
from pydantic import BaseModel

# Import utils (ensure these are refactored to remove streamlit dependency)
from utils.data_processing import load_and_merge_data, filter_by_cr_and_position, score_metric
from utils.recommendations import recommend_players_v2
from utils.cr_history import cr_history_payload
from utils.auth import optional_user

app = FastAPI(title="EuroGuru API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this every JSON POST pays a preflight round trip before the real
    # request. The dev server proxies /api to make requests same-origin, but a
    # cross-origin deployment still benefits.
    max_age=3600,
)

# How long the CDN may serve a cached API response, and how long it may keep serving
# a stale one while it refreshes in the background.
EDGE_TTL_SECONDS = int(os.environ.get("EDGE_TTL_SECONDS", 300))
EDGE_STALE_SECONDS = int(os.environ.get("EDGE_STALE_SECONDS", 86_400))

# Routes that answer "who is asking", rather than answering from the data files. These
# are never storable, with or without a token. Add a route here the moment its body
# starts depending on the caller - a paid-tier response, say.
PRIVATE_PATHS = {"/api/me"}


@app.middleware("http")
async def edge_cache(request, call_next):
    """
    Let the CDN answer most requests so a cold container is rarely on the hot path.

    This app's own cache is LastModified-validated rather than timed, deliberately -
    a fetch-script upload is visible on the very next request. That guarantee holds
    for the process, but on serverless the process is usually *new*: ~0.6s to import
    pandas and ~2.5s to rebuild the merged frame, paid by whoever arrives first after
    an idle period.

    s-maxage applies to the shared CDN cache only, never the browser, so a hard
    refresh still reaches the origin. stale-while-revalidate is what actually removes
    the cold start from the user's path: past the TTL the edge serves the old answer
    immediately and refreshes behind it, so nobody waits on a container boot.

    The data changes at most once a day, and only when the fetch script is run by
    hand, so a few minutes of staleness costs nothing. Set EDGE_TTL_SECONDS=0 to turn
    this off and go straight to the origin every time.
    """
    response = await call_next(request)

    # Anything whose answer depends on the caller rather than on the URL. Storing one
    # of these anywhere is a bug in both directions: a signed-in answer handed to a
    # stranger, or - the one that actually bit - an anonymous answer replayed to
    # someone who has since signed in, for the full stale-while-revalidate window.
    if request.url.path in PRIVATE_PATHS or "authorization" in request.headers:
        response.headers["Cache-Control"] = "private, no-store"
        return response

    cacheable = (
        request.method == "GET"
        and response.status_code == 200
        and request.url.path.startswith("/api/")
        and EDGE_TTL_SECONDS > 0
    )
    if cacheable:
        response.headers["Cache-Control"] = (
            f"public, max-age=0, s-maxage={EDGE_TTL_SECONDS}, "
            f"stale-while-revalidate={EDGE_STALE_SECONDS}"
        )
        # The header above is only half of it. A cache keys on the URL, so without
        # Vary the anonymous copy of /api/anything is a perfectly valid hit for a
        # request that arrives carrying a token - which is exactly how a signed-in
        # user gets told they are signed out. Vary makes the presence of the header
        # part of the key, so the two never collide.
        response.headers["Vary"] = "Authorization"
    return response

# --- Global Data Loader ---
# In a real app, you might want to load this on startup or cache it properly.
# Each season lists its stats sources in priority order. 2026 prefers the fantasy
# API's per-round log and falls back to the Euroleague boxscore file until the
# per-round ingest has been validated against real games. 2023-2025 are frozen
# archives - the fantasy API only serves competitions the account is enrolled in.
DATA_FILES = {
    '2026': ['player_stats_fantasy_2026.csv', 'player_stats_2026.csv'],
    '2025': ['player_stats_2025.csv'],
    '2024': ['player_stats_2024.csv'],
    '2023': ['player_stats_2023.csv']
}

# Dashboard "Consistent Elite" cut-off. Calibrated for PIR; re-tune once there is
# real fantasy-points data to look at.
ELITE_SCORE_THRESHOLD = 15


def get_data(season='2025'):
    candidates = DATA_FILES.get(season)
    if not candidates:
        raise HTTPException(status_code=404, detail="Season not found")

    # Passing the season prices an archive from its own final snapshot instead of from
    # today's, so the CR shown matches the end of that season's price history.
    return load_and_merge_data(candidates, include_injuries=True, season=season)


def _json_safe(df):
    """Records with NaN turned into null, which json.dumps can actually encode."""
    return df.astype(object).where(pd.notna(df), None).to_dict(orient="records")

@app.get("/")
def read_root():
    return {"message": "Welcome to EuroGuru API"}


@app.get("/api/me")
async def get_me(user=Depends(optional_user)):
    """
    Who the caller is, as far as this API can tell.

    The only route that exercises the whole verification chain end to end - browser
    session, Bearer header, Vercel rewrite, JWKS lookup, signature check - so it is
    worth keeping around past the first verification as the place to look when sign-in
    "works" in the UI but the API disagrees.

    Answers 200 either way. Anonymous is a valid answer here, not an error.
    """
    if user is None:
        return {"authenticated": False}

    return {
        "authenticated": True,
        "id": user.get("sub"),
        "email": user.get("email"),
        # 'google', 'email', and so on - handy for telling the two sign-in paths apart.
        "provider": (user.get("app_metadata") or {}).get("provider"),
    }

@app.get("/api/filters")
def get_filters(season: str = '2025'):
    df = get_data(season)
    if df.empty:
        return {"positions": [], "min_cr": 0, "max_cr": 0, "score_metric": "PIR"}

    # Players with no CR row have no position; drop the blanks rather than offering
    # them as a filter option.
    positions = sorted(p for p in df['position'].dropna().unique().tolist() if p)
    return {
        "positions": ["All"] + positions,
        "min_cr": float(df['CR'].min()),
        "max_cr": float(df['CR'].max()),
        # Tells the UI whether Score holds fantasy points or PIR for this season.
        "score_metric": score_metric(df)
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
        if "Average_Score" in aggregated.columns:
            aggregated = aggregated.sort_values("Average_Score", ascending=False, na_position="last")
        # Priced players with no games yet keep a null average rather than a 0, which
        # would read as "averaged zero" instead of "hasn't played".
        return _json_safe(aggregated)

    # Default: Raw records. Sorting happens client-side, so a low cap here would
    # mean "top by usage" only ever sorted an arbitrary first slice.
    return _json_safe(filtered.head(2000))

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
    
    # Nulls, not zeros: filling zeros would report a player who never took a shot as
    # 0% true shooting and 0 minutes, which is a different claim entirely.
    return _json_safe(stats_df)


@app.get("/api/player")
def get_player_detail(name: str, season: str = '2025'):
    """
    One player's full profile: every game they played plus their season aggregates.

    Backs the detail view, where the point is depth for a single player rather than
    breadth across the table.
    """
    from utils.data_processing import calculate_player_averages

    df = get_data(season)
    if df.empty:
        raise HTTPException(status_code=404, detail="Season has no data")

    player_rows = df[df["PlayerName"] == name]
    if player_rows.empty:
        raise HTTPException(status_code=404, detail=f"No player named {name} in {season}")

    game_log = player_rows[player_rows["GameCode"].notna()].sort_values(
        "GameCode", ascending=False
    )
    season_totals = calculate_player_averages(player_rows, 100)

    return {
        "player": name,
        "season": season,
        "score_metric": score_metric(df),
        "summary": _json_safe(season_totals)[0] if not season_totals.empty else {},
        "games": _json_safe(game_log),
    }


@app.get("/api/cr-history")
def get_cr_history(season: str = '2025'):
    """
    How every player's price moved through a season.

    Built from the dated player_cr_data_*.csv snapshots the fetcher has been writing
    all along - see utils/cr_history.py. Unlike the other endpoints this does not go
    through get_data(): prices are their own time series, independent of whether the
    season has a stats file at all.

    The whole season ships in one response (~330 players x ~17 points) because the
    client decides which players to draw, and re-fetching per selection would be far
    more traffic than sending it once.
    """
    if season not in DATA_FILES:
        raise HTTPException(status_code=404, detail="Season not found")

    return cr_history_payload(season)


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

    recs = recs.head(20)

    # Attach the same per-player aggregates the stats table shows, so the column
    # picker on this tab can offer minutes, TS%, usage and the rest instead of only
    # the four ranking figures recommend_players_v2 computes. Averaged over the same
    # games window the ranking used, so a row's stats and its score describe one
    # stretch of basketball rather than two.
    from utils.data_processing import calculate_player_averages

    averages = calculate_player_averages(filtered_df, params.last_x_games)
    if not averages.empty:
        # Both frames carry CR and position; keep one copy rather than let the merge
        # produce _x/_y pairs the client would have to know about.
        overlap = [c for c in recs.columns if c in averages.columns and c != "PlayerName"]
        recs = recs.drop(columns=overlap).merge(averages, on="PlayerName", how="left")

    return recs.fillna("").to_dict(orient="records")

@app.get("/api/dashboard")
def get_dashboard_data(season: str = '2025'):
    from utils.data_processing import load_injuries_df, calculate_pir_stats
    
    # 1. Load Data
    df = get_data(season)
    if df.empty:
        return {"widgets": {}, "injuries": []}

    # Every widget is a buy recommendation, so restrict to players who are actually
    # priced this season. Archive seasons are full of players no longer in the league,
    # and without this they top the leaderboards with a blank position and no cost.
    df = df[df["CR"].notna()]
    if df.empty:
        return {"widgets": {}, "injuries": []}

    # --- Widget 1: "Who's Hot 🔥" (Last 3 Games) ---
    stats_hot = calculate_pir_stats(df, last_x_games=3)
    if stats_hot.empty:
        return {"widgets": {}, "injuries": []}
    hot_players = stats_hot.sort_values('Average_Score', ascending=False).head(5)

    # --- Widget 2: "Consistent Elite 🎯" (Last 5 Games, high scorers, Lowest StdDev) ---
    stats_cons = calculate_pir_stats(df, last_x_games=5)
    # Filter for elite scorers first. The threshold is calibrated for PIR; on the
    # fantasy-points scale it means something different, so the fallback below is
    # what actually populates the widget until it is re-tuned on real round data.
    elite = stats_cons[stats_cons['Average_Score'] > ELITE_SCORE_THRESHOLD]
    if elite.empty:
        # Fallback if no one clears the bar (early season?) -> take top 20 scorers
        elite = stats_cons.sort_values('Average_Score', ascending=False).head(20)

    # Sort by Consistency (Lowest StdDev)
    consistent_players = elite.sort_values('StdDev_Score', ascending=True).head(5)

    # --- Widget 3: "Budget Picks 💰" (Last 5 Games, CR < 10, Highest Avg Score) ---
    # Re-use stats_cons (Last 5 games is good baseline)
    budget = stats_cons[stats_cons['CR'] <= 10]
    budget_players = budget.sort_values('Average_Score', ascending=False).head(5)

    widgets = {
        "hot": hot_players.fillna(0).to_dict(orient="records"),
        "consistent": consistent_players.fillna(0).to_dict(orient="records"),
        "budget": budget_players.fillna(0).to_dict(orient="records")
    }

    # 4. Injuries (if available)
    # The whole report, not a slice. This used to be head(10), which hid 19 of 29
    # players with nothing in the UI saying so - the client decides what to show and
    # how much to collapse. Around 6KB, on an endpoint that is already edge-cached.
    injuries = []
    try:
        inj_df = load_injuries_df()
        if not inj_df.empty:
            injuries = inj_df.fillna("").to_dict(orient="records")
    except Exception as e:
        # Injuries are decoration on this endpoint; the widgets are the point. Say so
        # rather than swallowing it silently, which is what a bare except did before.
        print(f"[dashboard] injuries unavailable: {e}")

    return {
        "widgets": widgets,
        "injuries": injuries,
        # Lets the widgets label their numbers correctly instead of always saying PIR.
        "score_metric": score_metric(df)
    }

