"""
Walk-forward test of every candidate model for a player's next-game FPT.

For each test season the rounds from 4 on are predicted in blocks: a model is fitted on
everything dated before the block (the other seasons allowed for that test set plus this
season's earlier rounds), then predicts the block. Predictions land in
data/preds_<set>.csv; report.py turns them into the leaderboard.

Test sets:
  T25  2025-26 rounds 4-38, history: 2024-25               (development: models were shaped here)
  T26  2026-27 rounds 4-10, history: 2024-25 + 2025-26     (holdout)
  T24  2024-25 rounds 4-34, history: 2025-26, no prices    (holdout, price-free)
"""
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
import torch
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import RidgeCV, LassoCV, HuberRegressor, LogisticRegression
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
DATA = Path(__file__).parent / "data"

LEVEL = ["n_played", "n_club", "avg", "avg_l3", "avg_l5", "avg_l10", "ewm85", "ewm60", "med_l10", "std", "last1", "last2",
         "last3", "max_l10", "min_l10"]
ROLE = ["mins", "mins_l3", "mins_l5", "mins_last", "fpm", "fpm_l5", "start_share", "start_l3", "usage", "usage_l5"]
AVAIL = ["avail", "avail_l3", "avail_l5", "avail_l10", "played_last", "streak", "days_since_played", "days_rest"]
CONTEXT = ["home", "exp_margin", "win_prob", "team_rating", "opp_rating", "dvp", "round"]
PREV = ["prev_avg", "prev_games", "prev_mins"]
PRICE = ["cr", "cr_age", "cr_delta", "cr_first"]
POS = ["pos_G", "pos_F", "pos_C"]
TEAM = ["out_mins", "out_mins_pos", "rivals_pos", "abs_margin"]
CROSS = ["x_avail_avg", "x_avail_ewm", "x_win_avg", "x_dvp_avg", "x_avail_cr"]

SETS = {
    "T25": dict(season=2025, history=[2024], block=4, price=True),
    "T26": dict(season=2026, history=[2024, 2025], block=2, price=True),
    "T24": dict(season=2024, history=[2025], block=4, price=False),
}


def load():
    d = pd.read_csv(DATA / "dataset.csv", parse_dates=["date"])
    for p in "GFC":
        d[f"pos_{p}"] = (d["pos"] == p).astype(int)
    d["x_avail_avg"] = d["avail_l5"] * d["avg"]
    d["x_avail_ewm"] = d["avail_l5"] * d["ewm85"]
    d["x_win_avg"] = d["win_prob"] * d["avg"]
    d["x_dvp_avg"] = (d["dvp"] - 1) * d["avg"]
    d["x_avail_cr"] = d["avail_l5"] * d["cr"]
    # Teammates: the minutes of regulars who sat out the club's last game (minutes that
    # are up for grabs), at his position and overall, and the competition still there.
    live = d["avail_l10"] > 0
    out = d["mins"] * ((d["played_last"] == 0) & live)
    there = d["mins"] * ((d["played_last"] == 1) & live)
    game = [d["season"], d["team"], d["gid"]]
    d["out_mins"] = out.groupby(game).transform("sum") - out
    d["out_mins_pos"] = out.groupby(game + [d["pos"]]).transform("sum") - out
    d["rivals_pos"] = there.groupby(game + [d["pos"]]).transform("sum") - there
    d["abs_margin"] = d["exp_margin"].abs()
    return d.sort_values(["date", "gid", "player"]).reset_index(drop=True)


def feats(price, team=False):
    return (LEVEL + ROLE + AVAIL + CONTEXT + PREV + POS + CROSS[:4] + ((PRICE + CROSS[4:]) if price else [])
            + (TEAM if team else []))


# ----------------------------------------------------------------------------- heuristics

def m_avg(tr, te, F):
    return te["avg"].values


def m_avail_avg(tr, te, F):
    return (te["avail_l5"] * te["avg"]).values


def m_last5(tr, te, F):
    return te["avg_l5"].values


def m_form(tr, te, F):
    """The app's "Your formula" at its defaults: Exp Weighted FPT x the matchup at 0.3."""
    return (te["ewm85"] * (1 + 0.3 * (te["dvp"] - 1))).values


