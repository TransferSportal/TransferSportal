"""
NBA game model, per game allowances and image data for the Matchups slides.

Runs after nba.py. Reads nba.json (top 100 players, injuries) and the public ESPN
scoreboard, and writes two files:

  nba_games.json   projected score, margin, total and win probability for each
                   upcoming game, plus per game allowances by position group
  nba_images.json  team logos and player headshots as small embedded images, so
                   the page shows them even where outside image hosts are blocked

How the game numbers are made:

  * Team scoring ratings come from every final score this season and last,
    fit as: points = league average + team offense + opponent defense + home court.
    Last season counts 30 percent as much as this one, and a ridge penalty pulls
    every team toward average while samples are small.
  * Players the injury flags list as Out take 35 percent of their L10 scoring off
    their team's score, capped at 9 points. That is a rule of thumb, not a fit.
  * Win probability is a normal curve on the projected margin. The spread of that
    curve comes from walking the model forward through last season (see backtest).
  * Per game allowances are what the top 100 players at a position group averaged
    against each team, this season weighted fully and last season at 60 percent,
    pulled toward the league mean while samples are small. They are per player,
    not team totals, because only the top 100 players are sampled.

If ESPN is down or comes back thin, each part is skipped on its own and the last
good file is left alone. This never raises and never blocks the board.
There is no sportsbook price in any number here. A posted line, when ESPN has
one, is shown beside the model and only used to say how often the model covers it.
"""
import base64, datetime as dt, io, json, math, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

HERE = Path(__file__).parent
CUR_START = dt.date(2026, 10, 20)
PRI_START, PRI_END = dt.date(2025, 10, 20), dt.date(2026, 4, 15)
W_PRIOR = 0.30
RIDGE = 6.0
TOTAL_SD = 18.0
DEFAULT_SD = 13.0
OUT_SHARE, OUT_CAP = 0.35, 9.0


def cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


# --------------------------------------------------------------------------- results
def day_games(nba, day):
    try:
        d = nba.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + day.strftime("%Y%m%d"), tries=2)
    except Exception:
        return None
    out = []
    for ev in d.get("events", []):
        try:
            if ev["status"]["type"]["state"] != "post":
                continue
            st = (ev.get("season") or {}).get("type")
            if st not in (None, 2):
                continue
            comp = ev["competitions"][0]["competitors"]
            h = next(c for c in comp if c["homeAway"] == "home")
            a = next(c for c in comp if c["homeAway"] == "away")
            out.append({"id": ev["id"], "date": day.isoformat(),
                        "home": h["team"]["abbreviation"], "away": a["team"]["abbreviation"],
                        "hs": float(h["score"]), "as": float(a["score"])})
        except Exception:
            continue
    return out


def fetch_games(nba, start, end):
    days = []
    d = start
    while d <= end:
        days.append(d)
        d += dt.timedelta(days=1)
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda x: day_games(nba, x), days))
    seen, games, failed = set(), [], 0
    for r in res:
        if r is None:
            failed += 1
            continue
        for g in r:
            if g["id"] not in seen:
                seen.add(g["id"])
                games.append(g)
    return games, failed


# --------------------------------------------------------------------------- ratings
def fit(np, games):
    """games: dicts with home, away, hs, as, w. Returns (mu, hfa, off, deff, n_games)."""
    cnt = {}
    for g in games:
        for t in (g["home"], g["away"]):
            cnt[t] = cnt.get(t, 0) + 1
    teams = sorted(t for t, n in cnt.items() if n >= 3)
    ix = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    rows, y, w = [], [], []
    for g in games:
        if g["home"] not in ix or g["away"] not in ix:
            continue
        for me, op, pts, sign in ((g["home"], g["away"], g["hs"], 1.0), (g["away"], g["home"], g["as"], -1.0)):
            r = np.zeros(2 + 2 * n)
            r[0] = 1.0
            r[1] = sign
            r[2 + ix[me]] = 1.0
            r[2 + n + ix[op]] = 1.0
            rows.append(r); y.append(pts); w.append(g["w"])
    X, y, w = np.array(rows), np.array(y), np.array(w)
    P = np.eye(2 + 2 * n) * RIDGE
    P[0, 0] = P[1, 1] = 1e-6
    A = X.T @ (X * w[:, None]) + P
    b = X.T @ (w * y)
    th = np.linalg.solve(A, b)
    off = {t: float(th[2 + ix[t]]) for t in teams}
    deff = {t: float(th[2 + n + ix[t]]) for t in teams}
    return float(th[0]), float(th[1]), off, deff, {t: cnt[t] for t in teams}


