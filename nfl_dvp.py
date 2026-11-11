#!/usr/bin/env python3
"""
Defense versus position, in yards. Writes nfl_dvp.json.

For every team, the yards its defense has allowed per game to each kind of
player: QB passing, QB rushing, RB rushing, RB receiving, WR receiving and TE
receiving. Built from nflverse player game logs, regular season only, by adding
up what the offensive players at each position gained against that defense and
dividing by the games it has played.

Rank 1 is the softest defense (most yards allowed). The page colors green for
soft and red for tough. Each team also carries its opponent for the upcoming
week from games.json, or a bye. Never blocks the build: on any failure it keeps
the last file.
"""
import io, json, sys, urllib.request
from pathlib import Path
import pandas as pd

HERE = Path(__file__).parent
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI"}
COLS = [("qbp", "QB PASS", "QB", "passing_yards"), ("qbr", "QB RUSH", "QB", "rushing_yards"),
        ("rbr", "RB RUSH", "RB", "rushing_yards"), ("rbc", "RB REC", "RB", "receiving_yards"),
        ("wr", "WR REC", "WR", "receiving_yards"), ("te", "TE REC", "TE", "receiving_yards")]


def load(season):
    for p in (f"stats_player/stats_player_week_{season}.csv", f"player_stats/stats_player_week_{season}.csv"):
        try:
            r = urllib.request.Request(f"{BASE}/{p}", headers={"User-Agent": "Mozilla/5.0"})
            return pd.read_csv(io.BytesIO(urllib.request.urlopen(r, timeout=300).read()), low_memory=False)
        except Exception as e:
            print("nfl_dvp.py: skip", p, e)
    return None


def build(season):
    d = load(season)
    if d is None:
        return None
    d = d[d.season_type == "REG"].copy()
    d["team"] = d.team.replace(TEAM_FIX)
    d["opponent_team"] = d.opponent_team.replace(TEAM_FIX)
    d = d[d.opponent_team.notna()]
    games = d.groupby("opponent_team").week.nunique()
    if len(games) < 30 or games.min() < 1:
        return None
    pg = {}
    for key, _, pos, col in COLS:
        s = d[d.position == pos].groupby("opponent_team")[col].sum()
        pg[key] = (s.reindex(games.index).fillna(0) / games).round(1)
    rank = {k: v.rank(ascending=False, method="min").astype(int) for k, v in pg.items()}
    nxt = {}
    try:
        gm = json.loads((HERE / "games.json").read_text())["games"]
        for g in gm:
            nxt[g["home"]] = ("vs", g["away"])
            nxt[g["away"]] = ("@", g["home"])
        week = gm[0]["week"] if gm else None
    except Exception:
        week = None
    rows = []
    for t in sorted(games.index):
        n = nxt.get(t)
        rows.append({"team": t, "g": int(games[t]),
                     "opp": n[1] if n else None, "ha": n[0] if n else None,
                     "bye": bool(nxt) and not n,
                     "v": {k: float(pg[k][t]) for k, *_ in COLS},
                     "r": {k: int(rank[k][t]) for k, *_ in COLS}})
    return {"season": season, "week": week, "teams": len(rows),
            "cols": [[k, lab] for k, lab, *_ in COLS], "rows": rows}


if __name__ == "__main__":
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    out = HERE / "nfl_dvp.json"
    try:
        res = build(season)
    except Exception as e:
        res = None
        print("nfl_dvp.py: failed,", e)
    if res:
        out.write_text(json.dumps(res, separators=(",", ":")))
        print(f"nfl_dvp.py: wrote {res['teams']} teams")
    else:
        print("nfl_dvp.py: kept the last file" if out.exists() else "nfl_dvp.py: nothing written")