def price_line(rows):
    """What a price buys: a line through every regular's (price, average), per round."""
    reg = rows[(rows["n_played"] >= 3) & rows["cr"].notna()].drop_duplicates("player")
    if len(reg) >= 10:
        slope, icept = np.polyfit(reg["cr"], reg["avg"], 1)
        return lambda cr, avg: np.where(np.isnan(cr), avg, icept + slope * cr)
    mean = rows.loc[rows["n_played"] >= 3, "avg"].mean()
    return lambda cr, avg: np.full(len(avg), mean)


def m_current(tr, te, F, shrink=6):
    """The shipped EuroGuru model (backend/utils/expected.player_values)."""
    out = pd.Series(0.0, index=te.index)
    for _, rows in te.groupby("round"):
        implied = price_line(rows)(rows["cr"].values, rows["avg"].values)
        est = (rows["n_played"] * rows["avg"] + shrink * implied) / (rows["n_played"] + shrink)
        out[rows.index] = rows["avail_l5"] * est
    return out.values


def m_current_calibrated(tr, te, F):
    x = m_current(tr, tr, F)
    ok = np.isfinite(x)
    slope, icept = np.polyfit(x[ok], tr["y"].values[ok], 1)
    return icept + slope * m_current(tr, te, F)


def with_team(fn):
    return lambda tr, te, F: fn(tr, te, F + TEAM)


# ----------------------------------------------------------------------------- table models

def table(tr, te, F):
    """Train/test matrices: medians for gaps plus a missing flag per gappy column."""
    med = tr[F].median()
    gappy = [c for c in F if tr[c].isna().any() or te[c].isna().any()]
    def mat(d):
        x = d[F].fillna(med).fillna(0.0)
        for c in gappy:
            x[f"{c}_na"] = d[c].isna().astype(int)
        return x.values
    return mat(tr), mat(te)


def linear(model):
    def run(tr, te, F):
        a, b = table(tr, te, F)
        return make_pipeline(StandardScaler(), model()).fit(a, tr["y"]).predict(b)
    return run


m_ridge = linear(lambda: RidgeCV(alphas=np.logspace(-1, 4, 20)))
m_lasso = linear(lambda: LassoCV(cv=5, alphas=30, max_iter=5000))
m_huber = linear(lambda: HuberRegressor(alpha=10.0, max_iter=500))

LGB = dict(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=40, subsample=0.8, subsample_freq=1,
           colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, random_state=0, n_jobs=4)


def m_lgb(tr, te, F, **kw):
    return lgb.LGBMRegressor(**{**LGB, **kw}).fit(tr[F], tr["y"]).predict(te[F])


def m_lgb_huber(tr, te, F):
    return m_lgb(tr, te, F, objective="huber", alpha=12.0)


def m_lgb_l1(tr, te, F):
    return m_lgb(tr, te, F, objective="l1")


def m_rf(tr, te, F):
    a, b = table(tr, te, F)
    return RandomForestRegressor(300, min_samples_leaf=25, max_features=0.4, n_jobs=4, random_state=0).fit(a, tr["y"]).predict(b)


def m_mlp(tr, te, F):
    a, b = table(tr, te, F)
    sc = StandardScaler().fit(a)
    preds = [MLPRegressor(hidden_layer_sizes=(64, 32), alpha=1e-2, learning_rate_init=1e-3, early_stopping=True, max_iter=300,
                          random_state=s).fit(sc.transform(a), tr["y"]).predict(sc.transform(b)) for s in range(3)]
    return np.mean(preds, axis=0)


# ----------------------------------------------------------------------------- two-stage models

def p_play_logit(tr, te, F):
    a, b = table(tr, te, AVAIL + ["n_club", "n_played", "mins", "mins_l3", "round"])
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000)).fit(a, tr["played"]).predict_proba(b)[:, 1]


def p_play_lgb(tr, te, F):
    return lgb.LGBMClassifier(**{**LGB, "n_estimators": 300}).fit(tr[F], tr["played"]).predict_proba(te[F])[:, 1]


def m_hurdle_linear(tr, te, F):
    """P(plays) by logistic regression x his score if he plays by ridge."""
    on = tr[tr["played"] == 1]
    a, b = table(on, te, F)
    cond = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1, 4, 20))).fit(a, on["y"]).predict(b)
    return p_play_logit(tr, te, F) * cond


def m_hurdle_lgb(tr, te, F):
    """P(plays) x his score if he plays, both gradient-boosted trees."""
    on = tr[tr["played"] == 1]
    cond = lgb.LGBMRegressor(**LGB).fit(on[F], on["y"]).predict(te[F])
    return p_play_lgb(tr, te, F) * cond


