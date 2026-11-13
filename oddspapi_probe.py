#!/usr/bin/env python3
"""One-off probe of the OddsPapi API. Writes oddspapi_probe.json so the real adapter can be built from facts.
The key comes from the ODDSPAPI_KEY environment variable and is never printed or saved."""
import json, os, sys, urllib.parse, urllib.request
KEY = os.environ.get("ODDSPAPI_KEY", "").strip()
BASE = "https://api.oddspapi.io/v4/"
out = {}
def get(path, **q):
    q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TransferSportal"}), timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400].replace(KEY, "***")
    except Exception as e:
        return 0, str(e).replace(KEY, "***")[:300]
def short(x, n=1500):
    return json.dumps(x)[:n] if not isinstance(x, str) else x[:n]
if not KEY:
    out["error"] = "ODDSPAPI_KEY is not set"
else:
    st, sports = get("sports"); out["sports"] = [st, short(sports, 2500)]
    st, bk = get("bookmakers"); out["bookmakers_status"] = st
    if isinstance(bk, list):
        out["draftkings"] = [b for b in bk if "draft" in json.dumps(b).lower()][:3]
        out["bookmaker_count"] = len(bk)
    else: out["bookmakers"] = short(bk)
    st, mk = get("markets"); out["markets_status"] = st
    if isinstance(mk, list):
        out["market_count"] = len(mk)
        out["player_markets"] = [m for m in mk if any(k in json.dumps(m).lower() for k in ("player", "touchdown", "points", "rebounds", "threes"))][:80]
    else: out["markets"] = short(mk)
    sid = {}
    if isinstance(sports, list):
        for s in sports:
            nm = json.dumps(s).lower()
            if "basketball" in nm: sid["basketball"] = s
            if "american football" in nm: sid["football"] = s
    out["sport_rows"] = sid
    for label, s in sid.items():
        sportId = s.get("sportId") or s.get("id")
        st, t = get("tournaments", sportId=sportId)
        if isinstance(t, list):
            hit = [x for x in t if any(k in json.dumps(x).lower() for k in ("nba", "nfl"))][:6]
            out[label + "_tournaments"] = hit
            for x in hit[:2]:
                tid = x.get("tournamentId") or x.get("id")
                st2, o = get("odds-by-tournaments", bookmaker="draftkings", tournamentIds=tid, oddsFormat="american")
                rec = {"tournament": tid, "status": st2}
                if isinstance(o, list) and o:
                    f = o[0]
                    bo = (f.get("bookmakerOdds") or {}).get("draftkings") or {}
                    mks = bo.get("markets") or {}
                    rec["fixtures"] = len(o)
                    rec["market_ids"] = list(mks.keys())[:60]
                    pm = {}
                    for mid, m in list(mks.items()):
                        for oid, oc in (m.get("outcomes") or {}).items():
                            for k, p in (oc.get("players") or {}).items():
                                if p.get("playerName"):
                                    pm[mid] = {"outcome": oid, "player": p}
                                    break
                            if mid in pm: break
                    rec["sample_player_markets"] = dict(list(pm.items())[:6])
                    rec["fixture_keys"] = list(f.keys())
                else:
                    rec["body"] = short(o, 600)
                out[label + "_odds_" + str(tid)] = rec
        else:
            out[label + "_tournaments_error"] = short(t, 300)
txt = json.dumps(out, indent=1)
if KEY: txt = txt.replace(KEY, "***")
open("oddspapi_probe.json", "w").write(txt)
print("probe written", len(txt), "bytes")
