"""
The leaderboard from evaluate.py's predictions: accuracy, calibration, ranking and the
squad test, per test set, plus blends of the best models. Writes data/leaderboard_<set>.csv.

Scored on the players a manager would consider: those who played at least one of their
club's last 10 games. RMSE is the headline - a squad is picked on expected points, and
RMSE is what an expected value is judged by; MAE is shown beside it.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.stats import spearmanr

DATA = Path(__file__).parent / "data"
META = ["season", "round", "date", "gid", "player", "pos", "cr", "y", "played", "avail_l10", "n_played"]
SQUAD = {"G": 4, "F": 4, "C": 2}
PLAYER_BUDGET = 97.0  # 105 CR less a typical coach
BLENDS = {
    "blend_top3": ["hurdle_lgb", "ridge", "gru"],
    "blend_lin_tree": ["hurdle_linear", "hurdle_lgb"],
    "blend_all_ml": ["ridge", "hurdle_linear", "hurdle_lgb", "lgb", "minutes", "mlp", "gru", "rf"],
    "blend_stat_ml": ["kalman", "hurdle_lgb", "ridge"],
}


def best_squad(rows, col):
    """The 10 players and roles with the highest projected round score within the budget:
    captain x2, five more at x1 (every position among those six), four at x0.5."""
    r = rows[rows["cr"].notna() & rows["pos"].isin(list(SQUAD))].drop_duplicates("player")
    n = len(r)
    v, cr, pos = r[col].values, r["cr"].values, r["pos"].values
    c = -np.concatenate([2 * v, v, 0.5 * v])  # captain, full, half
    eye = np.eye(n)
    cons = [LinearConstraint(np.hstack([eye, eye, eye]), 0, 1),
            LinearConstraint(np.concatenate([np.ones(n), np.zeros(2 * n)])[None], 1, 1),
            LinearConstraint(np.concatenate([np.zeros(n), np.ones(n), np.zeros(n)])[None], 5, 5),
            LinearConstraint(np.concatenate([np.zeros(2 * n), np.ones(n)])[None], 4, 4),
            LinearConstraint(np.tile(cr, 3)[None], 0, PLAYER_BUDGET)]
    for k, need in SQUAD.items():
        m = (pos == k).astype(float)
        cons.append(LinearConstraint(np.tile(m, 3)[None], need, need))
        cons.append(LinearConstraint(np.concatenate([m, m, np.zeros(n)])[None], 1, np.inf))
    res = milp(c, constraints=cons, integrality=np.ones(3 * n), bounds=Bounds(0, 1))
    if res.x is None:
        return None
    w = res.x[:n].round() * 2 + res.x[n:2 * n].round() + res.x[2 * n:].round() * 0.5
    return float(w @ r["y"].values), float(w @ v)


def score(d, col, squads=True):
    e = d[d["avail_l10"] > 0]
    err = e[col] - e["y"]
    on = e[e["played"] == 1]
    top = e[e[col] >= e[col].quantile(0.9)]
    rho, hits = [], []
    for _, g in e.groupby("round"):
        rho.append(spearmanr(g[col], g["y"]).statistic)
        hits.append(len(set(g.nlargest(20, col)["player"]) & set(g.nlargest(20, "y")["player"])) / 20)
    out = {"model": col, "RMSE": np.sqrt((err ** 2).mean()), "MAE": err.abs().mean(),
           "MAE_played": (on[col] - on["y"]).abs().mean(), "bias": err.mean(), "bias_top10%": (top[col] - top["y"]).mean(),
           "spearman": np.mean(rho), "top20_hit": np.mean(hits)}
    if squads and e["cr"].notna().any():
        res = [s for s in (best_squad(g, col) for _, g in e.groupby("round")) if s]
        out["squad_FPT"] = np.mean([a for a, _ in res])
        out["squad_gap"] = np.mean([p - a for a, p in res])
    return out


def paired(d, a, b, n=2000, seed=0):
    """Mean squared-error gain of a over b per round, with a bootstrap 90% interval over rounds."""
    e = d[d["avail_l10"] > 0]
    by = e.assign(da=(e[a] - e["y"]) ** 2, db=(e[b] - e["y"]) ** 2).groupby("round")[["da", "db"]].sum()
    cnt = e.groupby("round").size()
    rng = np.random.default_rng(seed)
    gains = []
    for _ in range(n):
        i = rng.integers(0, len(by), len(by))
        gains.append(np.sqrt(by["db"].values[i].sum() / cnt.values[i].sum()) - np.sqrt(by["da"].values[i].sum() / cnt.values[i].sum()))
    return np.mean(gains), np.percentile(gains, 5), np.percentile(gains, 95)


def main():
    pd.set_option("display.width", 250, "display.max_columns", 30, "display.float_format", "{:.3f}".format)
    for name in [a for a in sys.argv[1:]] or ["T25", "T26", "T24"]:
        path = DATA / f"preds_{name}.csv"
        if not path.exists():
            continue
        d = pd.read_csv(path, parse_dates=["date"])
        for b, parts in BLENDS.items():
            d[b] = d[parts].mean(axis=1)
        models = [c for c in d.columns if c not in META]
        board = pd.DataFrame([score(d, m) for m in models]).sort_values("RMSE").reset_index(drop=True)
        board.to_csv(DATA / f"leaderboard_{name}.csv", index=False)
        e = d[d["avail_l10"] > 0]
        print(f"\n===== {name}: {len(e)} player-games, {e['round'].nunique()} rounds, {e['played'].mean():.2f} played, "
              f"mean FPT {e['y'].mean():.2f}, sd {e['y'].std():.2f}")
        print(board.to_string(index=False))
        print("RMSE gain over the current model (bootstrap over rounds, 90% interval):")
        for m in board["model"].head(8):
            if m != "current":
                g, lo, hi = paired(d, m, "current")
                print(f"  {m:<16} {g:+.3f}  [{lo:+.3f}, {hi:+.3f}]")


if __name__ == "__main__":
    main()
