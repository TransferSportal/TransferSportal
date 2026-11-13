#!/usr/bin/env python3
"""
TransferSportal -- DraftKings player-prop prices from OddsPapi.

OddsPapi is a licensed odds feed that carries DraftKings. It fills two jobs:

  * NFL anytime-TD Yes and No prices for odds.py (same shape the other feeds return).
  * NBA points, rebounds, threes and PRA lines for nba_lines.py.

DraftKings posts every alternate line as its own market, so for the NBA this picks the main
line: the book's own mainLine flag when present, otherwise the line whose Over and Under
prices are closest to even. For the NFL each team is priced from its NEXT game only, so a
later week's price can never overwrite this week's.

The key is read from the ODDSPAPI_KEY environment variable and is never printed.

    python oddspapi.py        # check run: fetches both sports, writes oddspapi_check.json
"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error, datetime as dt

KEY = os.environ.get("ODDSPAPI_KEY", "").strip()
BASE = "https://api.oddspapi.io/v4/"
BOOK = "draftkings"
NBA_T, NFL_T = 132, 31
NFL_ANYTIME_YES, NFL_ANYTIME_NO = "14388", "14389"      # market 14388 "Player To Score TD", result
NBA_STATS = {"playertotals-points": "pts", "playertotals-rebounds": "reb",
             "playertotals-3pointers": "fg3", "playertotals-ptsassreb": "pra"}
_cat = None


def get(path, **q):
    q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q)
    last = None
    for _ in range(8):
        time.sleep(1.3)                                  # the API rate limits per endpoint
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ts-board"}), timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code == 429:
                continue
            raise RuntimeError(f"oddspapi {path} HTTP {e.code}")
    raise RuntimeError(f"oddspapi {path} still rate limited ({last})")


def catalog():
    """marketId -> market, for NBA and NFL player props only (the full list is huge)."""
    global _cat
    if _cat is None:
        mk = get("markets")
        _cat = {str(m["marketId"]): m for m in mk if m.get("playerProp") and m.get("sportId") in (11, 14)}
    return _cat


def teams(sport_id):
    p = get("participants", sportId=sport_id)
    if isinstance(p, dict):
        return {str(k): v for k, v in p.items()}
    return {str(x.get("participantId")): x.get("participantName") for x in p}


def fixtures(tid):
    try:
        o = get("odds-by-tournaments", bookmaker=BOOK, tournamentIds=tid, oddsFormat="american")
    except RuntimeError as e:
        print("oddspapi:", e)
        return []
    return o if isinstance(o, list) else []


def start(f):
    return dt.datetime.fromisoformat(str(f["startTime"]).replace("Z", "+00:00"))


def pname(s):
    s = str(s or "").strip()
    if ", " in s:
        last, first = s.split(", ", 1)
        return f"{first} {last}".strip()
    return s


def amer(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def prob(a):
    return (-a) / (-a + 100) if a < 0 else 100 / (a + 100)


def rows(m):
    """Yield (outcomeId, playerEntry) for every active priced player row in a market."""
    for oid, oc in (m.get("outcomes") or {}).items():
        for p in (oc.get("players") or {}).values():
            if p.get("active", True) and p.get("playerName") and amer(p.get("priceAmerican")) is not None:
                yield str(oid), p


def nfl_td_games(team_full, now=None):
    """Same shape as dk.games(): [{pool, sides:{name:{yes,no}}, event}]. Each team once, next game only."""
    now = now or dt.datetime.now(dt.timezone.utc)
    names = teams(14)
    out, used = [], set()
    for f in sorted(fixtures(NFL_T), key=start):
        if start(f) <= now:
            continue
        a, b = names.get(str(f.get("participant1Id")), ""), names.get(str(f.get("participant2Id")), "")
        pool = {team_full.get(a, ""), team_full.get(b, "")}
        pool.discard("")
        if not pool or pool & used:
            continue
        m = (((f.get("bookmakerOdds") or {}).get(BOOK) or {}).get("markets") or {}).get(NFL_ANYTIME_YES)
        if not m:
            continue
        sides = {}
        for oid, p in rows(m):
            side = "yes" if oid == NFL_ANYTIME_YES else "no" if oid == NFL_ANYTIME_NO else None
            if side:
                sides.setdefault(pname(p["playerName"]), {})[side] = float(amer(p["priceAmerican"]))
        if sides:
            used |= pool
            out.append({"pool": pool, "sides": sides, "event": f"{a} vs {b}"})
    return out


def nba_lines(keep, norm):
    """({norm name: {stat: {line, over, under, name, game}}}, games). keep(startTime) picks the games."""
    cat = catalog()
    names = teams(11)
    lines, games = {}, 0
    for f in fixtures(NBA_T):
        if not keep(start(f)):
            continue
        games += 1
        a, b = names.get(str(f.get("participant1Id")), "?"), names.get(str(f.get("participant2Id")), "?")
        mks = (((f.get("bookmakerOdds") or {}).get(BOOK) or {}).get("markets") or {})
        cand = {}
        for mid, m in mks.items():
            c = cat.get(mid)
            if not c or c.get("period") != "result":
                continue
            stat = NBA_STATS.get(c.get("marketType"))
            if not stat:
                continue
            h = float(c.get("handicap") or 0)
            side_of = {str(o["outcomeId"]): str(o["outcomeName"]).lower() for o in c.get("outcomes", [])}
            for oid, p in rows(m):
                side = side_of.get(oid)
                if side in ("over", "under"):
                    d = cand.setdefault((pname(p["playerName"]), stat), {}).setdefault(h, {"main": False})
                    d[side] = amer(p["priceAmerican"])
                    d["main"] = d["main"] or bool(p.get("mainLine"))
        for (nm, stat), byl in cand.items():
            both = {h: v for h, v in byl.items() if "over" in v and "under" in v}
            if not both:
                continue
            gap = lambda h: abs(prob(both[h]["over"]) - prob(both[h]["under"]))
            mains = [h for h, v in both.items() if v["main"]]
            h = min(mains or both, key=gap)
            lines.setdefault(norm(nm), {})[stat] = {"line": h, "over": both[h]["over"], "under": both[h]["under"],
                                                    "name": nm, "game": f"{a} vs {b}"}
    return lines, games


if __name__ == "__main__":
    if not KEY:
        print("ODDSPAPI_KEY is not set")
        sys.exit(0)
    from odds import norm, TEAM_FULL
    now = dt.datetime.now(dt.timezone.utc)
    res = {"fetched": now.strftime("%Y-%m-%d %H:%M UTC")}
    try:
        g = nfl_td_games(TEAM_FULL, now)
        res["nfl_games"] = len(g)
        res["nfl_players_yes"] = sum(1 for x in g for v in x["sides"].values() if "yes" in v)
        res["nfl_players_with_no"] = sum(1 for x in g for v in x["sides"].values() if "yes" in v and "no" in v)
        res["nfl_events"] = [x["event"] + " " + "/".join(sorted(x["pool"])) for x in g]
        res["nfl_sample"] = {k: v for k, v in list(g[0]["sides"].items())[:6]} if g else {}
    except Exception as e:
        res["nfl_error"] = str(e)[:200]
    try:
        horizon = now + dt.timedelta(hours=36)
        ln, n = nba_lines(lambda t: now < t < horizon, norm)
        res["nba_games"] = n
        res["nba_players"] = len(ln)
        res["nba_stats_count"] = {s: sum(1 for v in ln.values() if s in v) for s in ("pts", "reb", "fg3", "pra")}
        res["nba_sample"] = {k: ln[k] for k in list(ln)[:6]}
        for want in ("ivica zubac", "aaron nesmith", "jalen brunson"):
            if want in ln: res.setdefault("nba_named", {})[want] = ln[want]
    except Exception as e:
        res["nba_error"] = str(e)[:200]
    txt = json.dumps(res, indent=1, default=str).replace(KEY, "***")
    open("oddspapi_check.json", "w").write(txt)
    print(txt[:1500])
