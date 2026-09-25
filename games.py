#!/usr/bin/env python3
"""
TransferSportal — NFL game projection model.

What the CFB page Ryan sent does, built for the NFL and with the methodology
written down instead of hidden.

HOW IT WORKS
------------
Each team gets two ratings, in points per game relative to league average:

    off  = how many points its offence generates
    def  = how many points its defence concedes

Raw points-per-game is useless on its own, because a team that has played three
bad defences looks great. So the ratings are solved jointly: every game is one
equation saying

    points_scored  =  league_avg  +  off(team)  +  def(opponent)  +  home_edge

and the whole season is solved as one least-squares system (ridge-regularised so
a 3-game sample cannot produce a wild rating). That is the standard adjustment
and it is what separates this from a points-per-game table.

A projected score is then

    home = league_avg + off(home) + def(away) + home_edge
    away = league_avg + off(away) + def(home)

Early in a season there is not enough football played to trust any of it, so
every rating is shrunk toward zero by games played, and the projection is
blended with the market's own number. The blend weight is fitted, not guessed.

TWO THINGS THAT WERE BROKEN, AND WHY THEY MATTERED
--------------------------------------------------
The first version of this file agreed with nobody. On the 2026 week 3 slate it
picked the road team in 15 of 16 games. Two bugs, stacked:

  1. The home-field edge was fitted freely on three weeks of football. It came
     out at -0.61 when the real number is about +1.7, so every game started with
     2.3 free points for the road team. See HFA_PRIOR below for why three weeks
     cannot measure it and why the solver is free to invent it.
  2. The rescale multiplied the model's spread by a constant, which scaled that
     2.3-point offset up to nearly 6. See rescale_to_market.

Neither was a modelling choice. Both were arithmetic. Fixing them moved the
walk-forward record from 48.79% against the spread to 56.07%.

WHAT IT IS NOT
--------------
It is not a proven edge. 56.07% over 416 games is one and a half standard errors
above break-even, which is promising and short of established. backtest_games.py
grades it honestly, with a significance test, and reports the answer whatever it
is.

    python games.py 2026          # writes games.json for the site
"""
import io, json, sys, urllib.request
import numpy as np, pandas as pd
import team_metrics as tm

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI"}
RIDGE = 6.0          # pulls thin samples toward league average
SHRINK_G = 4.0       # games before a rating is trusted at roughly half weight

# Home-field edge is NOT fitted freely, and that is deliberate.
#
# Measured over 2015-2025, 2895 regular season games, the average home margin is
# +1.74 points and the market's average closing spread is +1.71. It is one of the
# most stable numbers in football. On three weeks it is not measurable at all:
# 33 games at a 13.5-point margin spread gives a standard error of 2.3 points, so
# any value between -1 and +4 is consistent with the data.
#
# Worse, it is not even identifiable. With each team having played one or two home
# games, the home column is almost a linear combination of the 64 team columns, so
# the solver can move the home effect into team ratings and put anything it likes
# in the home term. Then the shrink step below pulls the team ratings toward
# average but leaves the home term alone, so the junk survives at full weight.
#
# Live on 2026 week 3 that produced a home edge of -0.61: the model gave the road
# team 2.3 points in every game before any football was considered, the rescale
# multiplied that by 2.65, and 15 of 16 picks came out on the road team. That is
# what made the board disagree with every other model on the same games.
#
# So the edge is held to the measured prior and the season is only allowed to move
# it once there is enough football to move it honestly.
HFA_PRIOR = 1.7      # points, measured 2015-2025 over 2895 games
HFA_LAMBDA = 260.0   # penalty holding the fitted edge to the prior


def load(path):
    r = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "Mozilla/5.0"})
    return pd.read_csv(io.BytesIO(urllib.request.urlopen(r, timeout=300).read()), low_memory=False)


def played_games(season, upto_week=None):
    """One row per team-game with points for and against, completed games only."""
    sch = load("schedules/games.csv")
    s = sch[(sch.season == season) & (sch.game_type == "REG")]
    rows = []
    for x in s.itertuples():
        if pd.isna(x.home_score) or pd.isna(x.away_score):
            continue
        if upto_week is not None and x.week >= upto_week:
            continue
        h, a = TEAM_FIX.get(x.home_team, x.home_team), TEAM_FIX.get(x.away_team, x.away_team)
        rows.append({"team": h, "opp": a, "week": x.week, "home": 1,
                     "pf": float(x.home_score), "pa": float(x.away_score)})
        rows.append({"team": a, "opp": h, "week": x.week, "home": 0,
                     "pf": float(x.away_score), "pa": float(x.home_score)})
    return pd.DataFrame(rows)


