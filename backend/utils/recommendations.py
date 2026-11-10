# utils/recommendations.py

import pandas as pd
import numpy as np

def recommend_players(df, last_x_games=10, lambda_decay=0.1, w1=1, w2=1, w3=1):
    """
    Recommend top 10 players using a scoring function that takes into account
    average PIR, CR, and standard error of PIR.
    """
    if last_x_games is None or last_x_games <= 0:
        last_x_games = 10

    recommendations = []
    grouped = df.groupby('PlayerName')
    
    for name, group in grouped:
        recent_games = group.tail(last_x_games)
        
        if recent_games.empty:
            continue
        
        pir_avg = recent_games['PIR'].mean() if len(recent_games) > 0 else 0
        pir_std = recent_games['PIR'].std(ddof=1) if len(recent_games) > 1 else 0
        stderr = pir_std / np.sqrt(len(recent_games)) if len(recent_games) > 0 else float('inf')
        
        cr = group['CR'].iloc[0] if 'CR' in group else float('inf')
        position = group['position'].iloc[0] if 'position' in group else "Unknown"
        
        # Normalize PIR and CR for scoring
        pir_norm = (pir_avg - df['PIR'].min()) / (df['PIR'].max() - df['PIR'].min())
        cr_norm = (df['CR'].max() - cr) / (df['CR'].max() - df['CR'].min()) if df['CR'].max() != df['CR'].min() else 0
        
        # Weighted formula: Score = w1*pir_norm + w2*cr_norm - w3*stderr
        score = (w1 * pir_norm) + (w2 * cr_norm) - (w3 * stderr) if cr > 0 else 0
        
        recommendations.append({
            'PlayerName': name,
            'PIR_Avg': pir_avg,
            'StdErr': stderr,
            'CR': cr,
            'position': position,
            'Score': score
        })
    
    recommendations_df = pd.DataFrame(recommendations).sort_values(by='Score', ascending=False)
    # st.subheader("Top 10 Recommended Players Based on Weighted Formula")
    # st.write(recommendations_df[['PlayerName', 'PIR_Avg', 'StdErr', 'CR', 'position', 'Score']].head(10))
    return recommendations_df

def recent_rows(player_rows, last_x_games):
    """A player's last `last_x_games` rows, newest first - the window every form figure uses."""
    return player_rows.sort_values('GameCode', ascending=False).head(last_x_games)


def exp_weighted_form(recent, alpha):
    """
    The exponentially weighted mean score of `recent` (recent_rows' output, newest
    first): the i-th game back weighs alpha^i, so alpha near 1 keeps older games in play
    and a small one leaves only the last few. None when none of the games has a score
    (a priced player who has not played yet). The Recommendations tab's Exp Weighted FPT,
    and My Teams' "Your formula" before the matchup.
    """
    scores = pd.to_numeric(recent['Score'], errors='coerce').values[::-1]  # oldest -> newest
    if not len(scores) or np.all(np.isnan(scores)):
        return None
    scores = np.nan_to_num(scores, nan=0.0)
    weights = np.array([alpha**i for i in range(len(scores))])[::-1]  # newest weighs 1
    total = np.sum(weights)
    return float(np.sum(scores * weights) / total) if total > 0 else 0.0


