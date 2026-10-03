#!/usr/bin/env python3
"""
Prop cheatsheet data: per-player game logs, built from nflverse weekly stats.

Usage: python props.py 2026      # run after update.py and games.py

Writes data.json["props"], the same way games.py writes games_model, so the
site's live refresh keeps it.

What the site does with this:
  * Cheatsheets: which props cleared a number in every game recently, in every
    game against this week's opponent, or in every game at this week's venue.
  * Prop detail: bar chart of the last games against a line the user types in.
  * Parlay builder: QB plus pass catcher from the same team, joint hit rate.
  * Injuries: how a teammate's numbers move when a starter is out.

No prop lines are stored here. DraftKings prices are not loaded, so every hit
rate is against a number the user picks, never against a real posted line.
"""
import io, sys, json, time, urllib.request
import numpy as np, pandas as pd

SEASON = next((int(x) for x in sys.argv[1:] if x.isdigit()), 2026)
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI", "LAR": "LA", "JAC": "JAX", "WSH": "WAS"}
LOG_N = 12            # games kept per player
MAX_PER = {"QB": 1, "RB": 2, "WR": 4, "TE": 2}


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(2 * (i + 1))
    raise SystemExit(f"props.py: could not fetch {url}: {err}")


def stats(season):
    for name in (f"stats_player/stats_player_week_{season}.csv",
                 f"player_stats/stats_player_week_{season}.csv"):
        try:
            raw = get(f"{BASE}/{name}", tries=1)
            return pd.read_csv(io.BytesIO(raw), low_memory=False)
        except SystemExit:
            continue
    return pd.DataFrame()


def injuries(season):
    try:
        return pd.read_csv(io.BytesIO(get(f"{BASE}/injuries/injuries_{season}.csv")), low_memory=False)
    except SystemExit:
        return pd.DataFrame()


def build(data, frames, inj):
    a = pd.concat([f for f in frames if len(f)], ignore_index=True)
    a = a[a.season_type == "REG"].copy()
    a["team"] = a.team.replace(TEAM_FIX)
    a["opponent_team"] = a.opponent_team.replace(TEAM_FIX)
    a["t"] = a.season * 100 + a.week
    for c in ("completions", "attempts", "passing_yards", "carries", "rushing_yards",
              "rushing_tds", "receptions", "targets", "receiving_yards", "receiving_tds"):
        a[c] = pd.to_numeric(a[c], errors="coerce").fillna(0)
    a["td"] = a.rushing_tds + a.receiving_tds
    # game_id is season_week_AWAY_HOME
    a["home"] = [1 if str(g).split("_")[-1] == t else 0 for g, t in zip(a.game_id, a.team)]
    a = a.sort_values(["t"])

    # teams whose game this week is already in the stats feed (Thursday night):
    # their props are settled, so they leave the slate. Judged on the current
    # season only; last season's week 18 must not be mistaken for "this week".
    wk = int(str(data["meta"]["predict_week"]).split()[-1])
    cur = a[(a.season == SEASON) & (a.week == wk)]
    played = set(cur.team)
    slate = [g for g in data["games"] if g["home"] not in played and g["away"] not in played]
    teams = {}
    for g in slate:
        teams[g["home"]] = (g["away"], 1)
        teams[g["away"]] = (g["home"], 0)

    out_names = {(p["name"], p["team"]): p.get("out_reason") for p in data["players"] if p.get("out_reason")}
    status = {}
    if len(inj):
        wk = int(inj.week.max())
        cur = inj[(inj.week == wk) & inj.report_status.notna()]
        for _, r in cur.iterrows():
            status[(r.full_name, TEAM_FIX.get(r.team, r.team))] = r.report_status

    players, injured = [], []
    for team, (opp, home) in sorted(teams.items()):
        tg = a[a.team == team]
        if tg.empty:
            continue
        tgames = sorted(tg.t.unique())
        recent = tg[tg.t.isin(tgames[-4:])]
        use = recent.groupby(["player_display_name", "position"]).agg(
            att=("attempts", "mean"), car=("carries", "mean"), tgt=("targets", "mean"),
            gp=("t", "nunique")).reset_index()
        keep = []
        for pos, mx in MAX_PER.items():
            u = use[use.position == pos].copy()
            if pos == "QB":
                u = u[u.att >= 15].sort_values("att", ascending=False)
            elif pos == "RB":
                u["k"] = u.car + u.tgt
                u = u[u.k >= 5].sort_values("k", ascending=False)
            else:
                u = u[u.tgt >= 2.5].sort_values("tgt", ascending=False)
            keep += list(u.head(mx).player_display_name)
        for n in keep:
            if (n, team) in out_names:
                continue
            pg = tg[tg.player_display_name == n].tail(LOG_N)
            pos = pg.position.iloc[-1]
            rows = [[int(r.season), int(r.week), r.opponent_team, int(r.home), int(r.receiving_yards),
                     int(r.receptions), int(r.targets), int(r.rushing_yards), int(r.carries),
                     int(r.passing_yards), int(r.completions), int(r.attempts), int(r.td)]
                    for r in pg.itertuples()]
            players.append({"n": n, "pos": pos, "tm": team, "opp": opp, "h": home,
                            "st": status.get((n, team), ""), "g": rows})

        # with / without splits for a starter who is out, over this team's last
        # two seasons of games
        team_all = tg[tg.t.isin(tgames[-20:])]
        for (n, t), reason in list(out_names.items()) + [(k, "") for k in status if status[k] in ("Out", "Doubtful")]:
            if t != team:
                continue
            xr = tg[tg.player_display_name == n]
            if len(xr) < 4:
                continue
            xpos = xr.position.iloc[-1]
            usage = (xr.attempts.mean() if xpos == "QB" else xr.carries.mean() + xr.targets.mean() if xpos == "RB"
                     else xr.targets.mean())
            floor = {"QB": 20, "RB": 8, "WR": 4, "TE": 3}.get(xpos, 99)
            if usage < floor:
                continue
            with_t = set(xr.t)
            all_t = [x for x in tgames[-20:]]
            without_t = [x for x in all_t if x not in with_t]
            with_t = [x for x in all_t if x in with_t]
            if len(without_t) < 1 or len(with_t) < 3:
                continue
            mates = []
            for y in keep:
                if y == n:
                    continue
                yr = team_all[team_all.player_display_name == y]
                if len(yr) < 4:
                    continue
                def avg(ts):
                    s = yr[yr.t.isin(ts)]
                    if not len(s):
                        return None
                    return dict(g=int(len(s)), ry=round(s.receiving_yards.mean(), 1),
                                rc=round(s.receptions.mean(), 1), ruy=round(s.rushing_yards.mean(), 1),
                                ra=round(s.carries.mean(), 1), py=round(s.passing_yards.mean(), 1),
                                tg=round(s.targets.mean(), 1))
                w, wo = avg(with_t), avg(without_t)
                if w and wo:
                    mates.append({"n": y, "pos": yr.position.iloc[-1], "with": w, "without": wo})
            injured.append({"n": n, "tm": team, "pos": xpos,
                            "why": status.get((n, team)) or reason or "out",
                            "gw": len(with_t), "go": len(without_t), "mates": mates})

    # one entry per injured player
    seen, uniq = set(), []
    for i in injured:
        if (i["n"], i["tm"]) not in seen:
            seen.add((i["n"], i["tm"]))
            uniq.append(i)
    return {"week": data["meta"]["predict_week"], "through": f"{int(a.season.max())} week {int(a[a.season == a.season.max()].week.max())}",
            "players": players, "injuries": uniq}