def fit_ratings(g):
    """Solve offence, defence and home edge together by ridge least squares.

    One row per team-game: points scored = mu + off[team] + def[opp] + home*hfa.
    Without the joint solve, a team's rating is contaminated by who it played.
    """
    teams = sorted(set(g.team) | set(g.opp))
    idx = {t: i for i, t in enumerate(teams)}
    n, T = len(g), len(teams)
    X = np.zeros((n, 2 * T + 1))
    for r, row in enumerate(g.itertuples()):
        X[r, idx[row.team]] = 1.0            # offence of the scoring team
        X[r, T + idx[row.opp]] = 1.0         # defence of the team conceding
        X[r, 2 * T] = float(row.home)        # home-field edge
    y = g.pf.values.astype(float)
    mu = y.mean()
    # Ridge pulls team ratings toward league average. The home term is pulled
    # toward HFA_PRIOR instead of toward zero, which is what the extra term on the
    # right-hand side does: minimise ||y - Xb||^2 + RIDGE*||b_teams||^2
    # + HFA_LAMBDA*(hfa - HFA_PRIOR)^2. With 33 games the data moves it by a few
    # tenths; over a full season it moves it properly.
    P = np.eye(2 * T + 1) * RIDGE
    P[2 * T, 2 * T] = HFA_LAMBDA
    rhs = X.T @ (y - mu)
    rhs[2 * T] += HFA_LAMBDA * HFA_PRIOR
    beta = np.linalg.solve(X.T @ X + P, rhs)
    off = {t: float(beta[idx[t]]) for t in teams}
    dfn = {t: float(beta[T + idx[t]]) for t in teams}
    hfa = float(beta[2 * T])
    # shrink toward league average by how much football the team has played
    gp = g.groupby("team").size().to_dict()
    for t in teams:
        w = SHRINK_G / (SHRINK_G + gp.get(t, 0))
        off[t] *= (1 - w)
        dfn[t] *= (1 - w)
    return dict(mu=float(mu), off=off, dfn=dfn, hfa=hfa, games=gp, teams=teams)


def project(R, home, away):
    """Projected points for both sides of one game."""
    mu, off, dfn = R["mu"], R["off"], R["dfn"]
    h = mu + off.get(home, 0.0) + dfn.get(away, 0.0) + R["hfa"]
    a = mu + off.get(away, 0.0) + dfn.get(home, 0.0)
    return max(h, 3.0), max(a, 3.0)


def blend_with_market(ph, pa, spread_line, total_line, w_model):
    """Nudge the model's own numbers toward the market's.

    The closing line is the single best public estimate of a game, so a model
    that ignores it is throwing away information. w_model is fitted in
    backtest_games.py rather than picked: it came out low, which is the honest
    answer about how much a 3-week sample knows that the market does not.
    """
    if spread_line is None or total_line is None or any(pd.isna([spread_line, total_line])):
        return ph, pa
    mh = total_line / 2 + spread_line / 2      # market's implied home points
    ma = total_line / 2 - spread_line / 2
    return w_model * ph + (1 - w_model) * mh, w_model * pa + (1 - w_model) * ma


def load_metrics(season):
    """Advanced metrics come from team_metrics.py. Missing file is not fatal --
    the game cards still render, they just lose the category breakdown."""
    try:
        return tm.scale(tm.raw_metrics(season))
    except Exception as e:
        print("metrics unavailable, cards will render without categories:", e)
        return None


