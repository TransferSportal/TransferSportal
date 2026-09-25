#!/usr/bin/env python3
"""
Grade the prior-season anchor in the REAL model, not a simplified stand-in.

backtest_earlyweeks.py ranked on the touchdown rate alone and found the anchor
worth +8.3 points in weeks 1-4. That is the right mechanism but the wrong model:
the live board scores five features, and the hit rate is only 32% of it. This
runs the actual scoring weights, with the actual shrinkage, over the actual
features, so the number means something.

  positional -- shrink a short sample toward the position average (ships today)
  prior      -- shrink it toward what that player did last season

Both graded walking forward. Weeks 1-4 reported separately because that is the
window the board is live in and the window MIN_WEEK=4 has always excluded.
"""
import numpy as np, pandas as pd, sys
from backtest_features import season_frame, build_features, load, norm

W = dict(hit=.32, rz10=.16, rz5=.16, yds=.20, itt=.16)
SHRINK_K = 4.0
PRIOR_FULL = 8.0


def prior_from(season):
    """Per-player, per-game rates from a completed season, plus games played."""
    f = build_features(season_frame(season))
    g = f.groupby("player_id")
    n = g.week.nunique()
    return {
        "hit":  g.any_td.mean().to_dict(),
        "rz10": g.rz10.mean().to_dict(),
        "rz5":  g.rz5.mean().to_dict(),
        "yds":  g.yds.mean().to_dict(),
        "n":    n.to_dict(),
    }


def scored(df, prior, mode):
    """Apply shrinkage the way update.py does, then the live scoring weights."""
    d = df[df.itt.notna()].copy()
    pos_mean = {c: d.groupby("position")[src].mean().to_dict()
                for c, src in (("hit", "hit"), ("rz10", "rz10_pg"),
                               ("rz5", "rz5_pg"), ("yds", "yds_pg"))}
    g = d.games_so_far.values.astype(float)
    w = SHRINK_K / (SHRINK_K + np.maximum(g, 0))
    pid = d.player_id.values
    posv = d.position.values

    def anchored(cname, col):
        pm = np.array([pos_mean[cname].get(p, 0.0) for p in posv])
        if mode == "positional":
            return pm
        pv = np.array([prior[cname].get(i, np.nan) for i in pid])
        nn = np.array([prior["n"].get(i, 0) for i in pid], dtype=float)
        t = np.clip(nn / PRIOR_FULL, 0, 1)
        out = np.where(np.isnan(pv), pm, t * np.nan_to_num(pv) + (1 - t) * pm)
        return out

    raw = {"hit": d.hit.fillna(0).values, "rz10": d.rz10_pg.fillna(0).values,
           "rz5": d.rz5_pg.fillna(0).values, "yds": d.yds_pg.fillna(0).values}
    eff = {c: (1 - w) * raw[c] + w * anchored(c, c) for c in raw}

    d["s"] = (W["hit"] * np.clip(eff["hit"], 0, 1)
              + W["rz10"] * np.minimum(eff["rz10"] / 2.5, 1)
              + W["rz5"] * np.minimum(eff["rz5"] / 1.2, 1)
              + W["yds"] * np.minimum(eff["yds"] / 90.0, 1)
              + W["itt"] * np.clip((d.itt.astype(float).values - 15) / 13.0, 0, 1))
    return d


def hit_rate(d, weeks, n=12):
    hits = tot = 0
    for wk, x in d[d.week.isin(weeks)].groupby("week"):
        if len(x) < 40:
            continue
        top = x.nlargest(n, "s")
        hits += int(top.any_td.sum()); tot += len(top)
    return hits, tot


if __name__ == "__main__":
    frames, priors = {}, {}
    for s in (2024, 2025):
        print(f"loading {s} ...", flush=True)
        frames[s] = build_features(season_frame(s))
        print(f"loading {s-1} for the prior ...", flush=True)
        priors[s] = prior_from(s - 1)

    windows = (("weeks 1-4", list(range(1, 5))), ("weeks 5+", list(range(5, 19))),
               ("full season", list(range(1, 19))))
    res = {}
    for mode in ("positional", "prior"):
        for label, wks in windows:
            h = t = 0
            for s in (2024, 2025):
                d = scored(frames[s], priors[s], mode)
                a, b = hit_rate(d, wks)
                h += a; t += b
            res[(mode, label)] = (h, t)

    print(f"\n{'window':<14}{'anchor':<13}{'top-12':>9}{'picks':>8}{'change':>22}")
    for label, _ in windows:
        for mode in ("positional", "prior"):
            h, t = res[(mode, label)]
            tag = ""
            if mode == "prior":
                b0 = res[("positional", label)]
                d_ = (h / t - b0[0] / b0[1]) * 100
                se = (0.25 / t) ** 0.5 * 100
                tag = (f"{d_:+.1f} pts, se {se:.1f}  "
                       + ("REAL" if abs(d_) > 2 * se else
                          ("worth a look" if abs(d_) > se else "noise")))
            print(f"{label:<14}{mode:<13}{h/t*100:>8.1f}%{t:>8}{tag:>22}")
        print()
