#!/usr/bin/env python3
"""
NCAA men's basketball: projected score, spread, win chance and moneyline pick for every
game that involves a team in the AP Top 25. Writes ncaa.json for the NCAAB tab.

Data is ESPN's public scoreboard (the same source nba.py uses), pulled for every day of
the season so far. Nothing here needs a key.

How a game is projected
  1. Every finished Division I game of the season goes into one opponent-adjusted fit.
     Each team gets an offense number and a defense number (points above or below an
     average team, per game), plus one home-court number for the whole sport.
     points a team scores = league average + its offense - the opponent's defense
                            + half the home-court edge (none at a neutral site)
  2. The fit is a ridge regression, so a team with only a few games is pulled toward a
     starting value taken from its AP poll rank instead of being believed outright.
     That is what keeps early November from producing nonsense.
  3. A blowout counts for less than its raw margin (margins past 22 are mostly bench time).
  4. Projected margin = home team's expected points minus the road team's, then a small
     rest adjustment. Win chance is a normal curve on that margin, with the spread of
     misses taken from a walk-forward test of this same model on games already played.
  5. The book's DraftKings spread, total and moneyline come off the same ESPN feed.
     The moneyline pick is the side whose win chance beats the price after the book's
     margin is removed. Every pick carries a confidence level that drops for thin
     samples and for gaps against the book that are large enough to be a data problem.

What it does not know: injuries, suspensions and lineup news. ESPN's college feed has no
injury data, so a star being out is invisible here. Shooting splits are shown as context
and do not move the projection, because a handful of games cannot support fitted weights
for them. Both limits are stated on the About page of the tab.

Never blocks the board: on any failure the last ncaa.json is kept and the script exits 0.
"""
import datetime
import json
import math
import pathlib
import re
import sys
import time
import urllib.request

import numpy as np

HERE = pathlib.Path(__file__).parent
OUT = HERE / "ncaa.json"
BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
UA = {"User-Agent": "Mozilla/5.0 (compatible; TransferSportal ncaa.py)"}
try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:                                   # pragma: no cover
    ET = datetime.timezone(datetime.timedelta(hours=-5))

SEASON_START = datetime.date(2026, 11, 1)
HCA_PRIOR, HCA_K = 3.5, 25.0          # home-court points, and how many games the prior is worth
TEAM_K = 6.0                          # pseudo-games of belief in the poll-rank starting value
MARGIN_CAP, MARGIN_KEEP = 22.0, 0.25  # past 22 points of margin only a quarter counts
SD_FLOOR, SD_CEIL, SD_DEFAULT = 10.5, 14.0, 12.0
BIG_GAP = 8.0                         # points of disagreement with the book that read as a data problem
DAYS_AHEAD = 1                        # today and tomorrow


# ---------------------------------------------------------------- small helpers
def num(x):
    try:
        return float(str(x).replace(",", "").replace("%", "").split()[0])
    except Exception:
        return None


def get_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def et_day(iso):
    d = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.astimezone(ET).date()


def am_to_prob(a):
    if a is None:
        return None
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def am_profit(a):
    return a / 100.0 if a > 0 else 100.0 / -a


def prob_to_am(p):
    if not (0 < p < 1):
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def parse_am(x):
    if x is None:
        return None
    s = str(x).strip().upper()
    if s in ("EVEN", "EV", "PK"):
        return 100
    m = re.match(r"^([+-]?\d+)", s)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- ESPN parsing
def rank_of(c):
    r = c.get("curatedRank")
    if isinstance(r, dict):
        r = r.get("current")
    try:
        r = int(r)
    except Exception:
        return None
    return r if 1 <= r <= 25 else None


def stats_of(c):
    s = c.get("statistics") or []
    out = {}
    if isinstance(s, dict):
        for k, v in s.items():
            out[k] = num(v)
    else:
        for it in s:
            k = it.get("name") or it.get("abbreviation")
            if k:
                out[k] = num(it.get("displayValue", it.get("value")))
    return out


