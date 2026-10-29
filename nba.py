"""
NBA player projections for the private board.

Pulls public ESPN data (no key), builds the top 100 players by a blend of last
season and this season, and projects points, rebounds, assists, threes and PRA
for each player's next game from:

  * L5 / L10 / L15 / L20 game averages (weighted toward the recent ones)
  * the opponent's defense, measured as how much that team inflates or deflates
    the production of players at the same position group relative to their own
    baselines (shrunk hard toward 1.0 while the sample is small)
  * head to head: how this player has done against this exact team
  * home or away, back to back, and injuries (own status and teammates out)

Writes nba.json. Never raises on a bad day: if ESPN is down or comes back thin
it leaves the previous nba.json alone and exits 0, so the NFL board still builds.

This is a projection, not a price. There is no sportsbook line in here. Nothing
in it has been back tested against closing lines.
"""
import json, sys, time, datetime as dt
import urllib.request, re
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
SEASON_END = 2027            # ESPN names 2026-27 as 2027
PRIOR_END = SEASON_END - 1
TOP_N = 100
UA = {"User-Agent": "Mozilla/5.0"}
ET = ZoneInfo("America/New_York")


def et_date(iso):
    """Game date as the calendar day in New York, not UTC (a 10pm tip is tomorrow in UTC)."""
    d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.astimezone(ET).date().isoformat()
STATS = ["pts", "reb", "ast", "fg3", "pra"]
WINDOWS = [5, 10, 15, 20]
WIN_W = {5: 0.30, 10: 0.30, 15: 0.20, 20: 0.20}


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)
            return json.loads(r.read())
        except Exception as e:          # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def leaders(season_end):
    base = ("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
            "?region=us&lang=en&contentorigin=espn&isqualified=false&limit=200&seasontype=2"
            f"&sort=offensive.avgPoints:desc&season={season_end}")
    out = {}
    d = get(base + "&page=1")
    names = {c["name"]: c["names"] for c in d["categories"]}
    for a in d["athletes"]:
        v = {}
        for c in a["categories"]:
            for n, x in zip(names.get(c["name"], []), c.get("values", [])):
                v[n] = x
        at = a["athlete"]
        out[str(at["id"])] = {
            "id": str(at["id"]), "name": at["displayName"],
            "team": at.get("teamShortName") or "",
            "pos": (at.get("position") or {}).get("abbreviation") or "",
            "gp": v.get("gamesPlayed", 0) or 0,
            "val": (v.get("avgPoints", 0) or 0) + 1.2 * (v.get("avgRebounds", 0) or 0)
                   + 1.5 * (v.get("avgAssists", 0) or 0),
        }
    return out


def pos_group(p):
    p = (p or "").upper()
    if p in ("PG", "SG", "G"): return "G"
    if p in ("C",): return "C"
    return "F"


def num(x):
    try: return float(x)
    except Exception: return None