def m_minutes(tr, te, F):
    """Expected minutes (trees, 0 when he sits) x FPT per minute if he plays (trees)."""
    mins = np.clip(lgb.LGBMRegressor(**LGB).fit(tr[F], tr["y_min"]).predict(te[F]), 0, None)
    on = tr[tr["played"] == 1]
    rate = lgb.LGBMRegressor(**LGB).fit(on[F], on["y"] / on["y_min"].clip(lower=3), sample_weight=on["y_min"]).predict(te[F])
    return mins * rate


# ----------------------------------------------------------------------------- skill tracking

def sequences(d):
    """(season, player) -> the row indexes of his club games, oldest first."""
    return {k: g.index.values for k, g in d.groupby(["season", "player"], sort=False)}


def kalman_column(d, seqs, prior, tau2, q, sigma2=60.0):
    """A local-level filter of each player's ability: starts at `prior` (per row index,
    his preseason expectation) with variance tau2, drifts by q a game, sees each score he
    plays with noise sigma2. Returns the ability estimate before each row's game."""
    y, played, avg, n = d["y"].values, d["played"].values, d["avg"].values, d["n_played"].values
    out = np.zeros(len(d))
    for idx in seqs.values():
        i0 = idx[0]
        mu, var = prior[i0], tau2
        # The games before his first row are summarised by (avg, n): fold them in at once.
        k = var / (var + sigma2 / n[i0])
        mu, var = mu + k * (avg[i0] - mu), (1 - k) * var
        for i in idx:
            var += q
            out[i] = mu
            if played[i]:
                k = var / (var + sigma2)
                mu, var = mu + k * (y[i] - mu), (1 - k) * var
    return out


def preseason_prior(tr, d):
    """Each row's preseason expectation: a ridge on last season's average and the opening
    price where known, else the league's mean - fitted on training rows' season averages."""
    X = pd.DataFrame({"prev": d["prev_avg"].fillna(0), "has_prev": d["prev_avg"].notna().astype(int),
                      "cr": d["cr_first"].fillna(0), "has_cr": d["cr_first"].notna().astype(int),
                      "G": d["pos_G"], "C": d["pos_C"]}, index=d.index)
    on = tr[tr["played"] == 1]
    model = RidgeCV(alphas=np.logspace(-2, 2, 10)).fit(X.loc[on.index], on["y"])
    return model.predict(X)


def make_kalman(d, seqs):
    def run(tr, te, F):
        prior = preseason_prior(tr, d)
        on = tr[tr["played"] == 1]
        best = None
        for tau2 in (4, 9, 16, 30):
            for q in (0.0, 0.05, 0.15, 0.4):
                col = kalman_column(d, seqs, prior, tau2, q)
                err = np.mean((on["y"].values - col[on.index]) ** 2)
                if best is None or err < best[0]:
                    best = (err, col)
        return p_play_logit(tr, te, F) * best[1][te.index]
    return run


def m_eb(tr, te, F):
    """Empirical Bayes: availability x his average shrunk toward a prior (last season,
    price, position), the availability window and shrink strength fitted on training rows."""
    def prior(rows):
        return rows["_prior"].values
    best = None
    on = tr
    for k in (2, 4, 6, 9, 13):
        for av in ("avail_l3", "avail_l5", "avail_l10"):
            est = (on["n_played"] * on["avg"] + k * prior(on)) / (on["n_played"] + k)
            err = np.mean((on["y"] - on[av] * est) ** 2)
            if best is None or err < best[0]:
                best = (err, k, av)
    _, k, av = best
    return (te[av] * (te["n_played"] * te["avg"] + k * prior(te)) / (te["n_played"] + k)).values


# ----------------------------------------------------------------------------- GRU

class Net(torch.nn.Module):
    def __init__(self, n_static):
        super().__init__()
        self.gru = torch.nn.GRU(3, 24, batch_first=True)
        self.head = torch.nn.Sequential(torch.nn.Linear(24 + n_static, 48), torch.nn.ReLU(), torch.nn.Dropout(0.2),
                                        torch.nn.Linear(48, 1))

    def forward(self, seq, static):
        _, h = self.gru(seq)
        return self.head(torch.cat([h[-1], static], dim=1)).squeeze(1)