def recommend_players_v2(df,
                         last_x_games=5,
                         alpha=0.85,
                         weight_efficiency=2.0,
                         weight_mean_pir=1.0,
                         weight_consistency=1.0,
                         weight_matchup=0.0,
                         matchups=None):
    """
    Recommend top players using:
      - Exponential decay weighting for recent games
      - The next opponent's defense against the player's position
      - Cost efficiency (PIR relative to CR)
      - Consistency penalty (via std err)

    Parameters:
    -----------
    df : pd.DataFrame
        DataFrame with columns ['PlayerName', 'GameCode', 'PIR', 'CR', 'position'].
    last_x_games : int
        How many recent games to consider for each player.
    alpha : float
        Decay factor for exponential weighting (0 < alpha < 1).
        Closer to 1.0 means older games still matter quite a bit;
        smaller means older games quickly become negligible.
    weight_efficiency : float
        The relative importance of cost-efficiency (PIR / CR).
    weight_mean_pir : float
        The relative importance of raw average PIR (exp-weighted).
    weight_consistency : float
        The importance of penalizing players for high volatility
        (higher means a bigger penalty for large std error).
    weight_matchup : float
        How much of the opponent factor moves the form (0 = none, 1 = all of it):
        see defense_vs_position.matchup_multiplier.
    matchups : dict or None
        defense_vs_position.matchup_factors' map, {TeamCode: (opponent, {G/F/C: factor})}.
        Without it (or for a club with no game) the form is used as it is.
    """
    from .defense_vs_position import matchup_multiplier

    # Basic checks
    necessary_cols = {'PlayerName', 'Score', 'CR', 'GameCode'}
    if not necessary_cols.issubset(df.columns):
        print(f"DataFrame missing required columns: {necessary_cols - set(df.columns)}")
        return None
    matchups = matchups or {}

    # Group by player
    grouped = df.groupby('PlayerName', group_keys=True)
    recommendations = []

    for player_name, player_data in grouped:
        player_data_sorted = recent_rows(player_data, last_x_games)

        # If no games in the chosen range, skip
        if player_data_sorted.empty:
            continue

        # Extract CR and position from the most recent record for convenience
        cr = player_data_sorted['CR'].iloc[0] if 'CR' in player_data_sorted else np.nan
        position = player_data_sorted['position'].iloc[0] if 'position' in player_data_sorted else "Unknown"

        # If CR is 0 or invalid, skip or set a large cost to avoid dividing by zero
        if not cr or cr <= 0:
            cr = np.inf

        # 1. Exponential Weighted Mean Score
        exp_weighted_score = exp_weighted_form(player_data_sorted, alpha)
        if exp_weighted_score is None:
            # Priced player with no games played yet (pre-season, or a new signing).
            continue

        # 2. The next game: the form moved by the opponent's defense at his position.
        team = player_data_sorted['TeamCode'].iloc[0] if 'TeamCode' in player_data_sorted else None
        opponent, factors = matchups.get(team, (None, {}))
        factor = factors.get(position) if opponent else None
        next_game = exp_weighted_score * matchup_multiplier(factor, weight_matchup)

        # 3. Cost Efficiency (next-game score / CR)
        efficiency = next_game / cr if cr > 0 else 0

        # 4. Consistency Penalty -> standard deviation or standard error
        #    We can measure how stable the player's recent scoring is.
        score_std = player_data_sorted['Score'].std(ddof=1) if len(player_data_sorted) > 1 else 0
        n_games = len(player_data_sorted)
        stderr = score_std / np.sqrt(n_games) if n_games > 0 else 0
        if np.isnan(stderr):
            stderr = 0

        # Combine them into a single ranking score
        #   RecScore = weight_mean_pir*(next-game score)
        #            + weight_efficiency*(efficiency)
        #            - weight_consistency*(stderr)
        rec_score = (
            weight_mean_pir * next_game
            + weight_efficiency * efficiency
            - weight_consistency * stderr
        )

        recommendations.append({
            'PlayerName': player_name,
            # Carried so the client can join this row to the player's CR history.
            'PlayerKey': (player_data_sorted['PlayerKey'].iloc[0]
                          if 'PlayerKey' in player_data_sorted else None),
            'ExpWeightedScore': exp_weighted_score,
            'NextGameFPT': next_game,
            'Opponent': opponent or '',
            'MatchupFactor': round(float(factor), 3) if factor is not None else None,
            'Efficiency': efficiency,
            'CR': cr,
            'position': position,
            'StdErr': stderr,
            # Named RecScore to keep it distinct from the per-game Score column.
            'RecScore': rec_score
        })

    if not recommendations:
        print("No valid players found based on the given data.")
        return None

    # Sort by score descending
    recommendations_df = pd.DataFrame(recommendations).sort_values(by='RecScore', ascending=False)

    return recommendations_df
