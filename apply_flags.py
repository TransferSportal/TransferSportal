#!/usr/bin/env python3
"""
Take anyone the morning injury check lists as out, on IR, doubtful or suspended out of the touchdown pool.

The roster feed from nflverse lags the news by a day or more, so a player placed on IR can still read as
active in data.json, and the touchdown card would keep him. The daily check (daily.json) is written the same
day, so it is only trusted when its date is today in Eastern time. Questionable players stay in.

A flagged player is marked not rostered with the reason. picks.py skips players who are not rostered, so he
leaves the card (it is refilled from the next best pick, as on any other morning), and the board dims him.
A pick whose game has already started stays frozen exactly as written, because picks.py freezes those.

Runs between games.py and picks.py. Never blocks the build.
"""
import json
import pandas as pd

OUT_WORDS = ("out", "ir", "doubtful", "suspended")


def main(path="data.json"):
    try:
        dj = json.load(open("daily.json"))
        if dj.get("date") != pd.Timestamp.now("America/New_York").strftime("%Y-%m-%d"):
            print("apply_flags: daily.json is not from today, skipping")
            return 0
        flags = (dj.get("nfl") or {}).get("flags") or []
    except Exception as e:
        print("apply_flags: no daily check,", e)
        return 0
    gone = {}
    for f in flags:
        first = str(f.get("status", "")).strip().lower().split(" ")[0].strip(".,;:")
        if first in OUT_WORDS:
            gone[(f.get("player"), f.get("team"))] = str(f.get("status")).strip()
    data = json.load(open(path))
    n = 0
    for p in data.get("players", []):
        st = gone.get((p.get("name"), p.get("team")))
        if st:
            p["rostered"] = False
            p["out_reason"] = p.get("out_reason") or (st + " (daily injury check)")
            n += 1
    if n:
        json.dump(data, open(path, "w"), separators=(",", ":"))
    print(f"apply_flags: {n} flagged players taken out of the pool")
    return n


if __name__ == "__main__":
    main()