def parse_odds(comp, home_abbr, away_abbr):
    lst = comp.get("odds") or []
    if not lst:
        return None
    o = next((x for x in lst if "draftkings" in json.dumps(x.get("provider", {})).lower()), lst[0])
    prov = (o.get("provider") or {}).get("name") or "Book"
    details = o.get("details") or ""
    home_spread = None
    m = re.match(r"^\s*([A-Za-z0-9&.'\-]+)\s+([+-]?\d+(?:\.\d+)?)", details)
    if m:
        ab, val = m.group(1).upper(), float(m.group(2))
        if ab == (home_abbr or "").upper():
            home_spread = -abs(val)
        elif ab == (away_abbr or "").upper():
            home_spread = abs(val)
    if home_spread is None and details.strip().upper() in ("EVEN", "PK", "PICK"):
        home_spread = 0.0
    if home_spread is None and o.get("spread") is not None:
        home_spread = num(o.get("spread"))           # ESPN lists it from the home side
    total = num(o.get("overUnder"))

    def ml(side):
        m_ = o.get("moneyline")
        if isinstance(m_, dict):
            s = m_.get(side)
            if isinstance(s, dict):
                for k in ("close", "open"):
                    c = s.get(k)
                    v = c.get("odds") if isinstance(c, dict) else c
                    a = parse_am(v)
                    if a is not None:
                        return a
        t = o.get(side + "TeamOdds")
        if isinstance(t, dict) and t.get("moneyLine") is not None:
            return parse_am(t.get("moneyLine"))
        return None

    return {"provider": prov, "home_spread": home_spread, "total": total,
            "ml_home": ml("home"), "ml_away": ml("away")}