def predict(model, away, home):
    mu, h, off, deff, _ = model
    if away not in off or home not in off:
        return None
    ph = mu + off[home] + deff[away] + h
    pa = mu + off[away] + deff[home] - h
    return pa, ph


def backtest(np, prior, cutoff):
    """Fit on last season before the cutoff, score every game after it."""
    train = [dict(g, w=1.0) for g in prior if g["date"] < cutoff]
    test = [g for g in prior if g["date"] >= cutoff]
    if len(train) < 400 or len(test) < 200:
        return None
    m = fit(np, train)
    err, hit, n, resid = [], 0, 0, []
    for g in test:
        p = predict(m, g["away"], g["home"])
        if not p:
            continue
        pm, am = p[1] - p[0], g["hs"] - g["as"]
        err.append(abs(pm - am)); resid.append(am - pm)
        hit += (pm > 0) == (am > 0)
        n += 1
    if n < 200:
        return None
    mean = sum(resid) / n
    sd = (sum((r - mean) ** 2 for r in resid) / (n - 1)) ** 0.5
    br, base = 0.0, 0.0
    for g in test:
        p = predict(m, g["away"], g["home"])
        if not p:
            continue
        pw = cdf((p[1] - p[0]) / max(sd, 1.0))
        o = 1.0 if g["hs"] > g["as"] else 0.0
        br += (pw - o) ** 2
        base += (0.5 - o) ** 2
    return {"games": n, "trained_on": len(train), "cutoff": cutoff, "margin_mae": round(sum(err) / n, 2),
            "margin_sd": round(sd, 2), "winner_pct": round(100.0 * hit / n, 1),
            "brier": round(br / n, 4), "brier_coin_flip": round(base / n, 4)}


# --------------------------------------------------------------------------- allowances
def allowances(nba, players):
    ids = [p["id"] for p in players]
    with ThreadPoolExecutor(8) as ex:
        logs = list(ex.map(lambda pid: _safe_log(nba, pid), ids))
    grp = {p["id"]: p["grp"] for p in players}
    num = {}      # (opp, grp, stat) -> [sum w*v, sum w]
    lg = {}       # (grp, stat) -> [sum w*v, sum w]
    used = 0
    for pid, rows in zip(ids, logs):
        if len(rows) < 5:
            continue
        used += 1
        for r in rows:
            wt = 1.0 if r["season"] == nba.SEASON_END else 0.6
            for s in ("pts", "reb", "ast", "fg3"):
                v = r.get(s)
                if v is None:
                    continue
                a = num.setdefault((r["opp"], grp[pid], s), [0.0, 0.0, 0])
                a[0] += wt * v; a[1] += wt; a[2] += 1
                b = lg.setdefault((grp[pid], s), [0.0, 0.0])
                b[0] += wt * v; b[1] += wt
    if used < 60:
        return None
    K = 12.0
    league = {g: {s: round(lg[(g, s)][0] / lg[(g, s)][1], 2) for s in ("pts", "reb", "ast", "fg3") if (g, s) in lg} for g in ("G", "F", "C")}
    teams = sorted({k[0] for k in num})
    out = {}
    for t in teams:
        out[t] = {}
        for g in ("G", "F", "C"):
            out[t][g] = {}
            for s in ("pts", "reb", "ast", "fg3"):
                a = num.get((t, g, s))
                if not a or (g, s) not in lg:
                    continue
                mean = lg[(g, s)][0] / lg[(g, s)][1]
                out[t][g][s] = round((a[0] + K * mean) / (a[1] + K), 2)
            out[t][g]["n"] = int(max([num.get((t, g, s), [0, 0, 0])[2] for s in ("pts", "reb", "ast", "fg3")] or [0]))
    return {"teams": out, "league": league, "players_sampled": used}