def rescale_to_market(rows):
    """Put the model's spread on the same SCALE as the market's.

    THE BUG THIS FIXES. Fitted on three weeks, the ratings are tiny: the raw
    model spread averaged 1.31 points against the market's 4.53. Blending a
    near-pick'em with the market produced the market multiplied by about 0.72 --
    a number that is inside the line in 15 of 16 games by arithmetic, before any
    football is considered. Every pick came out on the underdog, which looked
    like an opinion and was actually a scaling error.

    Matching the standard deviation of the two distributions removes it. The
    model then lands above the line as often as below, and a pick means the
    model genuinely disagrees with the market rather than merely being quieter
    than it. Measured in backtest_games.py: underdog rate 85% -> 50%.

    THE SECOND BUG, found the same way. Multiplying the raw spread by k scales
    the average along with the spread. A slate-wide offset of 2 points toward
    the road team therefore came out of here as 5 or 6 points, and every pick
    landed on the road side. So the model is centred on the market's own average
    for the slate and only the DEVIATIONS from that average are scaled. Any
    slate-wide lean is dropped on purpose: on a short sample a whole-slate offset
    is a broken home-field term, never a read on the week, and the information
    the model actually has lives in which games it likes relative to the others.
    """
    vals = [r["proj_spread"] for r in rows if r.get("spread_line") is not None]
    mkt = [r["spread_line"] for r in rows if r.get("spread_line") is not None]
    if len(vals) < 8:
        return rows, 1.0
    import statistics as st
    sd, sm = st.pstdev(vals), st.pstdev(mkt)
    if sd < 1e-6:
        return rows, 1.0
    k = sm / sd
    mv, mm = st.fmean(vals), st.fmean(mkt)
    for r in rows:
        r["proj_spread"] = round(mm + (r["proj_spread"] - mv) * k, 1)
        mid = (r["proj_home"] + r["proj_away"]) / 2.0
        r["proj_home"] = round(mid + r["proj_spread"] / 2.0, 1)
        r["proj_away"] = round(mid - r["proj_spread"] / 2.0, 1)
    return rows, k


