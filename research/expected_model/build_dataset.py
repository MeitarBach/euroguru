"""
One row per (player, club game): what was known before tip-off, and what he then scored.

Reads data/games_<season>.csv and data/cr_<season>.json (dump_data.py), writes
data/dataset.csv. Every feature for a game uses only games dated before it.

Target `y` is his FPT that game, 0 when he did not play. FPT is official in 2026-27 and
rebuilt for the archive seasons as PIR + 10% of |PIR| for the winners (the rule
.claude/skills/euroguru-data/verify.py checks). Regular season only.

A player is a candidate for a club game once he has played for that club this season,
until he turns up at another club.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
REGULAR = {"2024": 34, "2025": 38, "2026": 38}
HOME_EDGE, RATING_SHRINK, MARGIN_SD = 3.3, 7, 12.0


def load_games(season):
    d = pd.read_csv(DATA / f"games_{season}.csv", low_memory=False)
    d = d[d["Round"].notna() & (d["Round"] <= REGULAR[season])].copy()
    d["Round"] = d["Round"].astype(int)
    d["GameDate"] = pd.to_datetime(d["GameDate"])
    d["min"] = pd.to_numeric(d["MinutesPlayed"], errors="coerce").fillna(0.0)
    d = d[d["min"] > 0].copy()
    d["PIR"] = pd.to_numeric(d["PIR"], errors="coerce").fillna(0.0)
    d["Points"] = pd.to_numeric(d["Points"], errors="coerce").fillna(0.0)
    # One game per (round, pairing, date); a club's games in date order.
    d["pair"] = [" ".join(sorted(t)) for t in zip(d["TeamCode"], d["Opponent"])]
    d["gid"] = d["Round"].astype(str) + "|" + d["pair"] + "|" + d["GameDate"].dt.strftime("%Y-%m-%d")
    pts = d.groupby(["gid", "TeamCode"])["Points"].sum()
    opp_pts = pd.Series([pts.get((g, o), np.nan) for g, o in zip(d["gid"], d["Opponent"])], index=d.index)
    own_pts = pd.Series([pts.get((g, t), np.nan) for g, t in zip(d["gid"], d["TeamCode"])], index=d.index)
    d["margin"] = own_pts - opp_pts
    d = d[d["margin"].notna()].copy()
    rebuilt = d["PIR"] + 0.1 * d["PIR"].abs() * (d["margin"] > 0)
    if "FPT" in d.columns:
        official = pd.to_numeric(d["FPT"], errors="coerce")
        print(f"  {season}: rebuilt FPT vs official, max abs diff {np.nanmax((rebuilt - official).abs()):.2f}, "
              f"share within 0.05: {((rebuilt - official).abs() <= 0.05).mean():.3f}")
        d["fpt"] = official.fillna(rebuilt)
    else:
        d["fpt"] = rebuilt
    for c in ["IsStarter", "Usage%"]:
        d[c] = pd.to_numeric(d[c], errors="coerce") if c in d.columns else np.nan
    d["IsHome"] = d["IsHome"].astype(str).str.lower().eq("true")
    return d


def name_key(season, cr):
    """PlayerKey -> a key that is the same player in every season ("A|ABALDE")."""
    if season != "2026":
        return {}
    return {p["playerKey"]: p["nameKey"] for p in cr.get("players", [])}


def price_series(season, cr):
    """key -> [(date, cr)] oldest first, keyed like the games' PlayerKey."""
    out = {}
    for p in cr.get("players", []):
        key = p["playerKey"] if season == "2026" else p["nameKey"]
        out[key] = sorted((pd.Timestamp(s["date"]), float(s["cr"])) for s in p["series"])
    return out


def ratings(games):
    """club -> points better than average, from [(home, away, home margin)]
    (backend/utils/expected.club_ratings)."""
    clubs = {c for h, a, _ in games for c in (h, a)}
    r = dict.fromkeys(clubs, 0.0)
    for _ in range(40):
        for club in clubs:
            tot, n = 0.0, 0
            for h, a, m in games:
                if club == h:
                    tot, n = tot + m - HOME_EDGE + r[a], n + 1
                elif club == a:
                    tot, n = tot - m + HOME_EDGE + r[h], n + 1
            r[club] = tot / (n + RATING_SHRINK)
        mean = sum(r.values()) / len(r) if r else 0.0
        r = {c: v - mean for c, v in r.items()}
    return r


