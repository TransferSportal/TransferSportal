#!/usr/bin/env python3
"""Probe 3: catalog entries for the markets DraftKings actually posts, plus NFL anytime-TD candidates. Key never printed or saved."""
import json, os, time, urllib.parse, urllib.request, urllib.error
KEY = os.environ.get("ODDSPAPI_KEY", "").strip()
BASE = "https://api.oddspapi.io/v4/"
def get(path, **q):
    q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q)
    for _ in range(6):
        time.sleep(1.3)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TransferSportal"}), timeout=120) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429: continue
            return e.code, e.read().decode()[:300].replace(KEY, "***")
        except Exception as e:
            return 0, str(e).replace(KEY, "***")[:300]
    return 429, "rate limited"
out = {}
st, mk = get("markets")
cat = {str(m["marketId"]): m for m in mk} if isinstance(mk, list) else {}
out["catalog_status"] = st
def show(ids): return {i: cat.get(str(i)) for i in ids}
out["some"] = show([14388, 144637, 145362, 148857, 148625, 1426556, 1428820, 111678, 112020, 111694, 111848])
# NFL: which markets DraftKings posts per fixture, with how many player rows, named from the catalog
st, o = get("odds-by-tournaments", bookmaker="draftkings", tournamentIds=31, oddsFormat="american")
nfl = {}
if isinstance(o, list) and o:
    f = o[0]
    out["nfl_fixture"] = {k: f[k] for k in ("fixtureId", "participant1Id", "participant2Id", "startTime")}
    mks = f["bookmakerOdds"]["draftkings"]["markets"]
    for mid, m in mks.items():
        c = cat.get(mid) or {}
        n = sum(len(oc.get("players") or {}) for oc in (m.get("outcomes") or {}).values())
        if c.get("playerProp"):
            nfl[mid] = {"name": c.get("marketName"), "type": c.get("marketType"), "hcp": c.get("handicap"), "period": c.get("period"),
                        "outcomes": c.get("outcomes"), "rows": n}
out["nfl_player_markets"] = nfl
out["nfl_td_markets"] = {k: v for k, v in nfl.items() if "TD" in (v["name"] or "") and "Over Under" not in (v["name"] or "")}
# one full anytime-TD market sample
for mid, v in out["nfl_td_markets"].items():
    m = mks[mid]
    rows = []
    for oid, oc in (m.get("outcomes") or {}).items():
        for k, p in (oc.get("players") or {}).items():
            rows.append({"outcome": oid, "name": p.get("playerName"), "american": p.get("priceAmerican"), "active": p.get("active"), "main": p.get("mainLine")})
    out["nfl_td_markets"][mid]["sample_rows"] = rows[:6]
# participants (to map team ids to names)
st, parts = get("participants", sportId=14)
out["participants_status"] = st
out["participants_sample"] = parts[:3] if isinstance(parts, list) else str(parts)[:200]
# NBA: main-line flag check
st, o = get("odds-by-tournaments", bookmaker="draftkings", tournamentIds=132, oddsFormat="american")
nba = {}
if isinstance(o, list) and o:
    f = o[0]
    out["nba_fixture"] = {k: f[k] for k in ("fixtureId", "participant1Id", "participant2Id", "startTime")}
    mks = f["bookmakerOdds"]["draftkings"]["markets"]
    for mid, m in mks.items():
        c = cat.get(mid) or {}
        if c.get("playerProp") and c.get("marketType") in ("playertotals-points", "playertotals-rebounds", "playertotals-3pointers", "playertotals-ptsassreb"):
            rows = []
            for oid, oc in (m.get("outcomes") or {}).items():
                for k, p in (oc.get("players") or {}).items():
                    rows.append((oid, p.get("playerName"), p.get("priceAmerican"), p.get("mainLine"), p.get("active")))
            nba[mid] = {"type": c.get("marketType"), "hcp": c.get("handicap"), "outcomes": c.get("outcomes"), "rows": rows[:4]}
    out["nba_markets_sample"] = dict(list(nba.items())[:10])
    out["nba_main_count"] = sum(1 for m in nba.values() for r in m["rows"] if r[3])
st, parts = get("participants", sportId=11)
out["nba_participants_sample"] = parts[:3] if isinstance(parts, list) else str(parts)[:200]
txt = json.dumps(out, indent=1, default=str)
if KEY: txt = txt.replace(KEY, "***")
open("oddspapi_probe.json", "w").write(txt)
print("probe written", len(txt))
