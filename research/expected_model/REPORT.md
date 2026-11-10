# Next-game FPT: which model predicts best

Run: `./run.sh build_dataset.py`, `./run.sh evaluate.py`, `./run.sh report.py`, `./run.sh explain.py`
(data from `dump_data.py`, run with the backend venv). Leaderboards: `data/leaderboard_<set>.csv`.

## Setup
- 22,524 player-games: 2024-25, 2025-26 (FPT rebuilt as PIR + 10% for winners; matches official
  FPT on 99.5% of 2026-27 rows) and 2026-27 rounds 1-10. 2023-24 has no game rows.
- Target: his FPT in his club's next game, 0 if he does not play. Features use earlier games only.
- Walk-forward, rounds 4 on, refit every 4 rounds (2 in 2026-27). Scored on players who played
  at least one of their club's last 10 games.
- T25 = 2025-26 (35 rounds, development), T26 = 2026-27 (7 rounds, holdout),
  T24 = 2024-25 (31 rounds, holdout, no prices).
- Squad test: best 10 players at 97 CR (105 less a typical coach), captain x2, bench x0.5,
  scored on what happened. Players only, so ~8 below the original backtest's 134.

## Results (RMSE, lower is better; squad = FPT per round)

| Model | T25 | T26 | T24 | Squad T25 | Squad T26 |
|---|---|---|---|---|---|
| Blend of 8 ML models | 6.99 | 7.25 | 6.87 | 135.7 | 118.2 |
| Two-stage trees (hurdle_lgb) | 7.04 | 7.22 | 6.89 | 127.9 | 114.9 |
| GRU over last 10 games | 7.05 | 7.27 | 6.87 | 132.7 | 117.3 |
| Two-stage linear (hurdle_linear) | 7.04 | 7.32 | 6.90 | 132.1 | 120.2 |
| Kalman skill tracker | 7.07 | 7.35 | 6.96 | 125.6 | 124.8 |
| **Current EuroGuru model** | 7.20 | 7.39 | 7.13 | 126.4 | 123.5 |
| Availability x season average | 7.26 | 7.74 | 7.11 | 125.6 | 118.4 |
| Season average | 7.65 | 7.99 | 7.52 | 111.1 | 98.3 |
| Your formula (defaults) | 7.72 | 7.96 | 7.59 | 118.0 | 101.3 |
| Last 5 average | 7.91 | 8.06 | 7.77 | 116.7 | 112.5 |

- The blend's RMSE gain over the current model is outside the noise on all three sets
  (90% intervals: T25 +0.15..+0.25, T26 +0.08..+0.20, T24 +0.22..+0.31).
- Squad test: blend +9.4 FPT a round on T25 (90% interval +2.9..+15.7). On T26's 7 rounds
  every ML model is a few points behind the current one, inside a +/-15 interval: undecided.
- A player's score swings by 8.5 around his mean; the best model's error is 7.0. Most of what
  is left is luck, so no model will move these numbers much further.
- Teammate-absence features, a price-free variant, Huber/L1 losses and a recalibrated
  current model were tried; none beat the models above.

## What drives the winners
- Score if he plays: season average (31% of tree gain), then recent form, the median of his
  last 10, win probability x average, price, minutes.
- Chance he plays: whether he played the last game (42%), his current streak (20%), last 3.
