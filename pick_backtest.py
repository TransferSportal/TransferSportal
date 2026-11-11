"""
Walk-forward test: do the matchup inputs improve the NBA Best 5?

Replays the Best 5 rule (nba_picks.py) day by day over the second half of last
season, using only what was known before each game, in four versions:

  base       the card as it is today
  blowout    adds the model's projected margin (nba_model.py ratings) to the
             blowout rule, which today only fires when ESPN posts a spread
  allowance  adds the opponent's per game allowance to the pick score
  both       blowout and allowance together

A version goes on the card only if it beats base by a clear margin (see ADOPT_Z).
Results go to pick_backtest.json, which nba_picks.py reads when it locks a card.
A version that does not earn its place stays off, and the file says so.

Needs ESPN and numpy, so it runs on the GitHub runner. It never raises and never
blocks the board: on any failure it leaves the last pick_backtest.json alone.
There are no sportsbook lines. Every line is the model's own, as on the card.
"""
import datetime as dt, json, math, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "pick_backtest.json"
CUTOFFS = ["2026-01-15", "2026-02-15", "2026-03-10"]   # ratings are refit on everything before each
ADOPT_Z = 1.0          # paired z of the day by day win difference needed to adopt a version
ADOPT_MIN_GAIN = 0.01  # and at least one point of hit rate
ALLOW_W = 4.0          # score points per 100 percent of allowance edge (0.05 edge is 0.2)
K = 12.0


def pick_days(cands_by_day, nbp, variant):
    """Run the card rule on each day: full-bar picks first, then looser ones to fill a short card."""
    use_blow = variant in ("blowout", "both")
    use_allow = variant in ("allowance", "both")

    def scored(cs, key):
        out = []
        for c in cs:
            sc = c[key]
            if use_blow and c["blow_model"]:
                if c["margin"] >= 15:
                    continue
                sc -= 1.0
            if use_allow:
                sc += ALLOW_W * c["allow_edge"]
            out.append(dict(c, score=sc))
        return out

    out = {}
    for day, cands in cands_by_day.items():
        picks = nbp.choose(scored([c for c in cands if c["full_ok"]], "score"))
        if len(picks) < nbp.N_PICKS:
            picks = nbp.choose(scored([c for c in cands if c["loose_ok"]], "score_loose"), picks)
        out[day] = picks
    return out


def tally(days):
    w = l = 0
    per = {}
    for day, picks in days.items():
        dw = sum(1 for c in picks if c["won"])
        dl = len(picks) - dw
        per[day] = (dw, dl)
        w += dw; l += dl
    return w, l, per