def make_gru(d, seqs, length=10):
    """A GRU over his last 10 club games (played, FPT, minutes) joined to the feature table."""
    seq = np.zeros((len(d), length, 3), dtype=np.float32)
    y, played, mins = d["y"].values, d["played"].values, d["y_min"].values
    for idx in seqs.values():
        i0 = idx[0]
        hist = [(1.0, d["avg"].values[i0] / 10, d["mins"].values[i0] / 40)]
        for i in idx:
            h = hist[-length:]
            seq[i, length - len(h):] = h
            hist.append((float(played[i]), y[i] / 10, mins[i] / 40))

    def run(tr, te, F):
        a, b = table(tr, te, F)
        sc = StandardScaler().fit(a)
        a, b = sc.transform(a).astype(np.float32), sc.transform(b).astype(np.float32)
        preds = []
        for seed in range(3):
            torch.manual_seed(seed)
            net = Net(a.shape[1])
            opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
            xs, xa, ty = torch.tensor(seq[tr.index]), torch.tensor(a), torch.tensor(tr["y"].values, dtype=torch.float32)
            for _ in range(25):
                net.train()
                order = torch.randperm(len(ty))
                for i in range(0, len(ty), 256):
                    j = order[i:i + 256]
                    opt.zero_grad()
                    torch.nn.functional.mse_loss(net(xs[j], xa[j]), ty[j]).backward()
                    opt.step()
            net.eval()
            with torch.no_grad():
                preds.append(net(torch.tensor(seq[te.index]), torch.tensor(b)).numpy())
        return np.mean(preds, axis=0)
    return run


# ----------------------------------------------------------------------------- the run

def run_set(name, d, only=None):
    cfg = SETS[name]
    F = feats(cfg["price"])
    seqs = sequences(d)
    models = {
        "avg": m_avg, "avail_avg": m_avail_avg, "last5": m_last5, "form": m_form, "current": m_current,
        "eb": m_eb, "kalman": make_kalman(d, seqs),
        "ridge": m_ridge, "lasso": m_lasso, "huber": m_huber,
        "hurdle_linear": m_hurdle_linear, "hurdle_lgb": m_hurdle_lgb, "minutes": m_minutes,
        "rf": m_rf, "lgb": m_lgb, "lgb_huber": m_lgb_huber, "lgb_l1": m_lgb_l1,
        "mlp": m_mlp, "gru": make_gru(d, seqs),
        # The same models with the teammate features added.
        "hurdle_lgb_team": with_team(m_hurdle_lgb), "lgb_team": with_team(m_lgb), "ridge_team": with_team(m_ridge),
        "hurdle_linear_team": with_team(m_hurdle_linear), "minutes_team": with_team(m_minutes),
        # The shipped model, straightened: a line fitted on training rows from its number to the score.
        "current_calibrated": m_current_calibrated,
    }
    if only:
        models = {k: v for k, v in models.items() if k in only}
    season = d[d["season"] == cfg["season"]]
    last = int(season["round"].max())
    out = []
    for start in range(4, last + 1, cfg["block"]):
        te = season[(season["round"] >= start) & (season["round"] < start + cfg["block"])]
        if te.empty:
            continue
        tr = d[d["season"].isin(cfg["history"]) | ((d["season"] == cfg["season"]) & (d["date"] < te["date"].min()))].copy()
        te = te.copy()
        if not cfg["price"]:
            tr[PRICE], te[PRICE] = np.nan, np.nan
        # The preseason prior the Bayes model shrinks to, fitted on this block's training rows.
        prior = preseason_prior(tr, d)
        tr["_prior"], te["_prior"] = prior[tr.index], prior[te.index]
        block = te[["season", "round", "date", "gid", "player", "pos", "cr", "y", "played", "avail_l10", "n_played"]].copy()
        for mname, fn in models.items():
            block[mname] = fn(tr, te, F)
        out.append(block)
        print(f"  {name} rounds {start}-{min(last, start + cfg['block'] - 1)}: {len(tr)} train, {len(te)} test", flush=True)
    res = pd.concat(out)
    path = DATA / f"preds_{name}.csv"
    if only and path.exists():
        old = pd.read_csv(path, parse_dates=["date"])
        for c in models:
            old[c] = res[c].values
        res = old
    res.to_csv(path, index=False)


if __name__ == "__main__":
    data = load()
    names = [a for a in sys.argv[1:] if a in SETS] or list(SETS)
    only = [a for a in sys.argv[1:] if a not in SETS] or None
    for n in names:
        run_set(n, data, only)
