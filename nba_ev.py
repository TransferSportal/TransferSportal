#!/usr/bin/env python3
"""
TransferSportal -- Top 5 EV: today's NBA props ranked by expected value against DraftKings.

Reads nba.json (projections) and nba_lines.json (DraftKings main lines with Over and Under prices,
from nba_lines.py) and writes the five best positive-EV plays into nba_picks.json under "ev".

How EV is worked out
  1. The model's chance of the Over: a normal curve around the projection, using the player's recent
     game-to-game swing (threes use a Poisson, since the counts are small).
  2. The book's own chance: the Over and Under prices with the vig removed.
  3. The two are blended half and half. A raw model edge on a small sample is mostly noise, and
     halving it keeps one wild projection from topping the list.
  4. EV per $1 = blended win chance x decimal payout - 1, for whichever side is better.
One play per player, at most two per game. Only players with a clean injury status and a game today
that has not tipped. It runs after nba_lines.py and only shows lines dated today.

    python nba_ev.py          # writes nba_picks.json
    python nba_ev.py --test   # prints and writes ev_test.json instead
"""
import json, math, sys, datetime as dt
from pathlib import Path

import nba
from odds import norm

HERE = Path(__file__).parent
STATS = ("pts", "reb", "fg3", "pra")
BLEND = 0.5          # weight on the model; the rest is the book's devigged price
MIN_GAMES = 15
MIN_AVAIL = 0.9
TOP = 5
PER_GAME = 2


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def dec(a):
    return 1 + a / 100 if a > 0 else 1 + 100 / -a


def imp(a):
    return 100 / (a + 100) if a > 0 else -a / (-a + 100)


def p_over(stat, mu, sd, line):
    if stat == "fg3":
        k = int(math.floor(line))
        return 1 - sum(math.exp(-mu) * mu ** i / math.factorial(i) for i in range(k + 1))
    return 1 - phi((line - mu) / sd)


def build(now):
    today = now.astimezone(nba.ET).date().isoformat()
    L = json.loads((HERE / "nba_lines.json").read_text())
    if L.get("date") != today or not L.get("lines"):
        return today, None, "lines are not from today"
    players = json.loads((HERE / "nba.json").read_text())["players"]
    cands = []
    for p in players:
        nx = p.get("next") or {}
        if not nx.get("date") or (p.get("games_logged") or 0) < MIN_GAMES or (p.get("avail") or 0) < MIN_AVAIL:
            continue
        tip = dt.datetime.fromisoformat(nx["date"].replace("Z", "+00:00"))
        if tip <= now or tip.astimezone(nba.ET).date().isoformat() != today:
            continue
        book = L["lines"].get(norm(p["name"]))
        if not book:
            continue
        best = None
        for s in STATS:
            b = book.get(s)
            proj = (p.get("proj") or {}).get(s)
            if not b or proj is None or b.get("over") is None or b.get("under") is None:
                continue
            sd = max(((p.get("sd10") or {}).get(s) or 0), 1.0)
            line = float(b["line"])
            po, pu = imp(b["over"]), imp(b["under"])
            fair_o = po / (po + pu)
            pm_o = p_over(s, proj, sd, line)
            bl_o = BLEND * pm_o + (1 - BLEND) * fair_o
            for side, price, pm, fair, bl in (("over", b["over"], pm_o, fair_o, bl_o),
                                              ("under", b["under"], 1 - pm_o, 1 - fair_o, 1 - bl_o)):
                ev = bl * dec(price) - 1
                if best is None or ev > best["ev"]:
                    logs = ((p.get("logs") or {}).get(s) or [])[-10:]
                    hit = sum(1 for x in logs if (x > line if side == "over" else x < line))
                    best = {"pid": p["id"], "name": p["name"], "team": p["team"], "opp": nx.get("opp"),
                            "home": bool(nx.get("home")), "tip": nx["date"], "stat": s, "side": side,
                            "line": line, "price": price, "book": L.get("book", "DraftKings"),
                            "ev": round(ev, 4), "p_model": round(pm, 3), "p_fair": round(fair, 3),
                            "p_blend": round(bl, 3), "proj": proj, "sd": round(sd, 1),
                            "hit10": hit, "n10": len(logs)}
        if best and best["ev"] > 0:
            cands.append(best)
    cands.sort(key=lambda c: -c["ev"])
    out, per = [], {}
    for c in cands:
        g = frozenset((c["team"], c["opp"]))
        if per.get(g, 0) >= PER_GAME:
            continue
        per[g] = per.get(g, 0) + 1
        out.append(c)
        if len(out) == TOP:
            break
    return today, out, f"{len(cands)} positive-EV plays found"


def main(argv):
    now = dt.datetime.now(dt.timezone.utc)
    try:
        today, picks, note = build(now)
    except Exception as e:
        print("nba_ev: skipped,", type(e).__name__, e)
        return
    block = None if picks is None else {"date": today, "made_at": now.strftime("%Y-%m-%d %H:%M UTC"),
                                         "blend": BLEND, "picks": picks}
    print("nba_ev:", note, "->", 0 if picks is None else len(picks), "shown")
    if "--test" in argv:
        (HERE / "ev_test.json").write_text(json.dumps({"note": note, "ev": block}, indent=1))
        return
    f = HERE / "nba_picks.json"
    P = json.loads(f.read_text()) if f.exists() else {}
    if block is None:
        P.pop("ev", None)
    else:
        P["ev"] = block
    f.write_text(json.dumps(P, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:])