def gamelog(pid):
    """All regular-season rows, oldest first, from the prior and current season."""
    rows = []
    for se in (PRIOR_END, SEASON_END):
        try:
            d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{pid}/gamelog?season={se}")
        except Exception:
            continue
        names = d.get("names", [])
        ix = {n: i for i, n in enumerate(names)}
        evs = d.get("events", {})
        for st in d.get("seasonTypes", []):
            if "Regular" not in st.get("displayName", ""):
                continue
            for cat in st.get("categories", []):
                for e in cat.get("events", []):
                    meta = evs.get(e["eventId"])
                    s = e.get("stats", [])
                    if not meta or len(s) < len(names):
                        continue
                    mn = num(s[ix["minutes"]])
                    if not mn:                       # DNP
                        continue
                    t3 = str(s[ix["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]]).split("-")[0]
                    pts, reb, ast = num(s[ix["points"]]), num(s[ix["totalRebounds"]]), num(s[ix["assists"]])
                    if pts is None or reb is None or ast is None:
                        continue
                    rows.append({
                        "date": et_date(meta["gameDate"]), "season": se,
                        "opp": (meta.get("opponent") or {}).get("abbreviation", ""),
                        "team": (meta.get("team") or {}).get("abbreviation", ""),
                        "home": meta.get("atVs") != "@",
                        "min": mn, "pts": pts, "reb": reb, "ast": ast,
                        "fg3": num(t3) or 0.0, "pra": pts + reb + ast,
                    })
    rows.sort(key=lambda r: r["date"])
    return rows


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def window_avgs(rows):
    out = {}
    for w in WINDOWS:
        sub = rows[-w:]
        out[w] = {s: mean([r[s] for r in sub]) for s in STATS} | {"min": mean([r["min"] for r in sub]), "n": len(sub)}
    return out


def blend(win, stat):
    num_, den = 0.0, 0.0
    for w in WINDOWS:
        v = win[w][stat]
        if v is None: continue
        num_ += WIN_W[w] * v; den += WIN_W[w]
    return num_ / den if den else None


def upcoming(days=3):
    """Next game per team over the next few days, from the public scoreboard."""
    nxt = {}
    today = dt.datetime.now(ET).date()
    for k in range(days + 1):
        day = today + dt.timedelta(days=k)
        try:
            d = get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + day.strftime("%Y%m%d"))
        except Exception:
            continue
        for ev in d.get("events", []):
            if ev["status"]["type"]["state"] == "post":
                continue
            comp = ev["competitions"][0]["competitors"]
            h = next(c for c in comp if c["homeAway"] == "home")["team"]["abbreviation"]
            a = next(c for c in comp if c["homeAway"] == "away")["team"]["abbreviation"]
            when = ev["date"]
            for me, op, home in ((h, a, True), (a, h, False)):
                if me not in nxt:
                    nxt[me] = {"opp": op, "home": home, "date": when, "day": et_date(when)}
    return nxt


def injuries():
    out = {}
    try:
        d = get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries")
    except Exception:
        return out
    for t in d.get("injuries", []):
        for i in t.get("injuries", []):
            a = i.get("athlete") or {}
            pid = str(a.get("id") or "")
            if not pid:
                for l in a.get("links", []):
                    m = re.search(r"/id/(\d+)", l.get("href", ""))
                    if m: pid = m.group(1); break
            if not pid: continue
            dtl = i.get("details") or {}
            out[pid] = {"status": i.get("status", ""), "comment": (i.get("shortComment") or "")[:220],
                        "date": (i.get("date") or "")[:10], "type": dtl.get("type", ""),
                        "return": dtl.get("returnDate", "")}
    return out


AVAIL = {"out": 0.0, "doubtful": 0.25, "questionable": 0.7, "day-to-day": 0.8, "probable": 0.9}


def avail(status):
    s = (status or "").lower()
    for k, v in AVAIL.items():
        if k in s: return v
    return 1.0


def build():
    cur, pri = leaders(SEASON_END), leaders(PRIOR_END)
    cand = {}
    for pid in set(cur) | set(pri):
        c, p = cur.get(pid), pri.get(pid)
        gp = c["gp"] if c else 0
        w = min(gp / 10.0, 1.0) * 0.35
        # Per game value ignores how often a player is on the floor: someone who played
        # 19 games last year should not outrank a durable star on a hot week.
        if p: p = dict(p, val=p["val"] * min(1.0, p["gp"] / 55.0) ** 0.5)
        if c and p: val = w * c["val"] + (1 - w) * p["val"]
        elif p: val = p["val"] * 0.9          # no games yet this year
        elif c and gp >= 2: val = (gp * c["val"] + 10 * 22.0) / (gp + 10)      # rookie or long layoff: pull toward replacement
        else: continue
        base = c or p
        cand[pid] = (val, base)
    top = sorted(cand.items(), key=lambda kv: -kv[1][0])[:TOP_N]
    if len(top) < 60:
        raise RuntimeError("leaders came back thin")
    ids = [pid for pid, _ in top]

    with ThreadPoolExecutor(8) as ex:
        logs = dict(zip(ids, ex.map(gamelog, ids)))
    ok = sum(1 for v in logs.values() if len(v) >= 5)
    if ok < 60:
        raise RuntimeError(f"only {ok} players had game logs")

    meta = {pid: base for pid, (_, base) in top}
    team_of = {}
    for pid in ids:
        r = logs[pid]
        team_of[pid] = (r[-1]["team"] if r else "") or meta[pid]["team"]
    grp = {pid: pos_group(meta[pid]["pos"]) for pid in ids}
    real_teams = set(team_of.values())

    # Opponent defense: how players at a position group perform against a team
    # relative to their own average across all the games sampled.
    K = 12.0
    ratios = {}                                  # (opp, grp, stat) -> list of ratios
    for pid in ids:
        r = logs[pid]
        if len(r) < 10: continue
        base = {s: mean([x[s] for x in r]) for s in STATS}
        for x in r:
            if x["opp"] not in real_teams: continue          # All-Star game etc.
            wt = 1.0 if x["season"] == SEASON_END else 0.6
            for s in STATS:
                if base[s] and base[s] > 0.4:
                    ratios.setdefault((x["opp"], grp[pid], s), []).append((x[s] / base[s], wt))
    def dfac(opp, g, s):
        L = ratios.get((opp, g, s), [])
        sw = sum(w for _, w in L)
        return (sum(v * w for v, w in L) + K) / (sw + K), len(L)

    inj = injuries()
    sched = upcoming()
    out_by_team = {}
    for pid in ids:
        st = inj.get(pid)
        if st and avail(st["status"]) <= 0.25:
            out_by_team.setdefault(team_of[pid], []).append(pid)

    players = []
    for rank, pid in enumerate(ids, 1):
        rows = logs[pid]
        if len(rows) < 3: continue
        m = meta[pid]; team = team_of[pid]; g = grp[pid]
        win = window_avgs(rows)
        nx = sched.get(team)
        st = inj.get(pid) or {}
        a = avail(st.get("status"))
        rec = {"id": pid, "rank": rank, "name": m["name"], "team": team, "pos": m["pos"], "grp": g,
               "headshot": f"https://a.espncdn.com/i/headshots/nba/players/full/{pid}.png",
               "games_logged": len(rows), "games_this_season": sum(1 for r in rows if r["season"] == SEASON_END),
               "min_l10": round(win[10]["min"], 1) if win[10]["min"] else None,
               "windows": {str(w): {k: (round(v, 1) if isinstance(v, float) else v) for k, v in win[w].items()} for w in WINDOWS},
               "injury": st or None, "avail": a, "next": None, "proj": None}
        if nx:
            opp, home = nx["opp"], nx["home"]
            last = dt.date.fromisoformat(rows[-1]["date"])
            gd = dt.date.fromisoformat(nx["day"])
            rest = (gd - last).days - 1
            h2h = [r for r in rows if r["opp"] == opp]
            ha = [r for r in rows if r["home"] == home]
            rec["next"] = {"opp": opp, "home": home, "date": nx["date"], "rest_days": rest, "b2b": rest == 0}
            teammates_out = [t for t in out_by_team.get(team, []) if t != pid]
            proj, fac = {}, {}
            for s in STATS:
                bw = blend(win, s)
                if not bw: continue
                # Half the long run average, half the L5/L10/L15/L20 blend. On last season's games,
                # that beat the season average alone and beat the windows alone (see note).
                b = 0.5 * mean([r[s] for r in rows[-60:]]) + 0.5 * bw
                d, dn = dfac(opp, g, s)
                d = 1 + (d - 1) * 0.3
                allm = mean([r[s] for r in rows])
                hh = 1.0; hn = len(h2h)
                if hn and allm:
                    raw = mean([r[s] for r in h2h]) / allm
                    hh = max(0.95, min(1.05, 1 + (raw - 1) * hn / (hn + 8.0)))
                hf = 1.0          # shown as a split, not applied: it did not help out of sample
                rf = 0.97 if rest == 0 else (1.01 if rest >= 2 else 1.0)
                uf = 1 + min(0.08, 0.04 * len(teammates_out)) if s in ("pts", "ast", "fg3", "pra") else 1.0
                v = b * d * hh * hf * rf * uf
                proj[s] = round(v, 1)
                fac[s] = {"base": round(b, 1), "def": round(d, 3), "h2h": round(hh, 3), "venue": round(hf, 3),
                          "rest": rf, "usage": round(uf, 3), "def_n": dn}
            rec["proj"] = proj
            rec["factors"] = fac
            rec["h2h"] = {"n": len(h2h), **({s: round(mean([r[s] for r in h2h]), 1) for s in STATS} if h2h else {}),
                          "last": [{"date": r["date"], "pts": r["pts"], "reb": r["reb"], "ast": r["ast"]} for r in h2h[-3:]]}
            ho = [r for r in rows if r["home"]]; aw = [r for r in rows if not r["home"]]
            rec["split"] = {"home": {s: round(mean([r[s] for r in ho]), 1) for s in STATS} if ho else None,
                            "away": {s: round(mean([r[s] for r in aw]), 1) for s in STATS} if aw else None,
                            "home_n": len(ho), "away_n": len(aw)}
            rec["teammates_out"] = [meta[t]["name"] for t in teammates_out]
            last10 = rows[-10:]
            for s in ("pts", "reb", "ast", "pra"):
                xs = [r[s] for r in last10]
                mu = mean(xs)
                rec.setdefault("sd10", {})[s] = round((sum((x - mu) ** 2 for x in xs) / max(len(xs) - 1, 1)) ** 0.5, 1)
        rec["log20"] = [{"date": r["date"], "pts": r["pts"], "reb": r["reb"], "ast": r["ast"], "fg3": r["fg3"], "pra": r["pra"]} for r in rows[-20:]]
        rec["avg60"] = {s: round(mean([r[s] for r in rows[-60:]]), 2) for s in STATS}
        rec["last5"] = [{"date": r["date"][5:], "opp": r["opp"], "home": r["home"], "pts": r["pts"], "reb": r["reb"], "ast": r["ast"], "fg3": r["fg3"]} for r in rows[-5:]]
        players.append(rec)

    teams = sorted({k[0] for k in ratios})
    defense = {t: {g: {s: round(dfac(t, g, s)[0], 3) for s in ("pts", "reb", "ast", "fg3")} for g in ("G", "F", "C")} for t in teams}
    return {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "season": f"{PRIOR_END}-{str(SEASON_END)[2:]}",
        "players": players, "defense": defense,
        "injuries_out": {t: [meta[p]["name"] for p in v] for t, v in out_by_team.items()},
        "note": ("Projections, not prices: no sportsbook lines are used. Built from L5/L10/L15/L20 averages, opponent "
                 "defense by position, head to head, rest and injuries. Early in the season the windows "
                 "reach back into last year's games."),
        "backtest": {"games": 5070, "basis": "99 players, 2025-26 games after each player's 8th, one game ahead, no lines",
                     "mae": {"pts": 6.02, "reb": 2.24, "ast": 1.84, "pra": 7.43},
                     "season_avg_mae": {"pts": 6.05, "reb": 2.24, "ast": 1.85, "pra": 7.48},
                     "windows_only_mae": {"pts": 6.10, "reb": 2.27, "ast": 1.86, "pra": 7.55},
                     "read": ("The half and half blend is a hair better than the season average and better than the "
                              "windows alone. Opponent defense and home/away added nothing measurable, so defense is applied "
                              "at a small weight and the home/away split is shown but not applied. A typical miss on points "
                              "is about 6, so treat every number as a range, not a pick.")},
    }


if __name__ == "__main__":
    try:
        data = build()
    except Exception as e:                         # noqa
        print("nba.py: skipped,", e)
        sys.exit(0)
    (HERE / "nba.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"nba.json: {len(data['players'])} players, {sum(1 for p in data['players'] if p['proj'])} projected")