def build_season(season, prev):
    """rows for one season; `prev` = stable key -> last season's (avg, games, minutes)."""
    d = load_games(season)
    cr = json.loads((DATA / f"cr_{season}.json").read_text())
    stable = name_key(season, cr)
    prices = price_series(season, cr)
    pos_of = d.dropna(subset=["position"]).groupby("PlayerKey")["position"].first().to_dict()

    # Club games in date order, and each game's context from the games before its date.
    cg = (d.groupby(["TeamCode", "gid"]).agg(date=("GameDate", "first"), rnd=("Round", "first"), opp=("Opponent", "first"),
                                             home=("IsHome", "first"), margin=("margin", "first")).reset_index()
          .sort_values(["date", "gid"]))
    results = cg[cg["home"]][["date", "TeamCode", "opp", "margin"]].values.tolist()
    # FPT each club gave up to each position, per game, for the matchup factor.
    d["pos"] = d["PlayerKey"].map(pos_of).fillna("U")
    allowed = d.groupby(["Opponent", "gid", "pos"])["fpt"].sum().reset_index().merge(
        cg[["TeamCode", "gid", "date"]].rename(columns={"TeamCode": "Opponent"}), on=["Opponent", "gid"])

    ctx = {}
    for date in sorted(cg["date"].unique()):
        before = [(h, a, m) for dt, h, a, m in results if dt < date]
        r = ratings(before) if before else {}
        al = allowed[allowed["date"] < date]
        league = al.groupby("pos")["fpt"].mean().to_dict()
        club = al.groupby(["Opponent", "pos"])["fpt"].agg(["mean", "count"])
        ctx[date] = (r, league, club)

    club_games = {t: g.to_dict("records") for t, g in cg.groupby("TeamCode")}
    rows = []
    for key, g in d.sort_values("GameDate").groupby("PlayerKey"):
        played = {(r.TeamCode, r.gid): r for r in g.itertuples(index=False)}
        skey = stable.get(key, key)
        pv = prev.get(skey)
        series = prices.get(key, [])
        hist = []  # every club game since his first, oldest first: dict(played, fpt, min, ...)
        # His stints: (club, first date there, date he first appears elsewhere).
        firsts = g.groupby("TeamCode")["GameDate"].min().sort_values()
        stints = [(t, s, firsts.iloc[i + 1] if i + 1 < len(firsts) else pd.Timestamp.max) for i, (t, s) in enumerate(firsts.items())]
        for team, start, end in stints:
            for game in club_games[team]:
                if game["date"] < start or game["date"] >= end:
                    continue
                me = played.get((team, game["gid"]))
                if hist:  # at least one earlier game: a row to predict
                    rows.append(features(season, key, skey, pos_of.get(key, "U"), team, game, hist, pv, series, ctx, me))
                hist.append({"played": me is not None, "fpt": me.fpt if me else 0.0, "min": me.min if me else 0.0,
                             "start": me.IsStarter if me else np.nan, "usage": getattr(me, "_asdict")().get("Usage%") if me else np.nan,
                             "date": game["date"]})
    out = pd.DataFrame(rows)
    # What this season leaves for the next: per stable key.
    agg = d.assign(skey=d["PlayerKey"].map(lambda k: stable.get(k, k))).groupby("skey").agg(
        avg=("fpt", "mean"), games=("fpt", "size"), mins=("min", "mean"))
    return out, {k: (v.avg, v.games, v.mins) for k, v in agg.iterrows()}


def ewm(x, alpha):
    """Exponentially weighted mean of x (oldest first), newest weighing 1."""
    w = alpha ** np.arange(len(x) - 1, -1, -1)
    return float(np.sum(w * x) / np.sum(w))


