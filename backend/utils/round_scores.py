# utils/round_scores.py
"""
Every player's FPT and every club's margin, round by round - for My Teams' Round
dropdown, which replays a roster on a past round: each player's points counted by his
role, the coach on his club's margin (utils/coaches.py's table, applied in the browser).

The margins are expected.played_games(): each club's points summed from the stored
player rows, like the Matchups tab - nothing on a request path leaves the bucket.
"""

import pandas as pd

from .expected import played_games


def round_scores_payload(df):
    """
    {rounds, players: {PlayerKey: {round: {fpt, min}}}, clubs: {code: {round: {margin,
    opp, home}}}}. Round keys are strings (JSON). A player with no row in a round did
    not play in it.
    """
    need = {"PlayerKey", "Round", "FPT", "GameCode"}
    if df.empty or not need <= set(df.columns):
        return {"rounds": [], "players": {}, "clubs": {}}

    rows = df.dropna(subset=["PlayerKey", "Round", "GameCode"]).copy()
    rows["Round"] = pd.to_numeric(rows["Round"], errors="coerce")
    rows = rows.dropna(subset=["Round"])
    rows["Round"] = rows["Round"].astype(int)
    rows["FPT"] = pd.to_numeric(rows["FPT"], errors="coerce").fillna(0)
    rows["min"] = (pd.to_numeric(rows["MinutesPlayed"], errors="coerce").fillna(0)
                   if "MinutesPlayed" in rows.columns else 0.0)
    per = rows.groupby(["PlayerKey", "Round"])[["FPT", "min"]].sum()

    players = {}
    for (key, rnd), r in per.iterrows():
        players.setdefault(str(key), {})[str(rnd)] = {
            "fpt": round(float(r["FPT"]), 1),
            "min": round(float(r["min"]), 1),
        }

    clubs = {}
    for rnd, home, away, margin in played_games(df):
        m = int(round(margin))
        clubs.setdefault(home, {})[str(rnd)] = {"margin": m, "opp": away, "home": True}
        clubs.setdefault(away, {})[str(rnd)] = {"margin": -m, "opp": home, "home": False}

    return {
        "rounds": sorted(int(r) for r in rows["Round"].unique()),
        "players": players,
        "clubs": clubs,
    }
