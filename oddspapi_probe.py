#!/usr/bin/env python3
"""Probe 2 of the OddsPapi API: NBA (sportId 11) and NFL (sportId 14) DraftKings player props.
Rate limited by the API, so every call waits and retries. Writes oddspapi_probe.json. The key is never printed or saved."""
import json, os, time, urllib.parse, urllib.request, urllib.error
KEY = os.environ.get("ODDSPAPI_KEY", "").strip()
BASE = "https://api.oddspapi.io/v4/"
out = {}
def get(path, **q):
    q["apiKey"] = KEY
    url = BASE + path + "?" + urllib.parse.urlencode(q)
    for _ in range(6):
        time.sleep(1.3)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TransferSportal"}), timeout=90) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:400].replace(KEY, "***")
            if e.code == 429: continue
            return e.code, body
        except Exception as e:
            return 0, str(e).replace(KEY, "***")[:300]
    return 429, "still rate limited"
if not KEY:
    out["error"] = "ODDSPAPI_KEY is not set"
else:
    st, mk = get("markets"); out["markets_status"] = st
    if isinstance(mk, list):
        for sid, label in ((11, "nba"), (14, "nfl")):
            pp = [m for m in mk if m.get("playerProp") and m.get("sportId") == sid]
            out[label + "_playerprop_market_count"] = len(pp)
            names = {}
            for m in pp:
                names.setdefault(m.get("marketName"), []).append((m.get("marketId"), m.get("handicap"), m.get("period"), m.get("marketType")))
            out[label + "_playerprop_names"] = {k: v[:3] for k, v in list(names.items())[:120]}
    for sid, label, kw in ((11, "nba", "nba"), (14, "nfl", "nfl")):
        st, t = get("tournaments", sportId=sid)
        if isinstance(t, list):
            hit = [x for x in t if x.get("tournamentName", "").strip().lower() == kw or (kw in x.get("tournamentName", "").lower() and x.get("categorySlug") in ("usa", "nba", "nfl"))]
            out[label + "_tournaments"] = hit[:6]
            for x in hit[:2]:
                tid = x["tournamentId"]
                st2, o = get("odds-by-tournaments", bookmaker="draftkings", tournamentIds=tid, oddsFormat="american")
                rec = {"tournament": tid, "status": st2}
                if isinstance(o, list) and o:
                    f = o[0]
                    mks = ((f.get("bookmakerOdds") or {}).get("draftkings") or {}).get("markets") or {}
                    rec["fixtures"] = len(o)
                    rec["fixture_keys"] = list(f.keys())
                    rec["market_ids"] = list(mks.keys())[:80]
                    pm = {}
                    for mid, m in mks.items():
                        for oid, oc in (m.get("outcomes") or {}).items():
                            for k, p in (oc.get("players") or {}).items():
                                if p.get("playerName"):
                                    pm.setdefault(mid, []).append({"outcome": oid, "player": p})
                                    break
                    rec["sample_player_markets"] = {k: v[:3] for k, v in list(pm.items())[:6]}
                    rec["n_player_markets"] = len(pm)
                else:
                    rec["body"] = o if isinstance(o, str) else json.dumps(o)[:500]
                out[label + "_odds_" + str(tid)] = rec
        else:
            out[label + "_tournaments_error"] = t
txt = json.dumps(out, indent=1)
if KEY: txt = txt.replace(KEY, "***")
open("oddspapi_probe.json", "w").write(txt)
print("probe written", len(txt), "bytes")