def _safe_log(nba, pid):
    try:
        return nba.gamelog(pid)
    except Exception:
        return []


# --------------------------------------------------------------------------- games
def build_games(nba, np, nbaj, daily):
    cur, failed_c = fetch_games(nba, CUR_START, dt.datetime.now(nba.ET).date() - dt.timedelta(days=0))
    pri, failed_p = fetch_games(nba, PRI_START, PRI_END)
    if len(pri) < 800 or len(cur) < 20:
        raise RuntimeError(f"results came back thin: {len(cur)} this season, {len(pri)} last season")
    allg = [dict(g, w=1.0) for g in cur] + [dict(g, w=W_PRIOR) for g in pri]
    model = fit(np, allg)
    bt = backtest(np, pri, "2026-01-15")
    sd = DEFAULT_SD if not bt else min(17.0, max(11.5, bt["margin_sd"]))

    by_name = {p["name"]: p for p in nbaj["players"]}
    out_names = set()
    for names in (nbaj.get("injuries_out") or {}).values():
        out_names.update(names)
    for f in (((daily or {}).get("nba") or {}).get("flags") or []):
        if str(f.get("status", "")).lower().startswith("out"):
            out_names.add(f.get("player"))

    def lost(team):
        names, pts = [], 0.0
        for n in sorted(out_names):
            p = by_name.get(n)
            if p and p["team"] == team:
                w10 = (p.get("windows") or {}).get("10") or {}
                pts += w10.get("pts") or 0.0
                names.append(n)
        return names, -min(OUT_CAP, OUT_SHARE * pts)

    sched = nba.upcoming(days=2)
    seen, games = set(), []
    for t, nx in sorted(sched.items()):
        home, away = (t, nx["opp"]) if nx["home"] else (nx["opp"], t)
        key = (nx["date"], home, away)
        if key in seen:
            continue
        seen.add(key)
        p = predict(model, away, home)
        if not p:
            continue
        an, aadj = lost(away)
        hn, hadj = lost(home)
        pa, ph = p[0] + aadj, p[1] + hadj
        margin = ph - pa
        wh = cdf(margin / sd)
        g = {"date": nx["date"], "day": nx["day"], "away": away, "home": home,
             "proj": {"away": round(pa, 1), "home": round(ph, 1)},
             "margin": round(margin, 1), "total": round(pa + ph, 1),
             "win": {"away": round(1 - wh, 3), "home": round(wh, 3)},
             "out": {"away": an, "home": hn}, "adj": {"away": round(aadj, 1) + 0.0, "home": round(hadj, 1) + 0.0},
             "line": None}
        if nx.get("spread") is not None and nx.get("fav") in (home, away):
            fav = nx["fav"]
            fm = margin if fav == home else -margin
            cov = cdf((fm - nx["spread"]) / sd)
            g["line"] = {"fav": fav, "spread": nx["spread"], "fav_covers": round(cov, 3)}
            if nx.get("total") is not None:
                g["line"]["total"] = nx["total"]
                g["line"]["under"] = round(cdf((nx["total"] - g["total"]) / TOTAL_SD), 3)
        elif nx.get("total") is not None:
            g["line"] = {"total": nx["total"], "under": round(cdf((nx["total"] - g["total"]) / TOTAL_SD), 3)}
        games.append(g)
    games.sort(key=lambda g: g["date"])
    mu, h, off, deff, cnt = model
    return {
        "sd": round(sd, 2), "backtest": bt,
        "league_avg": round(mu, 1), "home_court": round(2 * h, 1),
        "teams": {t: {"off": round(off[t], 2), "def": round(deff[t], 2), "n": cnt[t]} for t in off},
        "games": games,
        "results_used": {"this_season": len(cur), "last_season": len(pri), "days_failed": failed_c + failed_p},
    }