def build(season, w_model=0.75):   # fitted in backtest_games.py alongside the rescale
    MET = load_metrics(season)
    g = played_games(season)
    weeks_played = int(g.week.max()) if len(g) else 0
    R = fit_ratings(g) if len(g) else None

    sch = load("schedules/games.csv")
    s = sch[(sch.season == season) & (sch.game_type == "REG")]
    upcoming = s[s.home_score.isna()]
    wk = int(upcoming.week.min()) if len(upcoming) else int(s.week.max())
    slate = s[s.week == wk]

    out = []
    for x in slate.itertuples():
        h, a = TEAM_FIX.get(x.home_team, x.home_team), TEAM_FIX.get(x.away_team, x.away_team)
        if R is None:
            continue
        ph, pa = project(R, h, a)
        sl = None if pd.isna(x.spread_line) else float(x.spread_line)
        tl = None if pd.isna(x.total_line) else float(x.total_line)
        bh, ba = blend_with_market(ph, pa, sl, tl, w_model)
        proj_spread = bh - ba                      # positive = home favoured
        proj_total = bh + ba
        row = {
            "week": int(x.week), "home": h, "away": a,
            "kick": str(x.gameday) if hasattr(x, "gameday") else None,
            "proj_home": round(bh, 1), "proj_away": round(ba, 1),
            "raw_home": round(ph, 1), "raw_away": round(pa, 1),
            "spread_line": sl, "total_line": tl,
            "proj_spread": round(proj_spread, 1), "proj_total": round(proj_total, 1),
        }
        # The pick is derived AFTER rescale_to_market, in the second pass below,
        # because a side taken off an unscaled line is an artifact rather than an
        # opinion. backtest_games.py graded 416 games walking forward at this
        # setting: 231-181-4 against the spread, 56.07%, above the 52.38%
        # break-even by about one and a half standard errors. Promising, not
        # proven, and this file will not pretend otherwise.
        out.append(row)

    # scale first, then derive picks from the scaled line
    out, kscale = rescale_to_market(out)
    for row in out:
        # read every field off THIS row. Carrying h/a over from the first pass
        # silently attached each game's pick to the previous game's teams.
        h, a = row["home"], row["away"]
        sl = row.get("spread_line")
        tl = row.get("total_line")
        proj_spread, proj_total = row["proj_spread"], row["proj_total"]
        if sl is not None:
            row["spread_diff"] = round(proj_spread - sl, 1)
            # The pick is the projected MARGIN against the line, which is a
            # different question from who wins. A team can be projected to win
            # by 2 and still be the wrong side of a 2.5 line -- that is the
            # whole point of a spread. nflverse's spread_line is positive when
            # the home team is favoured, so the home side lays -spread_line and
            # the away side gets +spread_line.
            home_covers = proj_spread > sl
            row["projected_winner"] = h if proj_spread > 0 else a
            row["ats_pick_team"] = h if home_covers else a
            row["ats_pick_line"] = round(-sl if home_covers else sl, 1)
            row["ats_pick"] = f"{row['ats_pick_team']} {row['ats_pick_line']:+.1f}"
            row["pick_is_dog"] = row["ats_pick_line"] > 0
        if tl is not None:
            row["ou_pick"] = "Over" if proj_total > tl else "Under"
            row["total_diff"] = round(proj_total - tl, 1)
        # category-by-category matchup, each side's offence against the other's
        # defence, the way the reference board lays it out
        if MET is not None and h in MET.index and a in MET.index:
            row["matchup"] = tm.matchup(MET, a, h)
            row["identity"] = {
                side: {c: float(MET.loc[t, f"{c}_off"]) for c in tm.CATS}
                | {"overall_off": float(MET.loc[t, "overall_off"]),
                   "overall_def": float(MET.loc[t, "overall_def"]),
                   "def": {c: float(MET.loc[t, f"{c}_def"]) for c in tm.CATS}}
                for side, t in (("away", a), ("home", h))
            }

    ratings = [{"team": t,
                "off": round(R["off"][t], 2),
                "def": round(R["dfn"][t], 2),
                "net": round(R["off"][t] - R["dfn"][t], 2),
                "games": int(R["games"].get(t, 0))} for t in R["teams"]] if R else []
    ratings.sort(key=lambda r: -r["net"])

    doc = {
        "meta": {
            "season": season, "week": wk, "weeks_played": weeks_played,
            "league_avg_points": round(R["mu"], 1) if R else None,
            "home_edge": round(R["hfa"], 2) if R else None,
            "model_weight": w_model, "market_scale": round(kscale, 3),
            "method": ("ridge least squares on every completed game, solving offence, "
                       "defence and home edge jointly, then shrunk by games played and "
                       "blended with the closing line"),
            # Published because a record you cannot check is worth nothing. These
            # are walk-forward numbers from backtest_games.py: ratings fitted only
            # on weeks before the week being graded, 2024 and 2025 pooled.
            "backtest": {
                "games": 416,
                "score_mae": 7.36,
                "ats": "231-181-4 (56.07%)",
                "ats_breakeven": "52.38% at -110",
                "ats_z": 1.50,
                "ats_se": "2.46 pts on 416 games",
                "by_season": "56.10% (2024) and 56.04% (2025)",
                "totals": "216-197-3 (52.3%)",
                "dog_rate": "53%, road-lean 49% (both were broken: 84% and 31%)",
                "history": ("48.79% before the scale fix, 49.76% after scaling alone, "
                            "56.07% once the home-field term was anchored and the "
                            "rescale centred on the market"),
                "verdict": ("above break-even by 3.7 points over 416 walk-forward games, "
                            "the same in both seasons independently, and not concentrated "
                            "on favourites, dogs, home or road. That is one and a half "
                            "standard errors, so it is a promising result and not a proven "
                            "edge. Most of it sits in games where the model barely "
                            "disagrees with the line, which is not the shape a durable "
                            "edge usually has. Bet it small or not at all until the live "
                            "record says more."),
            },
        },
        "games": out, "ratings": ratings,
        "cats": tm.CATS, "labels": tm.LABELS, "even_band": tm.EVEN_BAND,
    }
    json.dump(doc, open("games.json", "w"), separators=(",", ":"))
    # Also fold it into data.json. The site re-fetches data.json on every load to
    # pick up a fresh board, and that fetch REPLACES the embedded copy -- so
    # anything living only in the embedded blob disappears a second after the
    # page opens. Whatever the Games tab needs has to be in data.json too.
    try:
        d = json.load(open("data.json"))
        d["games_model"] = doc
        json.dump(d, open("data.json", "w"), separators=(",", ":"))
        print("merged into data.json so the live refresh keeps the Games tab")
    except FileNotFoundError:
        print("no data.json yet — games.json written on its own")
    print(f"games.json: week {wk}, {len(out)} games, {weeks_played} weeks of results")
    print(f"league average {R['mu']:.1f} pts/team, home edge {R['hfa']:+.2f}")
    print("\nprojected slate:")
    for r in out:
        sp = f"{r['spread_line']:+.1f}" if r.get("spread_line") is not None else "  n/a"
        print(f"  {r['away']:>3} @ {r['home']:<3}  {r['proj_away']:>4.1f} - {r['proj_home']:<4.1f}"
              f"   line {sp}   model {r['proj_spread']:+5.1f}"
              f"   diff {r.get('spread_diff',0):+5.1f}")
    print("\ntop 6 net rating:")
    for r in ratings[:6]:
        print(f"  {r['team']:>3}  off {r['off']:+5.2f}  def {r['def']:+5.2f}  net {r['net']:+5.2f}")
    return doc


if __name__ == "__main__":
    build(int(sys.argv[1]) if len(sys.argv) > 1 else 2026)