def parse_event(ev):
    comp = (ev.get("competitions") or [None])[0]
    if not comp:
        return None
    cs = comp.get("competitors") or []
    home = next((c for c in cs if c.get("homeAway") == "home"), None)
    away = next((c for c in cs if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None
    st = (ev.get("status") or {}).get("type") or {}
    state = st.get("state") or ("post" if st.get("completed") else "pre")
    completed = bool(st.get("completed")) and state == "post"

    def team(c):
        t = c.get("team") or {}
        return {"id": str(t.get("id")), "name": t.get("shortDisplayName") or t.get("location") or t.get("displayName") or "?",
                "full": t.get("displayName") or t.get("name") or "?", "abbr": t.get("abbreviation") or "",
                "rank": rank_of(c), "score": num(c.get("score")), "stats": stats_of(c)}

    h, a = team(home), team(away)
    if h["id"] in ("None", "") or a["id"] in ("None", ""):
        return None
    tip = ev.get("date") or comp.get("date")
    if not tip:
        return None
    return {"id": str(ev.get("id")), "tip": tip, "day": et_day(tip), "state": state, "completed": completed,
            "neutral": bool(comp.get("neutralSite")), "venue": ((comp.get("venue") or {}).get("fullName") or ""),
            "home": h, "away": a, "odds": parse_odds(comp, h["abbr"], a["abbr"])}


def fetch_days(days, diag):
    games, seen = [], set()
    for d in days:
        key = d.strftime("%Y%m%d")
        try:
            sb = get_json(f"{BASE}/scoreboard?dates={key}&groups=50&limit=400")
        except Exception as e:                      # noqa: BLE001
            diag["fetch_errors"].append(f"{key}: {str(e)[:120]}")
            continue
        n = 0
        for ev in sb.get("events") or []:
            try:
                g = parse_event(ev)
            except Exception as e:                  # noqa: BLE001
                diag["parse_errors"] += 1
                if len(diag["parse_error_samples"]) < 3:
                    diag["parse_error_samples"].append(str(e)[:120])
                continue
            if g and g["id"] not in seen:
                seen.add(g["id"])
                games.append(g)
                n += 1
        diag["events_by_day"][key] = n
    return games


def fetch_poll(diag):
    """The current AP Top 25 as {team_id: rank}."""
    try:
        j = get_json(f"{BASE}/rankings")
    except Exception as e:                          # noqa: BLE001
        diag["poll_error"] = str(e)[:160]
        return {}, None
    polls = j.get("rankings") or []
    ap = [p for p in polls if (p.get("type") == "ap") or ("AP" in (p.get("name") or "") and "Coach" not in (p.get("name") or ""))]
    if not ap:
        ap = polls[:1]
    if not ap:
        return {}, None
    ap.sort(key=lambda p: p.get("date") or "", reverse=True)
    p = ap[0]
    ranks = {}
    for r in p.get("ranks") or []:
        t = r.get("team") or {}
        try:
            ranks[str(t.get("id"))] = int(r.get("current"))
        except Exception:
            pass
    return ranks, (p.get("headline") or p.get("name") or "AP Top 25") + (" · " + p["date"][:10] if p.get("date") else "")


# ---------------------------------------------------------------- the rating fit
def prior_rating(rank):
    """Starting margin vs an average team, from poll rank. #1 about +19, #25 about +12."""
    return 0.0 if not rank else 19.0 - 0.28 * (rank - 1)


def adj_points(ph, pa):
    m = ph - pa
    if abs(m) <= MARGIN_CAP:
        return ph, pa
    eff = MARGIN_CAP + MARGIN_KEEP * (abs(m) - MARGIN_CAP)
    cut = (abs(m) - eff) / 2.0
    return (ph - cut, pa + cut) if m > 0 else (ph + cut, pa - cut)


def fit(results, ranks, team_ids):
    """results: list of (home_id, away_id, home_pts, away_pts, neutral). Returns the rating table."""
    idx = {t: i for i, t in enumerate(sorted(team_ids))}
    T = len(idx)
    ncol = 2 + 2 * T                      # mu, hfa, off_t..., def_t...
    rows, ys = [], []
    for h, a, ph, pa, neu in results:
        if h not in idx or a not in idx:
            continue
        ph, pa = adj_points(ph, pa)
        hv = 0.0 if neu else 0.5
        r = np.zeros(ncol)
        r[0], r[1] = 1.0, hv
        r[2 + idx[h]] += 1.0
        r[2 + T + idx[a]] -= 1.0
        rows.append(r); ys.append(ph)
        r = np.zeros(ncol)
        r[0], r[1] = 1.0, -hv
        r[2 + idx[a]] += 1.0
        r[2 + T + idx[h]] -= 1.0
        rows.append(r); ys.append(pa)
    if not rows:
        raise RuntimeError("no finished games to fit")
    sk = math.sqrt(TEAM_K)
    for t, i in idx.items():
        p = prior_rating(ranks.get(t)) / 2.0
        for off in (2 + i, 2 + T + i):
            r = np.zeros(ncol); r[off] = sk
            rows.append(r); ys.append(sk * p)
    r = np.zeros(ncol); r[1] = math.sqrt(HCA_K); rows.append(r); ys.append(math.sqrt(HCA_K) * HCA_PRIOR)
    r = np.zeros(ncol); r[0] = 0.05; rows.append(r); ys.append(0.05 * 74.0)
    x, *_ = np.linalg.lstsq(np.array(rows), np.array(ys), rcond=None)
    out = {"mu": float(x[0]), "hfa": float(x[1]), "team": {}}
    for t, i in idx.items():
        o, d = float(x[2 + i]), float(x[2 + T + i])
        out["team"][t] = {"off": o, "def": d, "rating": o + d}
    return out


def project(model, h, a, neutral, rest_adj=0.0):
    th, ta = model["team"].get(h), model["team"].get(a)
    if not th or not ta:
        return None
    hv = 0.0 if neutral else 0.5 * model["hfa"]
    hp = model["mu"] + hv + th["off"] - ta["def"] + rest_adj / 2.0
    ap = model["mu"] - hv + ta["off"] - th["def"] - rest_adj / 2.0
    return {"home_pts": hp, "away_pts": ap, "margin": hp - ap, "total": hp + ap}


def rest_adjust(rh, ra):
    cap = lambda r: 1 if r is None else max(1, min(4, r))   # noqa: E731
    return max(-1.5, min(1.5, 0.5 * (cap(rh) - cap(ra))))


def backtest(finished, ranks, today, diag):
    """Walk forward: for each day, fit on everything before it, then predict that day's
    games that involve a ranked team. Returns the record and the spread of the misses."""
    days = sorted({g["day"] for g in finished})
    errs, su, n, bias = [], 0, 0, []
    for d in days:
        if d < SEASON_START + datetime.timedelta(days=9) or d >= today:
            continue
        past = [g for g in finished if g["day"] < d]
        if len(past) < 120:
            continue
        today_games = [g for g in finished if g["day"] == d and (ranks.get(g["home"]["id"]) or ranks.get(g["away"]["id"]))]
        if not today_games:
            continue
        tids = {g["home"]["id"] for g in past} | {g["away"]["id"] for g in past}
        try:
            m = fit([(g["home"]["id"], g["away"]["id"], g["home"]["score"], g["away"]["score"], g["neutral"]) for g in past], ranks, tids)
        except Exception:                           # noqa: BLE001
            continue
        played = {}
        for g in past:
            played[g["home"]["id"]] = played.get(g["home"]["id"], 0) + 1
            played[g["away"]["id"]] = played.get(g["away"]["id"], 0) + 1
        for g in today_games:
            h, a = g["home"]["id"], g["away"]["id"]
            if played.get(h, 0) < 2 or played.get(a, 0) < 2:
                continue
            p = project(m, h, a, g["neutral"])
            if not p:
                continue
            actual = g["home"]["score"] - g["away"]["score"]
            if actual == 0:
                continue
            n += 1
            errs.append(actual - p["margin"])
            bias.append(actual - p["margin"])
            su += 1 if (actual > 0) == (p["margin"] > 0) else 0
    if n < 12:
        diag["backtest_n"] = n
        return None
    e = np.array(errs)
    return {"games": n, "su_pct": round(100.0 * su / n, 1), "mae": round(float(np.mean(np.abs(e))), 1),
            "sd": round(float(np.std(e)), 1), "bias": round(float(np.mean(bias)), 2)}


# ---------------------------------------------------------------- team cards and picks
def team_card(g_team, model, ranks, played, last_day, today, stats_by_team):
    t = g_team["id"]
    r = model["team"].get(t) or {}
    st = stats_by_team.get(t) or g_team["stats"] or {}
    fga = st.get("fieldGoalsAttempted")
    n = played.get(t, 0)
    fgm, tpm = st.get("fieldGoalsMade"), st.get("threePointFieldGoalsMade")
    efg = round(100.0 * (fgm + 0.5 * tpm) / fga, 1) if (fga and fgm is not None and tpm is not None) else None
    rest = (today - last_day[t]).days if t in last_day else None
    return {"id": t, "name": g_team["name"], "abbr": g_team["abbr"], "rank": ranks.get(t) or g_team["rank"], "n": n,
            "rating": round(r.get("rating", 0.0), 1), "off": round(r.get("off", 0.0), 1), "def": round(r.get("def", 0.0), 1),
            "ppg": st.get("avgPoints"), "fg": st.get("fieldGoalPct"), "tp": st.get("threePointFieldGoalPct"),
            "ft": st.get("freeThrowPct"), "reb": st.get("avgRebounds"), "ast": st.get("avgAssists"),
            "efg": efg, "rest": rest}


def build_game(g, model, ranks, played, last_day, today, sd, stats_by_team):
    h, a = g["home"], g["away"]
    rh = (g["day"] - last_day[h["id"]]).days if h["id"] in last_day else None
    ra = (g["day"] - last_day[a["id"]]).days if a["id"] in last_day else None
    proj = project(model, h["id"], a["id"], g["neutral"], rest_adjust(rh, ra))
    out = {"id": g["id"], "day": g["day"].isoformat(), "tip": g["tip"], "state": g["state"], "neutral": g["neutral"],
           "venue": g["venue"], "home": team_card(h, model, ranks, played, last_day, g["day"], stats_by_team),
           "away": team_card(a, model, ranks, played, last_day, g["day"], stats_by_team),
           "score": ({"home": h["score"], "away": a["score"]} if g["state"] != "pre" else None),
           "proj": None, "market": None, "picks": None, "conf": None, "flags": []}
    nmin = min(played.get(h["id"], 0), played.get(a["id"], 0))
    if not proj:
        out["flags"].append("no rating yet")
        return out
    p_home = phi(proj["margin"] / sd)
    out["proj"] = {"home_pts": round(proj["home_pts"], 1), "away_pts": round(proj["away_pts"], 1),
                   "margin": round(proj["margin"], 1), "total": round(proj["total"], 1),
                   "p_home": round(p_home, 3), "fair_ml_home": prob_to_am(p_home), "fair_ml_away": prob_to_am(1 - p_home)}
    if g["neutral"]:
        out["flags"].append("neutral site")
    if nmin < 5:
        out["flags"].append(f"thin sample ({nmin} games)")
    o = g["odds"]
    if not o or o["home_spread"] is None:
        out["flags"].append("no book line yet")
        out["conf"] = "Low"
        return out
    mk_margin = -o["home_spread"]
    out["market"] = {"provider": o["provider"], "home_spread": o["home_spread"], "total": o["total"],
                     "ml_home": o["ml_home"], "ml_away": o["ml_away"]}
    gap = proj["margin"] - mk_margin                     # positive: model likes the home side more than the book
    cover_home = phi(gap / sd)
    spread = {"gap": round(gap, 1), "side": "home" if gap > 0 else "away",
              "cover": round(cover_home if gap > 0 else 1 - cover_home, 3)}
    ml = None
    if o["ml_home"] is not None and o["ml_away"] is not None:
        ih, ia = am_to_prob(o["ml_home"]), am_to_prob(o["ml_away"])
        fair_h = ih / (ih + ia)
        ev_h = p_home * am_profit(o["ml_home"]) - (1 - p_home)
        ev_a = (1 - p_home) * am_profit(o["ml_away"]) - p_home
        side = "home" if ev_h >= ev_a else "away"
        p_side = p_home if side == "home" else 1 - p_home
        fair_side = fair_h if side == "home" else 1 - fair_h
        ml = {"side": side, "price": o["ml_home"] if side == "home" else o["ml_away"], "p": round(p_side, 3),
              "fair": round(fair_side, 3), "edge": round(p_side - fair_side, 3),
              "ev": round(max(ev_h, ev_a), 3),
              "model_winner": "home" if p_home >= 0.5 else "away"}
    tot = None
    if o["total"] is not None:
        d = proj["total"] - o["total"]
        tot = {"diff": round(d, 1), "lean": ("Over" if d > 0 else "Under") if abs(d) >= 4.0 else None}
    # confidence: sample size and edge first, then knock it down when the gap is big enough to smell like bad data
    edge = ml["edge"] if ml else 0.0
    conf = "Low"
    if nmin >= 6 and abs(edge) >= 0.08:
        conf = "High"
    elif nmin >= 4 and abs(edge) >= 0.05:
        conf = "Medium"
    if abs(gap) > BIG_GAP:
        conf = {"High": "Medium", "Medium": "Low", "Low": "Low"}[conf]
        out["flags"].append("big gap vs the book, check injuries and lineup news")
    if ml and ml["ev"] > 0.03 and ml["edge"] >= 0.03:
        ml["call"] = "Pick" if conf in ("High", "Medium") else "Lean"
    elif ml:
        ml["call"] = "Pass"
    if abs(gap) >= 2.5:
        spread["call"] = "Pick" if (conf in ("High", "Medium") and abs(gap) >= 3.5) else "Lean"
    else:
        spread["call"] = "Pass"
    if abs(gap) > BIG_GAP:                               # never a full Pick on a gap this big without a news check
        if ml and ml.get("call") == "Pick":
            ml["call"] = "Lean"
        if spread.get("call") == "Pick":
            spread["call"] = "Lean"
    out["picks"] = {"spread": spread, "ml": ml, "total": tot}
    out["conf"] = conf
    return out


# ---------------------------------------------------------------- main
def run():
    diag = {"events_by_day": {}, "fetch_errors": [], "parse_errors": 0, "parse_error_samples": []}
    now = datetime.datetime.now(ET)
    today = now.date()
    days = []
    d = SEASON_START
    while d <= today + datetime.timedelta(days=DAYS_AHEAD):
        days.append(d)
        d += datetime.timedelta(days=1)
    ranks, poll_label = fetch_poll(diag)
    games = fetch_days(days, diag)
    finished = [g for g in games if g["completed"] and g["home"]["score"] is not None and g["away"]["score"] is not None]
    for g in games:                                  # fall back to scoreboard ranks when the poll call failed
        for t in (g["home"], g["away"]):
            if not ranks and t["rank"]:
                ranks[t["id"]] = t["rank"]
    diag.update({"games": len(games), "finished": len(finished), "ranked_teams": len(ranks), "poll": poll_label})
    if len(finished) < 40:
        raise RuntimeError(f"only {len(finished)} finished games found")
    tids = {g["home"]["id"] for g in games} | {g["away"]["id"] for g in games}
    model = fit([(g["home"]["id"], g["away"]["id"], g["home"]["score"], g["away"]["score"], g["neutral"]) for g in finished], ranks, tids)
    played, last_day, stats_by_team = {}, {}, {}
    for g in sorted(finished, key=lambda x: x["day"]):
        for t in (g["home"], g["away"]):
            played[t["id"]] = played.get(t["id"], 0) + 1
            last_day[t["id"]] = g["day"]
    for g in sorted(games, key=lambda x: x["tip"]):    # latest season-to-date box score numbers win
        for t in (g["home"], g["away"]):
            if t["stats"]:
                stats_by_team[t["id"]] = t["stats"]
    bt = backtest(finished, ranks, today, diag)
    sd = SD_DEFAULT
    if bt:
        sd = max(SD_FLOOR, min(SD_CEIL, bt["sd"]))
    slate = [g for g in games if today <= g["day"] <= today + datetime.timedelta(days=DAYS_AHEAD)
             and (ranks.get(g["home"]["id"]) or ranks.get(g["away"]["id"]))]
    slate.sort(key=lambda g: g["tip"])
    out_games = [build_game(g, model, ranks, played, last_day, today, sd, stats_by_team) for g in slate]
    teams = []
    for t, rk in sorted(ranks.items(), key=lambda kv: kv[1]):
        r = model["team"].get(t)
        if not r:
            continue
        nm = next(((x["name"], x["abbr"]) for g in games for x in (g["home"], g["away"]) if x["id"] == t), ("?", ""))
        teams.append({"id": t, "rank": rk, "name": nm[0], "abbr": nm[1], "n": played.get(t, 0), "rating": round(r["rating"], 1),
                      "off": round(r["off"], 1), "def": round(r["def"], 1)})
    diag["slate_games"] = len(out_games)
    out = {"generated": now.strftime("%Y-%m-%d %H:%M ET"), "today": today.isoformat(), "poll": poll_label,
           "model": {"mu": round(model["mu"], 1), "hfa": round(model["hfa"], 2), "sd": round(sd, 1), "games_fit": len(finished)},
           "backtest": bt, "games": out_games, "teams": teams, "diag": diag}
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"ncaa.py: {len(out_games)} slate games, {len(finished)} finished games fit, "
          f"backtest {bt['games'] if bt else 0} games, sd {sd:.1f}")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:                           # noqa: BLE001
        print(f"ncaa.py failed, keeping the last ncaa.json: {e}")
    sys.exit(0)