def selftest():
    # a tiny league: AAA and BBB have played this week (settled), CCC and DDD have not
    rows = []
    def add(season, week, team, opp, home, name, pos, **k):
        base = dict(season=season, season_type="REG", week=week, team=team, opponent_team=opp,
                    game_id=f"{season}_{week:02d}_{opp if home else team}_{team if home else opp}",
                    player_display_name=name, position=pos, completions=0, attempts=0, passing_yards=0,
                    carries=0, rushing_yards=0, rushing_tds=0, receptions=0, targets=0,
                    receiving_yards=0, receiving_tds=0)
        base.update(k); rows.append(base)
    for w in range(1, 7):
        for team, opp, home in (("CCC", "DDD", 1), ("DDD", "CCC", 0)):
            add(2025, w, team, opp, home, team + " QB", "QB", attempts=30, completions=20, passing_yards=250)
            add(2025, w, team, opp, home, team + " RB", "RB", carries=15, rushing_yards=70)
            for i in range(3):
                # WR1 misses games 2 and 3 so there is a without-him sample
                if i == 0 and w in (2, 3) and team == "CCC":
                    continue
                add(2025, w, team, opp, home, f"{team} WR{i}", "WR", targets=6 - i, receptions=4, receiving_yards=60 - 10 * i)
    for team, opp, home in (("AAA", "BBB", 1), ("BBB", "AAA", 0)):
        for w in range(1, 7):
            add(2025, w, team, opp, home, team + " QB", "QB", attempts=30, passing_yards=250)
            add(2025, w, team, opp, home, team + " WR0", "WR", targets=8, receiving_yards=80)
    for team, opp, home in (("AAA", "BBB", 1), ("BBB", "AAA", 0)):          # this week's game, already played
        add(2026, 4, team, opp, home, team + " WR0", "WR", targets=8, receiving_yards=80)
    frame = pd.DataFrame(rows)
    # pad every column the real feed has and the builder reads
    data = {"meta": {"predict_week": "2026 Week 4", "weeks_played": 3},
            "games": [{"home": "AAA", "away": "BBB"}, {"home": "CCC", "away": "DDD"}],
            "players": [{"name": "CCC WR0", "team": "CCC", "out_reason": "reserve/IR"}]}
    out = build(data, [frame], pd.DataFrame())
    names = {p["n"] for p in out["players"]}
    assert not any(n.startswith(("AAA", "BBB")) for n in names), "a settled game is still on the slate"
    assert "CCC QB" in names and "DDD QB" in names, "an unplayed game is missing"
    assert "CCC WR0" not in names, "an out player is still listed"
    qb = next(p for p in out["players"] if p["n"] == "CCC QB")
    assert qb["h"] == 1 and qb["opp"] == "DDD" and len(qb["g"]) == 6
    assert qb["g"][0][3] == 1 and qb["g"][0][9] == 250, "log columns are out of order"
    assert len(out["injuries"]) == 1, "the out starter's with/without split is missing"
    inj = out["injuries"][0]
    assert inj["gw"] == 4 and inj["go"] == 2, (inj["gw"], inj["go"])   # team played 6, he sat 2
    print("props selftest passed: settled games dropped, out player dropped, split 4 with / 2 without")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    data = json.load(open("data.json"))
    frames = [stats(SEASON - 1), stats(SEASON)]
    if not any(len(f) for f in frames):
        raise SystemExit("props.py: no stats downloaded")
    props = build(data, frames, injuries(SEASON))
    if len(props["players"]) < 100:
        raise SystemExit(f"props.py: only {len(props['players'])} players, refusing to write a thin file")
    data["props"] = props
    json.dump(data, open("data.json", "w"), separators=(",", ":"))
    print(f"props: {len(props['players'])} players, {len(props['injuries'])} injury splits, {props['through']}")


if __name__ == "__main__":
    main()
