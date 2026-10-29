"""
Best 5 NBA props of the day, locked once per day, graded the next morning.

Reads nba.json (built by nba.py a moment earlier). For every player with a game
today and every stat, it sets a model line at his season-long average rounded to
a half point, then looks for the spots where:

  * the model's projection for tonight sits well away from that line
    (at least half a typical game-to-game swing), and
  * he has gone that same way in at least 7 of his last 10 games
    (Over: cleared the line. Under: stayed below it.)

The top 5 by a score built from the gap, the last 10 and the last 20 become the
card. One pick per player, at most 2 per game and 2 per stat.

There is no sportsbook line in here. The line is the model's own, so the card
tells you the number to look for and which side. If the book's number is worse
than the model line (higher for an Over, lower for an Under) the edge shrinks or
is gone. On last season's games this rule hit about 64% of Overs and 70% of
Unders against these model lines (baseline: 45% Overs, 55% Unders). That says
the projection finds real gaps. It does not say a bet beats the closing price.

Every pick is graded against its line: win, loss, or void if the player did not
play.

Files:
  nba_picks/YYYY-MM-DD.json   one per day, written once; results fill in later
  nba_picks.json              what the site embeds: today's card, recent days,
                              and the running record

Never raises on a bad day. If ESPN is down it leaves everything as it was and
exits 0, so the NFL board still builds.
"""
import json, sys, math, datetime as dt
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import nba

HERE = Path(__file__).parent
DIR = HERE / "nba_picks"
OUT = HERE / "nba_picks.json"
ET = nba.ET

STATS = ["pts", "reb", "ast", "fg3", "pra"]
LABEL = {"pts": "points", "reb": "rebounds", "ast": "assists", "fg3": "threes", "pra": "pts+reb+ast"}
MIN_LINE = {"pts": 12.5, "reb": 4.5, "ast": 3.5, "fg3": 1.5, "pra": 24.5}
MIN_HIT10 = 0.7            # went the same way in at least 7 of the last 10
MIN_Z = 0.5                # projection must sit half a typical swing off the line
MAX_PER_GAME = 2
MAX_PER_STAT = 2
N_PICKS = 5


