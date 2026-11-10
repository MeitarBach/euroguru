"""What drives the winning models, and how solid their squad-test gain is."""
import numpy as np, pandas as pd, lightgbm as lgb
from evaluate import load, feats, LGB, DATA
from report import best_squad, BLENDS

d = load(); F = feats(True)
on = d[d.played == 1]
reg = lgb.LGBMRegressor(**LGB).fit(on[F], on["y"]); clf = lgb.LGBMClassifier(**{**LGB, "n_estimators": 300}).fit(d[F], d["played"])
for name, m in [("score if he plays", reg), ("chance he plays", clf)]:
    g = pd.Series(m.booster_.feature_importance("gain"), F); g = (g / g.sum()).sort_values(ascending=False)
    print(name, "- share of gain:", ", ".join(f"{k} {v:.0%}" for k, v in g.head(8).items()))
for t in ["T25", "T26"]:
    p = pd.read_csv(DATA / f"preds_{t}.csv"); p = p[p.avail_l10 > 0]
    for b, parts in BLENDS.items(): p[b] = p[parts].mean(axis=1)
    sq = {m: np.array([best_squad(g, m)[0] for _, g in p.groupby("round")]) for m in ["current", "blend_all_ml", "hurdle_lgb", "hurdle_linear", "gru"]}
    rng = np.random.default_rng(0)
    for m in list(sq)[1:]:
        diff = sq[m] - sq["current"]; bs = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(4000)]
        print(f"{t} squad {m}: {sq[m].mean():.1f} vs current {sq['current'].mean():.1f}, diff {diff.mean():+.1f} [{np.percentile(bs,5):+.1f}, {np.percentile(bs,95):+.1f}], wins {np.mean(diff>0):.0%} of rounds")