# --------------------------------------------------------------------------- images
def grab(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read()


def shrink(raw, box, fmt):
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail(box)
    buf = io.BytesIO()
    if fmt == "webp":
        im.save(buf, "WEBP", quality=68, method=6)
        mime = "image/webp"
    else:
        im.save(buf, "PNG", optimize=True)
        mime = "image/png"
    return "data:" + mime + ";base64," + base64.b64encode(buf.getvalue()).decode()


def build_images(players, teams, old):
    heads = dict((old or {}).get("heads") or {})
    logos = dict((old or {}).get("logos") or {})
    todo_h = [p for p in players if p["id"] not in heads and p.get("headshot")]
    todo_l = [t for t in teams if t not in logos]

    def one_h(p):
        try:
            return p["id"], shrink(grab(p["headshot"]), (260, 180), "webp")
        except Exception:
            return p["id"], None

    def one_l(t):
        try:
            return t, shrink(grab(f"https://a.espncdn.com/i/teamlogos/nba/500/{t.lower()}.png"), (72, 72), "png")
        except Exception:
            return t, None

    with ThreadPoolExecutor(8) as ex:
        for k, v in ex.map(one_h, todo_h):
            if v:
                heads[k] = v
        for k, v in ex.map(one_l, todo_l):
            if v:
                logos[k] = v
    return {"heads": heads, "logos": logos}, len(todo_h), len(todo_l)


# --------------------------------------------------------------------------- main
def main():
    try:
        import numpy as np
        import nba
    except Exception as e:                       # noqa
        print("nba_model.py: skipped,", e)
        return
    nj = HERE / "nba.json"
    if not nj.exists():
        print("nba_model.py: no nba.json, skipped")
        return
    nbaj = json.loads(nj.read_text())
    dj = HERE / "daily.json"
    daily = json.loads(dj.read_text()) if dj.exists() else None
    gj = HERE / "nba_games.json"
    prev = json.loads(gj.read_text()) if gj.exists() else {}
    res = dict(prev)
    try:
        g = build_games(nba, np, nbaj, daily)
        res.update(g)
        print(f"nba_model.py: {len(g['games'])} games projected, backtest {g['backtest']}")
    except Exception as e:                       # noqa
        print("nba_model.py: games skipped,", e)
    try:
        a = allowances(nba, nbaj["players"])
        if a:
            res["allow"] = a
            print(f"nba_model.py: allowances from {a['players_sampled']} players")
        else:
            print("nba_model.py: allowances skipped, too few game logs")
    except Exception as e:                       # noqa
        print("nba_model.py: allowances skipped,", e)
    if res:
        res["generated"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        gj.write_text(json.dumps(res, separators=(",", ":")))
    try:
        ij = HERE / "nba_images.json"
        old = json.loads(ij.read_text()) if ij.exists() else {}
        teams = sorted({p["team"] for p in nbaj["players"]} | set((nbaj.get("defense") or {}).keys()))
        imgs, nh, nl = build_images(nbaj["players"], teams, old)
        if nh or nl or not old:
            ij.write_text(json.dumps(imgs, separators=(",", ":")))
        print(f"nba_model.py: images, {len(imgs['heads'])} headshots ({nh} new), {len(imgs['logos'])} logos ({nl} new)")
    except Exception as e:                       # noqa
        print("nba_model.py: images skipped,", e)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                       # noqa
        print("nba_model.py: skipped,", e)
    sys.exit(0)