def model_line(avg):
    """Season-long average, rounded to the nearest half point (always x.5, so no pushes)."""
    f = int(avg // 1)
    return min((f - 0.5, f + 0.5, f + 1.5), key=lambda v: abs(v - avg))


def hit_rate(vals, line):
    return sum(1 for v in vals if v > line) / len(vals) if vals else 0.0


def candidates(n, now, min_z=MIN_Z, min_h=MIN_HIT10):
    today = now.astimezone(ET).date().isoformat()
    out = []
    for p in n["players"]:
        nx = p.get("next")
        if not nx or not p.get("proj") or not p.get("log20"):
            continue
        if nba.et_date(nx["date"]) != today:
            continue
        if dt.datetime.fromisoformat(nx["date"].replace("Z", "+00:00")) <= now:
            continue                       # already tipped off
        if p["avail"] < 0.9:
            continue                       # out, doubtful, questionable or day to day
        if (p.get("min_l10") or 0) < 22:
            continue
        log = p["log20"]
        if len(log) < 10:
            continue
        for s in STATS:
            avg = (p.get("avg60") or {}).get(s)
            proj = p["proj"].get(s)
            if avg is None or proj is None:
                continue
            line = model_line(avg)
            if line < MIN_LINE[s]:
                continue
            sd = max((p.get("sd10") or {}).get(s) or 0, 1.0)
            z = (proj - line) / sd
            side = "over" if z > 0 else "under"
            z = abs(z)
            if z < min_z:
                continue
            v10 = [g[s] for g in log[-10:]]
            v20 = [g[s] for g in log]
            if side == "over":
                h10, h20 = hit_rate(v10, line), hit_rate(v20, line)
            else:
                h10, h20 = 1 - hit_rate(v10, line), 1 - hit_rate(v20, line)
            if h10 < min_h:
                continue
            score = z + 2.0 * (h10 - 0.7) + 1.5 * (h20 - 0.6)
            f = (p.get("factors") or {}).get(s) or {}
            out.append({
                "pid": p["id"], "name": p["name"], "team": p["team"], "pos": p["pos"],
                "opp": nx["opp"], "home": nx["home"], "tip": nx["date"], "b2b": nx.get("b2b", False),
                "stat": s, "line": line, "side": side,
                "hit10": round(h10, 2), "hit20": round(h20, 2), "n20": len(v20),
                "proj": round(proj, 1), "avg": round(avg, 1), "l5": p["windows"]["5"].get(s), "l10": p["windows"]["10"].get(s),
                "sd10": sd, "z": round(z, 2), "score": round(score, 3),
                "def": f.get("def"), "teammates_out": p.get("teammates_out") or [],
                "opp_out": (n.get("injuries_out") or {}).get(nx["opp"], []),
                "lean": not (z >= MIN_Z and h10 >= MIN_HIT10),
                "result": None, "actual": None,
            })
    return out


def choose(cands, picks=None):
    cands = sorted(cands, key=lambda c: -c["score"])
    picks = list(picks or [])
    players, games, stats = {c["pid"] for c in picks}, {}, {}
    for c in picks:
        g = tuple(sorted((c["team"], c["opp"])))
        games[g] = games.get(g, 0) + 1; stats[c["stat"]] = stats.get(c["stat"], 0) + 1
    if len(picks) >= N_PICKS:
        return picks
    for c in cands:
        g = tuple(sorted((c["team"], c["opp"])))
        if c["pid"] in players or games.get(g, 0) >= MAX_PER_GAME or stats.get(c["stat"], 0) >= MAX_PER_STAT:
            continue
        picks.append(c); players.add(c["pid"])
        games[g] = games.get(g, 0) + 1; stats[c["stat"]] = stats.get(c["stat"], 0) + 1
        if len(picks) == N_PICKS:
            break
    return picks


def why(c):
    word = "over" if c["side"] == "over" else "under"
    bits = [f"{word.title()} {c['line']} {LABEL[c['stat']]}.",
            f"Went {word} in {round(c['hit10'] * 10)} of his last 10 and {round(c['hit20'] * c['n20'])} of his last {c['n20']}.",
            f"Season average {c['avg']}, model has him at {c['proj']} tonight."]
    d = c.get("def")
    good = (d is not None) and ((d >= 1.03) == (c["side"] == "over")) and abs(d - 1) >= 0.03
    if d is not None and abs(d - 1) >= 0.03:
        bits.append(("Matchup helps this side." if good else "Matchup works against this side."))
    if c["teammates_out"]: bits.append("Teammates out: " + ", ".join(c["teammates_out"]) + ".")
    if c["b2b"]: bits.append("Back to back, so watch the minutes.")
    if c.get("lean"): bits.append("A lean: the gap or the recent run is smaller than on a full pick.")
    return " ".join(bits)


def grade(files, today):
    """Fill in results for any pick whose game is finished."""
    need = {}
    for f in files:
        for c in f["picks"]:
            if c["result"] is None and f["date"] < today:
                need.setdefault(c["pid"], None)
    if not need:
        return
    with ThreadPoolExecutor(6) as ex:
        logs = dict(zip(need, ex.map(lambda pid: nba.gamelog(pid), need)))
    for f in files:
        d0 = dt.date.fromisoformat(f["date"])
        for c in f["picks"]:
            if c["result"] is not None or f["date"] >= today:
                continue
            rows = [r for r in logs.get(c["pid"], []) if r["date"] == f["date"]]
            if rows:
                a = rows[0][c["stat"]]
                c["actual"] = a
                won = a > c["line"] if c["side"] == "over" else a < c["line"]
                c["result"] = "win" if won else "loss"
            elif (dt.date.fromisoformat(today) - d0).days >= 2:
                c["result"] = "void"          # did not play, or the feed never showed the game


def record(files):
    w = l = v = 0
    by_stat, by_day = {}, []
    seq = []
    for f in sorted(files, key=lambda f: f["date"]):
        dw = dl = dv = 0
        for c in f["picks"]:
            r = c["result"]
            if r == "win": w += 1; dw += 1; seq.append("W")
            elif r == "loss": l += 1; dl += 1; seq.append("L")
            elif r == "void": v += 1; dv += 1
            if r in ("win", "loss"):
                b = by_stat.setdefault(c["stat"], {"w": 0, "l": 0})
                b["w" if r == "win" else "l"] += 1
        by_day.append({"date": f["date"], "w": dw, "l": dl, "v": dv,
                       "pending": sum(1 for c in f["picks"] if c["result"] is None)})
    streak = ""
    if seq:
        k = 1
        while k < len(seq) and seq[-1 - k] == seq[-1]:
            k += 1
        streak = f"{seq[-1]}{k}"
    return {"w": w, "l": l, "v": v, "pct": round(100.0 * w / (w + l), 1) if (w + l) else None,
            "by_stat": by_stat, "by_day": by_day[-30:], "streak": streak,
            "note": ("Each pick is graded against its model line, on the side shown. A pick is void if the player did not "
                     "play. The lines are the model's own (season average, rounded to a half point), not sportsbook "
                     "lines, so this record says how often the picks beat that line, not what a bet would have paid.")}


def main():
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ET).date().isoformat()
    n = json.loads((HERE / "nba.json").read_text())
    DIR.mkdir(exist_ok=True)

    # 1. Lock today's card once.
    path = DIR / f"{today}.json"
    if not path.exists():
        picks = choose(candidates(n, now))
        if len(picks) < N_PICKS:
            # Short on clean spots: fill with looser ones, marked as leans on the card.
            picks = choose(candidates(n, now, 0.3, 0.6), picks)
        for c in picks:
            c["why"] = why(c)
        if picks:
            path.write_text(json.dumps({"date": today, "made_at": now.strftime("%Y-%m-%d %H:%M UTC"),
                                        "picks": picks}, indent=1))
            print(f"nba_picks: locked {len(picks)} picks for {today}")
        else:
            print(f"nba_picks: no picks cleared the bar for {today}")

    # 2. Grade anything that has finished.
    files = [json.loads(p.read_text()) for p in sorted(DIR.glob("*.json"))]
    grade(files, today)
    for f in files:
        (DIR / f"{f['date']}.json").write_text(json.dumps(f, indent=1))

    # 3. What the site embeds.
    rec = record(files)
    cur = next((f for f in files if f["date"] == today), None)
    OUT.write_text(json.dumps({
        "generated": now.strftime("%Y-%m-%d %H:%M UTC"), "today": today,
        "card": cur, "history": [f for f in files if f["date"] != today][-14:][::-1], "record": rec,
    }, separators=(",", ":")))
    print(f"nba_picks.json: record {rec['w']}-{rec['l']}-{rec['v']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                         # noqa
        print("nba_picks.py: skipped,", e)
        sys.exit(0)
