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

def recommend_players_v2(df, 
                         last_x_games=5, 
                         alpha=0.85, 
                         weight_efficiency=2.0,
                         weight_mean_pir=1.0,
                         weight_consistency=1.0):
    """
    Recommend top players using:
      - Exponential decay weighting for recent games
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
    """

    # Basic checks
    necessary_cols = {'PlayerName', 'PIR', 'CR', 'GameCode'}
    if not necessary_cols.issubset(df.columns):
        print(f"DataFrame missing required columns: {necessary_cols - set(df.columns)}")
        return None

    # Group by player
    grouped = df.groupby('PlayerName', group_keys=True)
    recommendations = []

    for player_name, player_data in grouped:
        # Sort player's games by descending GameCode
        player_data_sorted = player_data.sort_values('GameCode', ascending=False).head(last_x_games)

        # If no games in the chosen range, skip
        if player_data_sorted.empty:
            continue

        # Extract CR and position from the most recent record for convenience
        cr = player_data_sorted['CR'].iloc[0] if 'CR' in player_data_sorted else np.nan
        position = player_data_sorted['position'].iloc[0] if 'position' in player_data_sorted else "Unknown"

        # If CR is 0 or invalid, skip or set a large cost to avoid dividing by zero
        if not cr or cr <= 0:
            cr = np.inf

        # 1. Exponential Weighted Mean PIR
        #    For the i-th game (from most recent to oldest), weight = alpha^i
        #    More recent = smaller i, bigger weight.
        pir_values = player_data_sorted['PIR'].values[::-1]  # oldest -> newest
        weights = np.array([alpha**i for i in range(len(pir_values))])[::-1]  # newest -> oldest
        # Re-reverse so it lines up properly
        # Alternatively, you could just compute alpha^(len-1 - i)

        weighted_sum = np.sum(pir_values * weights)
        total_weights = np.sum(weights)
        exp_weighted_pir = weighted_sum / total_weights if total_weights > 0 else 0

        # 2. Cost Efficiency (Ex: (Average PIR / CR) or (exp_weighted_pir / CR))
        efficiency = exp_weighted_pir / cr if cr > 0 else 0

        # 3. Consistency Penalty -> standard deviation or standard error
        #    We can measure how stable the player's recent PIR is.
        pir_std = player_data_sorted['PIR'].std(ddof=1) if len(player_data_sorted) > 1 else 0
        n_games = len(player_data_sorted)
        stderr = pir_std / np.sqrt(n_games) if n_games > 0 else 0

        # Combine them into a single score
        # The logic: 
        #   score = weight_mean_pir*(exp_weighted_pir) 
        #          + weight_efficiency*(efficiency) 
        #          - weight_consistency*(stderr)
        # 
        # Tweak the coefficients to your preference
        score = (
            weight_mean_pir * exp_weighted_pir
            + weight_efficiency * efficiency
            - weight_consistency * stderr
        )

        recommendations.append({
            'PlayerName': player_name,
            'ExpWeightedPIR': exp_weighted_pir,
            'Efficiency': efficiency,
            'CR': cr,
            'position': position,
            'StdErr': stderr,
            'Score': score
        })

    if not recommendations:
        print("No valid players found based on the given data.")
        return None

    # Sort by score descending
    recommendations_df = pd.DataFrame(recommendations).sort_values(by='Score', ascending=False)

    return recommendations_df