def features(season, key, skey, pos, team, game, hist, pv, series, ctx, me):
    p = [h for h in hist if h["played"]]
    f = np.array([h["fpt"] for h in p])
    m = np.array([h["min"] for h in p])
    flags = np.array([h["played"] for h in hist], dtype=float)
    last = lambda a, n: float(np.mean(a[-n:])) if len(a) else np.nan  # noqa: E731
    r, league, club = ctx[game["date"]]
    margin = r.get(team, 0.0) - r.get(game["opp"], 0.0) + (HOME_EDGE if game["home"] else -HOME_EDGE)
    win = 0.5 * (1 + math.erf(margin / (MARGIN_SD * math.sqrt(2))))
    # Opponent's defense at his position: FPT allowed there per game against the league's, shrunk by 5 games.
    try:
        a = club.loc[(game["opp"], pos)]
        dvp = (a["mean"] * a["count"] + league[pos] * 5) / (a["count"] + 5) / league[pos]
    except KeyError:
        dvp = 1.0
    known = [(dt, c) for dt, c in series if dt < game["date"]]
    streak = 0
    for h in reversed(hist):
        if h["played"] != hist[-1]["played"]:
            break
        streak += 1
    starts = np.array([h["start"] for h in p], dtype=float)
    usage = np.array([h["usage"] for h in p], dtype=float)
    row = {
        "season": int(season), "round": game["rnd"], "date": game["date"], "gid": game["gid"], "player": key, "skey": skey,
        "team": team, "opp": game["opp"], "pos": pos,
        "y": me.fpt if me is not None else 0.0, "played": int(me is not None), "y_min": me.min if me is not None else 0.0,
        # level
        "n_played": len(p), "n_club": len(hist), "avg": float(f.mean()), "avg_l3": last(f, 3), "avg_l5": last(f, 5),
        "avg_l10": last(f, 10), "ewm85": ewm(f[-10:], 0.85), "ewm60": ewm(f[-10:], 0.6), "med_l10": float(np.median(f[-10:])),
        "std": float(f.std(ddof=1)) if len(f) > 1 else np.nan, "last1": f[-1], "last2": f[-2] if len(f) > 1 else np.nan,
        "last3": f[-3] if len(f) > 2 else np.nan, "max_l10": float(f[-10:].max()), "min_l10": float(f[-10:].min()),
        # role
        "mins": float(m.mean()), "mins_l3": last(m, 3), "mins_l5": last(m, 5), "mins_last": m[-1],
        "fpm": float(f.sum() / m.sum()) if m.sum() else 0.0, "fpm_l5": float(f[-5:].sum() / m[-5:].sum()) if m[-5:].sum() else 0.0,
        "start_share": float(np.nanmean(starts)) if np.isfinite(starts).any() else np.nan,
        "start_l3": float(np.nanmean(starts[-3:])) if np.isfinite(starts[-3:]).any() else np.nan,
        "usage": float(np.nanmean(usage)) if np.isfinite(usage).any() else np.nan,
        "usage_l5": float(np.nanmean(usage[-5:])) if np.isfinite(usage[-5:]).any() else np.nan,
        # availability
        "avail": float(flags.mean()), "avail_l3": float(flags[-3:].mean()), "avail_l5": float(flags[-5:].mean()),
        "avail_l10": float(flags[-10:].mean()), "played_last": flags[-1], "streak": streak if flags[-1] else -streak,
        "days_since_played": (game["date"] - p[-1]["date"]).days, "days_rest": (game["date"] - hist[-1]["date"]).days,
        # context
        "home": int(game["home"]), "exp_margin": margin, "win_prob": win, "team_rating": r.get(team, 0.0),
        "opp_rating": r.get(game["opp"], 0.0), "dvp": dvp,
        # last season
        "prev_avg": pv[0] if pv else np.nan, "prev_games": pv[1] if pv else 0, "prev_mins": pv[2] if pv else np.nan,
        # price
        "cr": known[-1][1] if known else np.nan, "cr_age": (game["date"] - known[-1][0]).days if known else np.nan,
        "cr_delta": known[-1][1] - known[-2][1] if len(known) > 1 else 0.0, "cr_first": known[0][1] if known else np.nan,
    }
    return row


def main():
    prev, frames = {}, []
    for season in ["2024", "2025", "2026"]:
        rows, prev_next = build_season(season, prev)
        print(f"  {season}: {len(rows)} rows, {rows['played'].mean():.2f} played, {rows['player'].nunique()} players, "
              f"prev-season known {rows['prev_avg'].notna().mean():.2f}, priced {rows['cr'].notna().mean():.2f}")
        frames.append(rows)
        prev = prev_next
    data = pd.concat(frames, ignore_index=True)
    data.to_csv(DATA / "dataset.csv", index=False)
    print("dataset", data.shape)


if __name__ == "__main__":
    main()