def main():
    # Re-run weekly: a daily rerun would let the verdict flip on noise.
    try:
        age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromtimestamp(OUT.stat().st_mtime, dt.timezone.utc)
        if age < dt.timedelta(days=7):
            print("pick_backtest: result is under a week old, keeping it")
            return
    except FileNotFoundError:
        pass
    import numpy as np
    import nba, nba_model as nm, nba_picks as nbp

    nj = json.loads((HERE / "nba.json").read_text())
    players = [{"id": p["id"], "grp": p["grp"]} for p in nj["players"]]
    with ThreadPoolExecutor(8) as ex:
        logs = list(ex.map(lambda p: nm._safe_log(nba, p["id"]), players))
    grp = {p["id"]: p["grp"] for p in players}
    logs = {p["id"]: r for p, r in zip(players, logs) if len(r) >= 40}
    if len(logs) < 50:
        raise RuntimeError(f"only {len(logs)} players with enough games")

    pri, failed = nm.fetch_games(nba, nm.PRI_START, nm.PRI_END)
    if len(pri) < 800:
        raise RuntimeError(f"last season results thin: {len(pri)}")
    pri = [dict(g, w=1.0) for g in pri]

    # one set of team ratings per cutoff, fit only on games before it
    models = []
    for i, cut in enumerate(CUTOFFS):
        train = [g for g in pri if g["date"] < cut]
        models.append((cut, nm.fit(np, train)))

    def margin_for(date, team, opp, home):
        m = None
        for cut, mod in models:
            if date >= cut:
                m = mod
        if not m:
            return None
        home_t, away_t = (team, opp) if home else (opp, team)
        p = nm.predict(m, away_t, home_t)
        return abs(p[1] - p[0]) if p else None

    # every player game in the window, in date order
    events = []
    for pid, rows in logs.items():
        for i, r in enumerate(rows):
            if r["season"] == nba.PRIOR_END:
                events.append((r["date"], pid, i))
    events.sort()

    ratios = {}          # (opp, grp, stat) -> [sum w*ratio, sum w]
    seen_before = {}     # pid -> index already folded into ratios
    cands_by_day = {}
    base_means = {}

    def allow_factor(opp, g, s):
        a = ratios.get((opp, g, s))
        if not a:
            return 1.0
        return (a[0] + K) / (a[1] + K)

    def fold(pid, upto):
        """Add this player's games before index `upto` that are not yet in the ratios."""
        rows = logs[pid]
        start = seen_before.get(pid, 0)
        for j in range(start, upto):
            if j < 10:
                continue
            hist = rows[:j]
            for s in nba.STATS:
                base = nba.mean([x[s] for x in hist])
                if base and base > 0.4:
                    a = ratios.setdefault((rows[j]["opp"], grp[pid], s), [0.0, 0.0])
                    a[0] += rows[j][s] / base
                    a[1] += 1.0
        seen_before[pid] = max(start, upto)

    by_date = {}
    for d, pid, i in events:
        by_date.setdefault(d, []).append((pid, i))

    for day in sorted(by_date):
        if day < CUTOFFS[0]:
            for pid, i in by_date[day]:
                fold(pid, i + 1)
            continue
        today = []
        for pid, i in by_date[day]:
            rows = logs[pid]
            hist = rows[:i]
            if len(hist) < 25:
                continue
            g_ = rows[i]
            log = hist[-20:]
            min10 = nba.mean([x["min"] for x in hist[-10:]])
            if min10 < 22:
                continue
            win = nba.window_avgs(hist)
            m = margin_for(day, g_["team"], g_["opp"], g_["home"])
            for s in nbp.STATS:
                avg = nba.mean([x[s] for x in hist[-60:]])
                bw = nba.blend(win, s)
                if not bw:
                    continue
                proj = 0.5 * avg + 0.5 * bw
                line = nbp.model_line(avg)
                if line < nbp.MIN_LINE[s]:
                    continue
                v10s = [x[s] for x in hist[-10:]]
                mu = sum(v10s) / len(v10s)
                sd = (sum((x - mu) ** 2 for x in v10s) / max(len(v10s) - 1, 1)) ** 0.5 if s != "fg3" else 0.0
                sd = max(sd, 1.0)
                z0 = (proj - line) / sd
                side = "over" if z0 > 0 else "under"
                z = abs(z0)
                v20s = [x[s] for x in log]
                h10 = nbp.hit_rate(v10s, line); h20 = nbp.hit_rate(v20s, line)
                if side == "under":
                    h10, h20 = 1 - h10, 1 - h20
                actual = g_[s]
                won = actual > line if side == "over" else actual < line
                af = allow_factor(g_["opp"], grp[pid], s)
                edge = (af - 1.0) * (1 if side == "over" else -1)
                blow = m is not None and m >= 10 and min10 >= 26 and side == "over"
                def mk(min_z, min_h):
                    if z < min_z or h10 < min_h:
                        return None
                    return z + 2.0 * (h10 - 0.7) + 1.5 * (h20 - 0.6)
                full, loose = mk(nbp.MIN_Z, nbp.MIN_HIT10), mk(0.3, 0.6)
                if full is None and loose is None:
                    continue
                today.append({
                    "pid": pid, "team": g_["team"], "opp": g_["opp"], "stat": s, "side": side,
                    "score": full if full is not None else 0.0, "score_loose": loose if loose is not None else 0.0,
                    "full_ok": full is not None, "loose_ok": loose is not None,
                    "won": bool(won), "allow_edge": edge, "blow_model": bool(blow), "margin": m or 0.0,
                })
        if today:
            cands_by_day[day] = today
        for pid, i in by_date[day]:
            fold(pid, i + 1)

    per_variant = {}
    for v in ("base", "blowout", "allowance", "both"):
        sel = pick_days(cands_by_day, nbp, v)
        w, l, per = tally(sel)
        per_variant[v] = {"w": w, "l": l, "pct": round(100.0 * w / (w + l), 1) if w + l else None, "per": per}

    base_per = per_variant["base"]["per"]
    out = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
           "window": f"{CUTOFFS[0]} to {nm.PRI_END.isoformat()}", "days": len(base_per),
           "players": len(logs), "variants": {}, "adopt": {"blowout_model": False, "allowance": False}}
    for v, d in per_variant.items():
        entry = {"w": d["w"], "l": d["l"], "pct": d["pct"]}
        if v != "base":
            diffs = []
            for day, (bw, bl) in base_per.items():
                vw, vl = d["per"].get(day, (0, 0))
                n = max(bw + bl, vw + vl) or 1
                diffs.append(vw / max(vw + vl, 1) - bw / max(bw + bl, 1))
            n = len(diffs)
            mean = sum(diffs) / n if n else 0.0
            sd = (sum((x - mean) ** 2 for x in diffs) / max(n - 1, 1)) ** 0.5 if n > 1 else 0.0
            z = mean / (sd / math.sqrt(n)) if sd > 0 and n > 1 else 0.0
            entry.update({"gain_pts": round(100 * mean, 2), "paired_z": round(z, 2)})
        out["variants"][v] = entry
    for v, key in (("blowout", "blowout_model"), ("allowance", "allowance")):
        e = out["variants"][v]
        out["adopt"][key] = bool(e["gain_pts"] / 100.0 >= ADOPT_MIN_GAIN and e["paired_z"] >= ADOPT_Z)
    out["read"] = ("Each version replays the Best 5 rule day by day with only past data. A version goes on the "
                   f"card only if it gains at least {int(ADOPT_MIN_GAIN * 100)} point of hit rate and its day by day "
                   f"paired z is at least {ADOPT_Z}. Lines are the model's own, not sportsbook lines.")
    OUT.write_text(json.dumps(out, indent=1))
    print("pick_backtest:", json.dumps({k: {x: y for x, y in v.items()} for k, v in out["variants"].items()}), out["adopt"])


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                         # noqa
        print("pick_backtest.py: skipped,", e)
        sys.exit(0)
