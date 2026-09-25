#!/usr/bin/env python3
"""
TransferSportal — weekly data builder (free, no API key).

Backtested model (built on 2024, graded on 2025):
    score = 0.40*season_hit_rate + 0.40*red_zone_volume + 0.20*vegas_team_total
    prob  = calibrated logistic of score  ->  P(scores a TD)
Top-12 picks hit ~55% in backtest vs ~48% for a naive baseline.

Modes (auto):
  PRESEASON  (current season has no games): stats/red-zone come from LAST season,
             team totals + matchups come from the CURRENT season's upcoming week.
  IN-SEASON: everything from the current season to date.

Usage: python update.py 2026      # current season
Writes data.json next to index.html. Run weekly via the GitHub Action.
"""
import io, os, sys, json, urllib.request
import numpy as np, pandas as pd

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI"}
OUT_REASON = {"PUP":"PUP (out 4+ wks)","EXE":"exempt list","SUS":"suspended",
              "RES":"reserve/IR","RSR":"reserve/IR","RSN":"reserve","RLS":"released","DEV":"practice squad"}
# How the model's stated probability maps to what actually happened, measured on
# 10,616 out-of-sample player-weeks. The site uses this to turn a model % into a
# true % before comparing it with a price.
CALIBRATION_CURVE = [[10.3, 9.7], [19.2, 22.3], [29.4, 33.5],
                     [39.6, 38.0], [49.8, 43.2], [62.1, 58.3]]
CONF_PENALTY = {"High": 0.0, "Medium": -2.0, "Low": -5.0}   # bet-score points

# Extra prop markets off the same score. Fitted on one season, graded on the next:
#   2+ TDs   top bucket predicted 9.5% / actual 10.0%   top-12 19.9% vs 17.1% baseline
#   first TD top bucket predicted 10.6% / actual 10.1%  top-12 17.6% vs 13.0% baseline
MARKETS = {
    "anytime":  None,                                  # uses CALIB_POS
    "first_td": {"b0": -4.281, "b1": 3.619},
    "two_plus": {"b0": -4.887, "b1": 4.390},
}
MATCHUP_WEIGHT = 25.0        # points per unit of the offence-vs-defence index

# 2026 NFL Preseason team totals, sourced footballdb.com, snapshot 2026-09-03.
# Format: team -> [games, rush_yds, rush_ypg, pass_yds, pass_ypg, tot_yds, tot_ypg, pts_pg]
PRE_OFF = {
"ARI":[4,600,150.0,1010,252.5,1610,402.5,27.0],"CHI":[3,275,91.7,875,291.7,1150,383.3,22.3],
"BAL":[3,395,131.7,743,247.7,1138,379.3,26.0],"DAL":[3,403,134.3,676,225.3,1079,359.7,25.0],
"BUF":[3,378,126.0,652,217.3,1030,343.3,29.3],"LA":[3,392,130.7,632,210.7,1024,341.3,24.7],
"CIN":[3,372,124.0,650,216.7,1022,340.7,24.3],"LAC":[3,376,125.3,626,208.7,1002,334.0,20.7],
"DEN":[3,333,111.0,663,221.0,996,332.0,24.7],"NYG":[3,377,125.7,615,205.0,992,330.7,19.7],
"LV":[3,375,125.0,593,197.7,968,322.7,16.0],"CAR":[4,448,112.0,804,201.0,1252,313.0,24.2],
"NE":[3,337,112.3,602,200.7,939,313.0,16.7],"ATL":[3,263,87.7,669,223.0,932,310.7,19.3],
"SF":[3,376,125.3,548,182.7,924,308.0,24.0],"DET":[3,484,161.3,425,141.7,909,303.0,18.7],
"KC":[3,384,128.0,517,172.3,901,300.3,12.0],"NO":[3,330,110.0,566,188.7,896,298.7,15.7],
"CLE":[3,358,119.3,529,176.3,887,295.7,18.0],"PIT":[3,267,89.0,592,197.3,859,286.3,18.3],
"JAX":[3,284,94.7,558,186.0,842,280.7,20.0],"TEN":[3,380,126.7,435,145.0,815,271.7,17.7],
"MIN":[3,265,88.3,541,180.3,806,268.7,7.3],"WAS":[3,284,94.7,470,156.7,754,251.3,12.0],
"IND":[3,252,84.0,496,165.3,748,249.3,11.7],"GB":[3,264,88.0,477,159.0,741,247.0,28.0],
"NYJ":[3,224,74.7,487,162.3,711,237.0,13.0],"SEA":[3,278,92.7,395,131.7,673,224.3,10.7],
"PHI":[3,236,78.7,434,144.7,670,223.3,13.7],"HOU":[3,270,90.0,331,110.3,601,200.3,13.3],
"TB":[3,224,74.7,350,116.7,574,191.3,13.3],"MIA":[3,245,81.7,319,106.3,564,188.0,7.3],
}
# defense: yards ALLOWED
PRE_DEF = {
"NYG":[3,232,77.3,247,82.3,479,159.7,7.3],"BUF":[3,242,80.7,385,128.3,627,209.0,16.0],
"BAL":[3,216,72.0,419,139.7,635,211.7,4.3],"PIT":[3,214,71.3,500,166.7,714,238.0,18.0],
"DET":[3,166,55.3,562,187.3,728,242.7,15.0],"JAX":[3,259,86.3,490,163.3,749,249.7,18.0],
"ATL":[3,325,108.3,434,144.7,759,253.0,15.0],"SF":[3,348,116.0,411,137.0,759,253.0,16.0],
"DEN":[3,266,88.7,494,164.7,760,253.3,15.3],"TB":[3,281,93.7,486,162.0,767,255.7,16.7],
"CIN":[3,285,95.0,521,173.7,806,268.7,12.0],"DAL":[3,411,137.0,396,132.0,807,269.0,15.7],
"LAC":[3,405,135.0,423,141.0,828,276.0,22.7],"KC":[3,246,82.0,583,194.3,829,276.3,15.0],
"MIN":[3,229,76.3,626,208.7,855,285.0,19.0],"LV":[3,380,126.7,488,162.7,868,289.3,21.7],
"NYJ":[3,341,113.7,547,182.3,888,296.0,15.7],"CHI":[3,257,85.7,662,220.7,919,306.3,17.3],
"WAS":[3,481,160.3,480,160.0,961,320.3,21.7],"SEA":[3,420,140.0,548,182.7,968,322.7,15.0],
"TEN":[3,308,102.7,663,221.0,971,323.7,17.7],"CAR":[4,455,113.8,857,214.2,1312,328.0,22.2],
"LA":[3,434,144.7,567,189.0,1001,333.7,10.0],"MIA":[3,347,115.7,656,218.7,1003,334.3,21.0],
"NO":[3,360,120.0,648,216.0,1008,336.0,27.3],"NE":[3,389,129.7,646,215.3,1035,345.0,23.7],
"ARI":[4,502,125.5,888,222.0,1390,347.5,30.8],"HOU":[3,362,120.7,705,235.0,1067,355.7,21.7],
"CLE":[3,334,111.3,740,246.7,1074,358.0,26.0],"IND":[3,433,144.3,659,219.7,1092,364.0,24.0],
"GB":[3,308,102.7,794,264.7,1102,367.3,26.3],"PHI":[3,493,164.3,755,251.7,1248,416.0,27.3],
}
PRE_SNAPSHOT_DATE = "2026-09-03"
# ^ 2026 preseason team totals, footballdb.com. No official feed exists for
# preseason games (nflverse tracks REG/playoffs only), so this is a one-time
# manual snapshot rather than something the weekly job can refresh. It stays
# out of the score -- there is no way to grade whether preseason predicted
# anything, because the season it would predict has not happened yet.

CALIB_POS = {  # per-position score->P(TD), fitted on 2025
    "RB": {"b0": -2.861, "b1": 4.096}, "WR": {"b0": -2.956, "b1": 4.755},
    "TE": {"b0": -2.858, "b1": 4.930}, "QB": {"b0": -2.999, "b1": 4.421},
}
CALIB = {"b0": -2.816, "b1": 4.229}          # fallback (all positions)
# Calibration for the low-shrink probability track. Fitted on 2025 in the same
# arithmetic this file scores with, then graded on 2024, which the fit never saw:
# Brier 0.1416 vs 0.1423 for the old track, and the early-season gap on the top
# 200 goes from -5.6% to -0.0%.
CALIB_POS_PROB = {
    "RB": {"b0": -2.872, "b1": 4.392}, "WR": {"b0": -2.939, "b1": 5.005},
    "TE": {"b0": -2.909, "b1": 5.257}, "QB": {"b0": -2.948, "b1": 4.070},
}
CALIB_PROB = {"b0": -2.900, "b1": 4.600}     # fallback for the probability track
W_SEASON, W_TT, W_RZ10, W_RZ5, W_YDS = 0.32, 0.16, 0.16, 0.16, 0.20
WK1_PAIRS = [("NE","SEA"),("SF","LA"),("CHI","CAR"),("TB","CIN"),("NO","DET"),("BUF","HOU"),
             ("BAL","IND"),("CLE","JAX"),("ATL","PIT"),("NYJ","TEN"),("ARI","LAC"),("MIA","LV"),
             ("GB","MIN"),("WAS","PHI"),("DAL","NYG"),("DEN","KC")]


BOARD_DIR = "boards"
# Public repo, so the page can link each archived board to its commit history --
# GitHub's timestamps are the part a stranger can actually verify.
# NOTE: this string is published on the track-record page. It must be an account
# name that carries no personal identity, because the verification link is the
# one thing every visitor is invited to click.
REPO = "TransferSportal/TransferSportal"

def archive_board(players, predict_week):
    """Save this week's ranking so a later run can grade it.

    WRITE ONCE PER WEEK. The first run of a new slate locks that week's picks
    and every later run leaves the file alone.

    This matters because the builder runs on a daily schedule. Without the lock,
    Monday's run would rebuild Week N's board from stats that ALREADY CONTAIN
    Sunday's results and overwrite the picks -- and then grade those picks
    against the same games. That is look-ahead leakage: the record would climb
    every week and none of it would be real. A track record nobody can trust is
    worth less than no track record at all, so the file is immutable once
    written and the lock time is stamped inside it.

    Only the fields grading needs are kept, so the files stay small enough to
    live in the repo, where the commit history is the public timestamp.
    """
    os.makedirs(BOARD_DIR, exist_ok=True)
    slug = predict_week.replace(" ", "-").lower()
    path = f"{BOARD_DIR}/{slug}.json"
    if os.path.exists(path):
        try:
            locked = json.load(open(path)).get("archived")
        except Exception:
            locked = None
        print(f"{path} already locked at {locked} -- leaving it alone")
        return path
    # Archived in ranking order, which is what the site shows and therefore what
    # the live record grades. Score decides the order; prob rides along as the
    # price that was quoted at the time.
    rows = [{"name": p["name"], "pos": p["pos"], "team": p["team"],
             "prob": p["prob"], "score": p["score"], "rostered": p.get("rostered", True)}
            for p in sorted(players, key=lambda x: (-x["score"], -x["prob"]))[:60]]
    json.dump({"predict_week": predict_week,
               "archived": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
               "archive_note": "locked on first build of this slate; never rewritten",
               "players": rows},
              open(path, "w"), separators=(",", ":"))
    print(f"{path} locked -- {len(rows)} picks recorded for {predict_week}")
    return path

def grade_archives(season, results, complete_weeks=None):
    """Grade every archived board whose week has since been played.

    `results` is the season's player-week table. Only players who actually had
    a stat line are graded -- a pick who was inactive is dropped rather than
    counted as a miss, which is how the weekly hit rate has always been read.
    """
    out = []
    if not os.path.isdir(BOARD_DIR):
        return out
    for fn in sorted(os.listdir(BOARD_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            board = json.load(open(os.path.join(BOARD_DIR, fn)))
            wk = int(str(board["predict_week"]).split()[-1])
        except Exception:
            continue
        played_wk = results[results.week == wk]
        if not len(played_wk):
            continue                                   # not played yet
        # A single Thursday night game is enough to make a week appear in the
        # stats file. Grading on that would publish a 0/0 or a one-game record
        # mid-week and then silently change it by Monday. A week is graded once
        # it is actually finished.
        if complete_weeks is not None and wk not in complete_weeks:
            print(f"  week {wk} still in progress -- not grading it yet")
            continue
        played = set(played_wk.player_display_name)
        scored = set(played_wk[played_wk.any_td > 0].player_display_name)
        ranked = [x for x in board["players"] if x.get("rostered") is not False]
        row = {"week": wk, "predict_week": board.get("predict_week"),
               "archived": board.get("archived"), "file": fn,
               "archive_note": board.get("archive_note")}
        for n in (5, 12, 24):
            graded = [x for x in ranked[:n] if x["name"] in played]
            hits = [x for x in graded if x["name"] in scored]
            row[f"top{n}"] = len(hits)
            row[f"top{n}_of"] = len(graded)
        skill = played_wk[played_wk.position.isin(["RB", "WR", "TE", "QB"])]
        row["base_rate"] = round(float((skill.any_td > 0).mean()), 4) if len(skill) else None
        # per-pick outcome, so the record can be read rather than just totalled
        td_by = played_wk.groupby("player_display_name").any_td.sum().to_dict()
        picks = []
        for i, x in enumerate(ranked[:24], 1):
            nm = x["name"]
            picks.append({"rank": i, "name": nm, "pos": x["pos"], "team": x["team"],
                          "prob": x["prob"],
                          "result": "dnp" if nm not in played else ("hit" if nm in scored else "miss"),
                          "tds": int(td_by.get(nm, 0))})
        row["picks"] = picks
        out.append(row)
    return out

def url(p): return f"{BASE}/{p}"
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent":"Mozilla/5.0"}), timeout=180).read()
def load(u): return pd.read_csv(io.BytesIO(get(u)), low_memory=False)
def try_load(u):
    try: return load(u)
    except Exception as e: print("skip:", u.split('/')[-1], e); return None

def stats_for(season):
    for p in (f"stats_player/stats_player_week_{season}.csv", f"player_stats/stats_player_week_{season}.csv"):
        d = try_load(url(p))
        if d is not None: return d
    return None

def redzone_pg(season, games_by_pid):
    """inside-10 and inside-5 (goal line) touches per game, per player, for a season."""
    cols = ["season_type","yardline_100","rush_attempt","pass_attempt","rusher_player_id","receiver_player_id"]
    d = try_load(url(f"pbp/play_by_play_{season}.csv"))
    if d is None: return {}, {}
    d = d[d.season_type=="REG"]
    def per(line):
        z = d[d.yardline_100<=line]
        r = z[z.rush_attempt==1][["rusher_player_id"]].rename(columns={"rusher_player_id":"pid"})
        p = z[z.pass_attempt==1][["receiver_player_id"]].rename(columns={"receiver_player_id":"pid"})
        tot = pd.concat([r,p]).dropna().groupby("pid").size()
        return {pid: round(tot.get(pid,0)/max(games_by_pid.get(pid,1),1), 3) for pid in games_by_pid}
    return per(10), per(5)

def role_of(pos, rank):
    if pd.isna(rank): return ""
    rank=int(rank)
    return {"QB":"" if rank==1 else f"QB{rank}","RB":"" if rank==1 else f"RB{rank}",
            "TE":"" if rank==1 else f"TE{rank}","WR":"" if rank<=3 else f"WR{rank}"}.get(pos,"")

def carry_prices(path="data.json", for_week=None):
    """Carry prices forward ONLY when they were captured for the same slate.

    A sportsbook reprices every week. Carrying last week's anytime-TD numbers
    into this week's board silently turns every edge into model-vs-a-stale-price
    -- which is worse than showing no price at all, because it looks authoritative.
    So the prices are stamped with the week they belong to and dropped the moment
    the slate moves on. odds.py overwrites them whenever it can reach the feed.
    """
    try:
        old = json.load(open(path))
    except Exception:
        return {}, {}, None
    meta = old.get("meta", {})
    odds_meta = meta.get("odds") or {}
    # the week these prices were for: stamped since Week 3, else inferred from
    # the predict_week of the file that carried them
    priced_week = odds_meta.get("for_week") or meta.get("predict_week")
    if for_week is not None and priced_week != for_week:
        return {}, {}, priced_week
    keep = {p["name"]: {k: p[k] for k in ("dk_odds", "book_prob", "edge") if k in p}
            for p in old.get("players", []) if "dk_odds" in p}
    return keep, {"odds": odds_meta or None, "book_bias": meta.get("book_bias")}, priced_week

def prior_anchors(season):
    """Last season's per-player rates, used as the shrinkage anchor.

    THE PROBLEM THIS SOLVES. In week 3 a player has two games. The board shrinks
    that toward the POSITION AVERAGE, so a workhorse back who has not scored yet
    is indistinguishable from any other back, and a backup who vultured one
    score outranks him. Live on the 2026 week 3 card that put Saquon Barkley
    fifth on Philadelphia behind a backup. Anyone who watches football sees that
    and stops trusting the board, and they are right to.

    A player's own prior season is a far better guess at his rate than the
    average of everyone who plays his position. Graded in backtest_earlyweeks.py,
    walking forward across 2024 and 2025: top-12 hit rate +8.3 points in weeks
    1 to 4 and +4.2 points in weeks 5 and later.

    A short prior is a weak prior, so each anchor is itself pulled toward the
    position mean by how few games it rests on. A player with no prior season at
    all, a rookie, simply falls back to the position mean as before.

    Returns dicts keyed by player_id. Missing keys are the caller's cue to fall
    back, which is why nothing is filled in with a default here.
    """
    d = stats_for(season)
    if d is None:
        print(f"no {season} stats available -- shrinking toward position means only")
        return {}, {}, {}, {}, {}
    d = d[d.season_type == "REG"].copy()
    d["position"] = d.position.replace({"FB": "RB"})
    d = d[d.position.isin(["RB", "WR", "TE", "QB"])].copy()
    for c in ("rushing_tds", "receiving_tds", "rushing_yards", "receiving_yards"):
        d[c] = d[c].fillna(0)
    d["any_td"] = d.rushing_tds + d.receiving_tds
    d["yds"] = d.rushing_yards + d.receiving_yards
    g = d.groupby("player_id").week.nunique().to_dict()
    hit = {p: round(float((s.any_td > 0).sum()) / max(g.get(p, 1), 1), 4)
           for p, s in d.groupby("player_id")}
    yds = {p: round(float(s.yds.sum()) / max(g.get(p, 1), 1), 1)
           for p, s in d.groupby("player_id")}
    rz10, rz5 = redzone_pg(season, g)
    print(f"prior-season anchors from {season}: {len(hit)} players")
    return hit, rz10, rz5, yds, g


def build():
    cur = stats_for(SEASON); cur_reg = cur[cur.season_type=="REG"] if cur is not None else None
    weeks_played = int(cur_reg.week.nunique()) if cur_reg is not None and len(cur_reg) else 0
    have_current = weeks_played > 0                       # any 2026 games exist yet
    in_season = have_current                              # strictly current-season once any exists
    stat_season = SEASON if in_season else SEASON-1
    print(f"mode: {'IN-SEASON (2026-only)' if in_season else 'PRESEASON'} | "
          f"{weeks_played} week(s) played | stats {stat_season} | lines {SEASON}")

    # Last season, loaded so a two-game sample has something better than the
    # position average to shrink toward. See prior_anchors above.
    PR_HIT, PR_RZ10, PR_RZ5, PR_YDS, PR_G = prior_anchors(stat_season - 1)

    df = stats_for(stat_season)
    df = df[df.season_type=="REG"].copy()
    df["team"]=df.team.replace(TEAM_FIX); df["opponent_team"]=df.opponent_team.replace(TEAM_FIX)
    df["position"]=df.position.replace({"FB":"RB"}); df=df[df.position.isin(["RB","WR","TE","QB"])].copy()
    for c in ["passing_yards","rushing_yards","receiving_yards","passing_tds","rushing_tds","receiving_tds"]: df[c]=df[c].fillna(0)
    df["any_td"]=df.rushing_tds+df.receiving_tds

    games_by_pid = df.groupby("player_id").week.nunique().to_dict()
    rz10_pg, rz5_pg = redzone_pg(stat_season, games_by_pid)
    df["yds"] = df.rushing_yards + df.receiving_yards
    yds_tot = df.groupby("player_id").yds.sum().to_dict()
    yds_pg = {pid: round(yds_tot.get(pid, 0) / max(games_by_pid.get(pid, 1), 1), 1) for pid in games_by_pid}

    # schedule: upcoming week in SEASON -> team totals + opponents
    sch = load(url("schedules/games.csv"))
    ssn = sch[(sch.season==SEASON) & (sch.game_type=="REG")].copy()
    if have_current:
        # A week is "played" only when most of its games are actually final.
        # Counting any week that has a stat line rolls the board forward on
        # Friday morning, because Thursday night football alone is enough to
        # make the week appear in the stats file. That would show Week 4 picks
        # while Week 3 is still being played, grade Week 3 as 0/0, and lock a
        # Week 4 archive before its lines have settled -- every single week.
        done = ssn.groupby("week").home_score.apply(lambda s: s.notna().mean())
        complete = [int(w) for w, frac in done.items() if frac >= 0.75]
        settled = max(complete) if complete else 0
        up_week = min(settled + 1, int(ssn.week.max()))
        if settled != weeks_played:
            part = done.get(settled + 1, 0.0)
            print(f"week {settled+1} is {part*100:.0f}% complete -- still the current "
                  f"slate, not rolling forward")
        weeks_played = settled
    else:
        unplayed = ssn[ssn.home_score.isna()] if "home_score" in ssn else ssn
        up_week = int(unplayed.week.min()) if len(unplayed) else int(ssn.week.max())
    predict_week = f"{SEASON} Week {up_week}"
    prior_prices, prior_meta, priced_week = carry_prices(for_week=predict_week)
    if prior_prices:
        print(f"prices on file are for {priced_week} -- still the current slate, carrying {len(prior_prices)}")
    elif priced_week and priced_week != predict_week:
        print(f"prices on file were for {priced_week}, board is now {predict_week} -- dropped as stale")
    else:
        print("no prices on file -- paste the book's board to fill the odds column")

    wk = ssn[ssn.week==up_week]
    itt, next_opp, gline, games = {}, {}, {}, []
    for x in wk.itertuples():
        if not pd.isna(x.total_line):
            sp = x.spread_line if not pd.isna(x.spread_line) else 0
            itt[TEAM_FIX.get(x.home_team,x.home_team)] = round(x.total_line/2 + sp/2, 1)
            itt[TEAM_FIX.get(x.away_team,x.away_team)] = round(x.total_line/2 - sp/2, 1)
        h=TEAM_FIX.get(x.home_team,x.home_team); a=TEAM_FIX.get(x.away_team,x.away_team)
        next_opp[h]=a; next_opp[a]=h
        if not pd.isna(x.total_line):
            sp=x.spread_line if not pd.isna(x.spread_line) else 0
            gline[h]=(float(x.total_line), -float(sp)); gline[a]=(float(x.total_line), float(sp))
        games.append(dict(home=h, away=a,
            ou=(float(x.total_line) if not pd.isna(x.total_line) else None),
            spread_home=(-float(x.spread_line) if not pd.isna(x.spread_line) else None),
            day=str(getattr(x,"gameday","")), wd=str(getattr(x,"weekday",""))))
    if not next_opp:
        for a,b in WK1_PAIRS: next_opp[a]=b; next_opp[b]=a
    print(f"upcoming: {SEASON} week {up_week} | {len(itt)} team totals")

    # matchup context (not scored)
    dvp=df.groupby(["opponent_team","position"]).agg(t=("any_td","sum"),w=("week","nunique")).reset_index()
    dvp["pg"]=(dvp.t/dvp.w).round(3); lg=dvp.groupby("position").pg.mean().round(3).to_dict()
    dvp["idx"]=dvp.apply(lambda r:round(r.pg/lg[r.position],3) if lg[r.position] else 1.0,axis=1)
    dvp["soft_rank"]=dvp.groupby("position").pg.rank(ascending=False,method="min").astype(int)
    matchup={}
    for r in dvp.itertuples(): matchup.setdefault(r.opponent_team,{})[r.position]={"allowed_pg":r.pg,"idx":r.idx,"soft_rank":int(r.soft_rank)}

    # per-team per-position tables
    STAT=["rushing_yards","receiving_yards","passing_yards","rushing_tds","receiving_tds","passing_tds","any_td"]
    SH={"rushing_yards":"ruY","receiving_yards":"reY","passing_yards":"paY","rushing_tds":"ruT","receiving_tds":"reT","passing_tds":"paT","any_td":"aTD"}
    def pack(g): return {SH[s]:int(round(g[s])) for s in STAT}
    def sidew(col):
        G=df.groupby(col).week.nunique().to_dict(); tot=df.groupby(col)[STAT].sum(); pos=df.groupby([col,"position"])[STAT].sum(); o={}
        for t in G:
            rec={"G":int(G[t]),"total":pack(tot.loc[t]),"pos":{}}
            for pp in ["RB","WR","TE","QB"]: rec["pos"][pp]=pack(pos.loc[(t,pp)]) if (t,pp) in pos.index else {v:0 for v in SH.values()}
            o[t]=rec
        return o
    teams={t:{"off":sidew("team")[t],"def":sidew("opponent_team")[t]} for t in sidew("team")}
    PRE_KEYS=["G","ruY","ruYpg","paY","paYpg","totY","totYpg","ptsPg"]
    for t in teams:
        if t in PRE_OFF: teams[t]["pre_off"]=dict(zip(PRE_KEYS,PRE_OFF[t]))
        if t in PRE_DEF: teams[t]["pre_def"]=dict(zip(PRE_KEYS,PRE_DEF[t]))

    # Real 2026 season-to-date team tables -- always live from whatever games have
    # actually finished, independent of the player-model cutover above. A team with a
    # game still in progress just won't appear yet; it fills in on the next refresh.
    cur_weeks_note = ""
    player_box = []
    if have_current:
        cw = cur_reg.copy()
        cw["team"]=cw.team.replace(TEAM_FIX); cw["opponent_team"]=cw.opponent_team.replace(TEAM_FIX)
        cw["position"]=cw.position.replace({"FB":"RB"}); cw=cw[cw.position.isin(["RB","WR","TE","QB"])].copy()
        for c in STAT[:-1]: cw[c]=cw[c].fillna(0)
        cw["any_td"]=cw.rushing_tds+cw.receiving_tds
        def sidew_cur(col):
            G=cw.groupby(col).week.nunique().to_dict(); tot=cw.groupby(col)[STAT].sum(); pos=cw.groupby([col,"position"])[STAT].sum(); o={}
            for t in G:
                rec={"G":int(G[t]),"total":pack(tot.loc[t]),"pos":{}}
                for pp in ["RB","WR","TE","QB"]: rec["pos"][pp]=pack(pos.loc[(t,pp)]) if (t,pp) in pos.index else {v:0 for v in SH.values()}
                o[t]=rec
            return o
        cur_off_tbl, cur_def_tbl = sidew_cur("team"), sidew_cur("opponent_team")
        for t in teams:
            if t in cur_off_tbl: teams[t]["cur_off"]=cur_off_tbl[t]
            if t in cur_def_tbl: teams[t]["cur_def"]=cur_def_tbl[t]
        played_teams = sorted(set(cur_off_tbl) | set(cur_def_tbl))
        all32 = sorted(teams.keys())
        pending = [t for t in all32 if t not in played_teams]
        cur_weeks_note = (f"{SEASON} season-to-date through week {weeks_played}, {len(played_teams)} of 32 teams reporting"
                          + (f"; still waiting on {', '.join(pending)}" if pending else "") + ".")

        # Individual box scores for the Player Stats tab. Full pool, not a hand-picked
        # sample -- every RB/WR/TE/QB with a stat line this season, real column names.
        opp_by_team = {}
        for gm in cw[["team","opponent_team"]].drop_duplicates().itertuples():
            opp_by_team[gm.team] = gm.opponent_team
        box = cw.groupby(["player_id","player_display_name","position","team"]).agg(
            week=("week","max"), opp=("opponent_team","last"),
            pass_yds=("passing_yards","sum"), pass_td=("passing_tds","sum"),
            att=("attempts","sum"), cmp=("completions","sum"), ints=("passing_interceptions","sum"),
            rush_yds=("rushing_yards","sum"), rush_td=("rushing_tds","sum"), carries=("carries","sum"),
            rec=("receptions","sum") if "receptions" in cw.columns else ("targets","sum"),
            rec_yds=("receiving_yards","sum"), rec_td=("receiving_tds","sum"), tgt=("targets","sum"),
        ).reset_index()
        player_box = []
        for r in box.itertuples():
            player_box.append(dict(name=r.player_display_name, pos=r.position, team=r.team, opp=r.opp,
                pass_yds=int(r.pass_yds), pass_td=int(r.pass_td), att=int(r.att), cmp=int(r.cmp), ints=int(r.ints),
                rush_yds=int(r.rush_yds), rush_td=int(r.rush_td), carries=int(r.carries),
                rec=int(r.rec), rec_yds=int(r.rec_yds), rec_td=int(r.rec_td), tgt=int(r.tgt)))
        print(f"current-season team tables: {len(played_teams)}/32 teams" + (f" (pending: {pending})" if pending else ""))

    # Matchup lens: own offense in a phase x opponent defense allowing it, indexed to league
    # average. Shown for judgement only, NOT in the score -- backtests on 2024 and 2025 showed
    # every weighted version made the top picks worse, because the Vegas team total already
    # prices most of it (r = .47 run, .57 pass).
    _G = 17.0
    def _ix(m):
        avg = (sum(m.values())/len(m)) if m else 1.0
        return {k: (v/avg if avg else 1.0) for k, v in m.items()}
    def _side_for(t, key):
        node = teams[t].get(key)
        return node if node else None
    _mu_off_key = "cur_off" if have_current else "off"
    _mu_def_key = "cur_def" if have_current else "def"
    def _rate(t, key, cats):
        node = _side_for(t, key)
        if node is None: return None
        gg = node.get("G") or 1
        return sum(node["pos"].get(c, {}).get(y, 0) for c, y in cats) / gg
    RB_Y = [("RB", "ruY")]; PASS_Y = [("WR", "reY"), ("TE", "reY")]
    o_run_raw = {t: _rate(t, _mu_off_key, RB_Y) for t in teams}; o_run_raw = {k:v for k,v in o_run_raw.items() if v is not None}
    d_run_raw = {t: _rate(t, _mu_def_key, RB_Y) for t in teams}; d_run_raw = {k:v for k,v in d_run_raw.items() if v is not None}
    o_pass_raw= {t: _rate(t, _mu_off_key, PASS_Y) for t in teams}; o_pass_raw = {k:v for k,v in o_pass_raw.items() if v is not None}
    d_pass_raw= {t: _rate(t, _mu_def_key, PASS_Y) for t in teams}; d_pass_raw = {k:v for k,v in d_pass_raw.items() if v is not None}
    o_run,d_run,o_pass,d_pass=_ix(o_run_raw),_ix(d_run_raw),_ix(o_pass_raw),_ix(d_pass_raw)

    # rosters + depth overlay
    ros=try_load(url(f"rosters/roster_{SEASON}.csv"))
    if ros is not None:
        ros["team"]=ros.team.replace(TEAM_FIX); ros=ros[["gsis_id","team","status"]].rename(columns={"gsis_id":"player_id","team":"cur_team"})
    dc=try_load(url(f"depth_charts/depth_charts_{SEASON}.csv")); dcrank=None
    if dc is not None and "pos_rank" in dc:
        dc=dc[dc.pos_abb.isin(["QB","RB","WR","TE","FB"])].copy(); dc["dt"]=pd.to_datetime(dc.get("dt"),errors="coerce")
        dcrank=dc.sort_values("dt").groupby("gsis_id").tail(1)[["gsis_id","pos_rank"]].rename(columns={"gsis_id":"player_id"})

    # positional means for mover regression (qualifying pool)
    MIN_G = 6 if not have_current else 1     # can't require 6 games in week 1 of a new season
    q=df.groupby("player_id").agg(g=("week","nunique"),tdg=("any_td",lambda s:(s>0).sum()),pos=("position","first"))
    q=q[q.g>=MIN_G].copy(); q["hit"]=q.tdg/q.g; q["rz10"]=[rz10_pg.get(i,0.0) for i in q.index]; q["rz5"]=[rz5_pg.get(i,0.0) for i in q.index]; q["yds"]=[yds_pg.get(i,0.0) for i in q.index]
    posmean_hit=q.groupby("pos").hit.mean().to_dict(); posmean_rz10=q.groupby("pos").rz10.mean().to_dict()
    posmean_rz5=q.groupby("pos").rz5.mean().to_dict(); posmean_yds=q.groupby("pos").yds.mean().to_dict()
    # Small-sample shrinkage toward the position mean, applied to EVERY player (not just
    # movers) once we're strictly on current-season data. K=4 means a 1-game sample gets
    # pulled 80% toward the position average; it fades toward 0 as real games accumulate
    # (roughly half-weight by game 4, a sixth by game 20). This is what keeps a single
    # touchdown from reading as "100% chance to score" this week.
    SHRINK_K = 4.0
    # The ranking and the probability want different amounts of shrinkage, so
    # they get their own tracks. Heavy shrinkage (K=4) orders the board well and
    # keeps a one-game sample from producing nonsense. But it also squashes every
    # score toward the middle, which makes the probability run low on exactly the
    # players it is most confident about -- measured at -5.6 points on the top 200
    # early in a season, graded out of sample. A lighter K=1.5 with its own
    # calibration closes that to 0.0 and improves Brier in both windows, while
    # costing nothing in ranking. See fit_prob_calibration.py.
    PROB_SHRINK_K = 1.5
    # Expected DISTINCT scorers for a team from its implied total, fitted on
    # real games in backtest_teamnorm.py. 2024 gave -0.04 + 0.0916*pts and 2025
    # gave -0.00 + 0.0887*pts, so the average is used and the two seasons
    # agreeing this closely is the reason it is trusted at all.
    SCORERS_A, SCORERS_B = -0.02, 0.0902
    # How much to trust last season's number as this player's anchor. A full
    # season stands on its own; four games does not, so a short prior is itself
    # pulled toward the position mean rather than used raw.
    PRIOR_FULL = 8.0
    def anchor(pid, pos, prior, posmean, fallback):
        pm = posmean.get(pos, fallback)
        v = prior.get(pid)
        if v is None:
            return pm                       # rookie or no prior season: as before
        t = min(PR_G.get(pid, 0) / PRIOR_FULL, 1.0)
        return t * v + (1 - t) * pm

    MOVE_K=0.4
    sig=lambda x:1/(1+np.exp(-x))
    players=[]
    for pid,sub in df.sort_values("week").groupby("player_id"):
        sub=sub.sort_values("week"); g=sub.week.nunique()
        if g<MIN_G: continue
        tds=int(sub.any_td.sum())
        if not have_current and tds<3: continue     # week-1-of-season: can't require 3 TDs yet
        tp=sub.team.iloc[-1]; l5=sub.tail(5); pos=sub.position.iloc[-1]
        rostered,cur=True,tp
        if ros is not None:
            hit=ros[ros.player_id==pid]; onroster=len(hit)>0
            status=hit.status.iloc[0] if onroster else None
            cur=hit.cur_team.iloc[0] if onroster else tp
            rostered=(status=="ACT")
        rank=None
        if dcrank is not None:
            h=dcrank[dcrank.player_id==pid]; rank=int(h.pos_rank.iloc[0]) if len(h) else None
        moved=bool(ros is not None and rostered and tp!=cur)
        out_reason=("" if (ros is None or rostered) else (OUT_REASON.get(status,"not active") if onroster else "not on 53-man"))
        gw=[int(x) for x in sub.week.tolist()]; gt=[int(x) for x in sub.any_td.tolist()]
        go=[str(x) for x in sub.opponent_team.tolist()]
        cpts=2; cnote=[]
        if not rostered: cpts=-9
        if moved: cpts-=2; cnote.append("new team")
        if rank and rank>=3: cpts-=2; cnote.append("buried on depth chart")
        elif rank==2: cpts-=1; cnote.append("backup/committee")
        if g<10: cpts-=1; cnote.append("small sample ("+str(g)+" g)")
        conf=("High" if cpts>=2 else ("Medium" if cpts>=1 else "Low"))
        season_hit=round(int((sub.any_td>0).sum())/g,3)
        rz10=rz10_pg.get(pid,0.0); rz5=rz5_pg.get(pid,0.0); ypg=yds_pg.get(pid,0.0)
        team_itt=itt.get(cur) if rostered else None
        eff_hit,eff_10,eff_5,eff_y=season_hit,rz10,rz5,ypg
        if have_current:
            # universal small-sample shrinkage toward this season's own position means
            w = SHRINK_K/(SHRINK_K+g)
            eff_hit=(1-w)*season_hit+w*anchor(pid,pos,PR_HIT,posmean_hit,season_hit)
            eff_10 =(1-w)*rz10+w*anchor(pid,pos,PR_RZ10,posmean_rz10,rz10)
            eff_5  =(1-w)*rz5+w*anchor(pid,pos,PR_RZ5,posmean_rz5,rz5)
            eff_y  =(1-w)*ypg+w*anchor(pid,pos,PR_YDS,posmean_yds,ypg)
        elif moved:
            eff_hit=(1-MOVE_K)*season_hit+MOVE_K*posmean_hit.get(pos,season_hit)
            eff_10=(1-MOVE_K)*rz10+MOVE_K*posmean_rz10.get(pos,rz10)
            eff_5=(1-MOVE_K)*rz5+MOVE_K*posmean_rz5.get(pos,rz5)
            eff_y=(1-MOVE_K)*ypg+MOVE_K*posmean_yds.get(pos,ypg)
        rz10N=min(eff_10/2.5,1.0); rz5N=min(eff_5/1.2,1.0); ydN=min(eff_y/90.0,1.0)
        ittN=(min(max((team_itt-15)/13,0),1) if team_itt is not None else 0.5)
        s01=W_SEASON*eff_hit+W_TT*ittN+W_RZ10*rz10N+W_RZ5*rz5N+W_YDS*ydN

        # probability track: same inputs, lighter shrinkage, own calibration
        if have_current:
            wp = PROB_SHRINK_K/(PROB_SHRINK_K+g)
            pf_hit=(1-wp)*season_hit+wp*anchor(pid,pos,PR_HIT,posmean_hit,season_hit)
            pf_10 =(1-wp)*rz10+wp*anchor(pid,pos,PR_RZ10,posmean_rz10,rz10)
            pf_5  =(1-wp)*rz5+wp*anchor(pid,pos,PR_RZ5,posmean_rz5,rz5)
            pf_y  =(1-wp)*ypg+wp*anchor(pid,pos,PR_YDS,posmean_yds,ypg)
        else:
            pf_hit,pf_10,pf_5,pf_y = eff_hit,eff_10,eff_5,eff_y
        p01=(W_SEASON*pf_hit+W_TT*ittN+W_RZ10*min(pf_10/2.5,1.0)
             +W_RZ5*min(pf_5/1.2,1.0)+W_YDS*min(pf_y/90.0,1.0))
        cp=CALIB_POS_PROB.get(pos,CALIB_PROB)
        gl=gline.get(cur,(None,None)) if rostered else (None,None)
        players.append(dict(name=sub.player_display_name.iloc[-1],pos=pos,team=cur,team_prev=(tp if moved else ""),
            moved=moved,rostered=rostered,rank=rank,role=role_of(pos,rank),
            games=int(g),td_games=int((sub.any_td>0).sum()),tds=tds,season_hit=season_hit,
            l5_hit=round(float((l5.any_td>0).mean()),3),l5_gp=int(len(l5)),l5_hits=int((l5.any_td>0).sum()),
            rz_pg=rz10,gl_pg=rz5,yds_pg=ypg,eff_hit=round(eff_hit,3),eff_rz10=round(eff_10,3),eff_rz5=round(eff_5,3),eff_yds=round(eff_y,1),itt=team_itt,score=round(s01*100),
            pf_hit=round(pf_hit,3),pf_rz10=round(pf_10,3),pf_rz5=round(pf_5,3),pf_yds=round(pf_y,1),
            prob=round(float(sig(cp["b0"]+cp["b1"]*p01)),3),
            prob_first=round(float(sig(MARKETS["first_td"]["b0"]+MARKETS["first_td"]["b1"]*p01)),4),
            prob_two=round(float(sig(MARKETS["two_plus"]["b0"]+MARKETS["two_plus"]["b1"]*p01)),4),
            conf=conf,conf_note=", ".join(cnote),out_reason=out_reason,gw=gw,gt=gt,go=go,
            ou=gl[0],spread=gl[1],regressed=bool(moved),
            next_opp=(next_opp.get(cur,"") if rostered else "")))
    # --- Rookie / no-2025-data projected starters (role-based projection) ---
    try:
        have=set(df.player_id.unique())
        pinfo=df.groupby("player_id").agg(pos=("position","first"),team=("team","last"))
        pool10,pool5={},{}
        for pid in games_by_pid:
            if pid in pinfo.index:
                key=(pinfo.loc[pid,"team"],pinfo.loc[pid,"pos"])
                pool10[key]=pool10.get(key,0)+rz10_pg.get(pid,0)*games_by_pid[pid]
                pool5[key]=pool5.get(key,0)+rz5_pg.get(pid,0)*games_by_pid[pid]
        pool10={k:v/17 for k,v in pool10.items()}; pool5={k:v/17 for k,v in pool5.items()}
        rosf=try_load(url(f"rosters/roster_{SEASON}.csv"))
        dca=try_load(url(f"depth_charts/depth_charts_{SEASON}.csv"))
        if rosf is not None and dca is not None:
            rosf["team"]=rosf.team.replace(TEAM_FIX)
            expmap=rosf.set_index("gsis_id").years_exp.to_dict(); nmmap=rosf.set_index("gsis_id").full_name.to_dict()
            teammap=rosf.set_index("gsis_id").team.to_dict()
            dca=dca[dca.pos_abb.isin(["QB","RB","WR","TE"])].copy(); dca["dt"]=pd.to_datetime(dca.get("dt"),errors="coerce")
            latest=dca.sort_values("dt").groupby("gsis_id").tail(1)
            SHARE={("RB",1):0.55,("RB",2):0.28,("WR",1):0.30,("WR",2):0.24,("WR",3):0.16,("TE",1):0.65,("QB",1):0.85}
            BASE_HIT={("RB",1):0.45,("RB",2):0.28,("WR",1):0.33,("WR",2):0.24,("WR",3):0.16,("TE",1):0.24,("QB",1):0.30}
            THR={"RB":2,"WR":3,"TE":1,"QB":1}
            for r in latest.itertuples():
                pid=r.gsis_id; pos=r.pos_abb; rank=int(r.pos_rank)
                stt=rosf[rosf.gsis_id==pid]
                if len(stt) and stt.status.iloc[0]!="ACT": continue
                if pid in have or rank>THR.get(pos,1): continue
                team=teammap.get(pid,getattr(r,"team",None))
                if team is None or team not in itt and not rostered: pass
                share=SHARE.get((pos,rank),0.1)
                rz10p=round(pool10.get((team,pos),0.4)*share,3); rz5p=round(pool5.get((team,pos),0.2)*share,3)
                bh=BASE_HIT.get((pos,rank),0.25); team_itt=itt.get(team)
                ypj=round(posmean_yds.get(pos,40.0)*(share/0.3),1)
                rz10N=min(rz10p/2.5,1); rz5N=min(rz5p/1.2,1); ydN=min(ypj/90.0,1)
                ittN=(min(max((team_itt-15)/13,0),1) if team_itt is not None else 0.5)
                s01=W_SEASON*bh+W_TT*ittN+W_RZ10*rz10N+W_RZ5*rz5N+W_YDS*ydN
                # Projected players have no games played, so there is nothing to
                # shrink: both tracks see the same inputs and differ only in
                # which calibration converts them.
                cc=CALIB_POS_PROB.get(pos,CALIB_PROB); gl=gline.get(team,(None,None))
                rookie=(expmap.get(pid,1)==0)
                players.append(dict(name=nmmap.get(pid,"?"),pos=pos,team=team,team_prev="",moved=False,
                    rostered=True,rank=rank,role=("" if (pos in("RB","QB","TE") and rank==1) or (pos=="WR" and rank<=3) else f"{pos}{rank}"),
                    games=0,td_games=0,tds=0,season_hit=bh,l5_hit=0.0,l5_gp=0,l5_hits=0,
                    rz_pg=rz10p,gl_pg=rz5p,yds_pg=ypj,eff_hit=round(bh,3),eff_rz10=rz10p,eff_rz5=rz5p,eff_yds=ypj,itt=team_itt,
                    pf_hit=round(bh,3),pf_rz10=rz10p,pf_rz5=rz5p,pf_yds=ypj,
                    score=round(s01*100),prob=round(float(sig(cc["b0"]+cc["b1"]*s01)),3),
                    conf="Low",conf_note=("rookie · role projection" if rookie else f"no {SEASON} snaps yet · role projection"),
                    prob_first=round(float(sig(MARKETS["first_td"]["b0"]+MARKETS["first_td"]["b1"]*s01)),4),
                    prob_two=round(float(sig(MARKETS["two_plus"]["b0"]+MARKETS["two_plus"]["b1"]*s01)),4),
                    projected=True,out_reason="",gw=[],gt=[],go=[],ou=gl[0],spread=gl[1],
                    next_opp=next_opp.get(team,"")))
            print(f"projected starters added: {sum(1 for p in players if p.get('projected'))}")
    except Exception as e:
        print("projection step skipped:",e)

    for p in players:
        opp = p.get("next_opp") or ""
        phase = "run" if p["pos"] == "RB" else "pass"
        O, D = (o_run, d_run) if phase == "run" else (o_pass, d_pass)
        off_i, def_i = O.get(p["team"]), D.get(opp)
        if off_i is None or def_i is None:
            p["mu_phase"], p["mu_off"], p["mu_def"], p["mu"] = phase, None, None, None
        else:
            p["mu_phase"], p["mu_off"], p["mu_def"] = phase, round(off_i,3), round(def_i,3)
            p["mu"] = round(off_i*def_i, 3)
    _vals = sorted([p["mu"] for p in players if p.get("mu") is not None], reverse=True)
    for p in players:
        p["mu_rank"] = (_vals.index(p["mu"])+1) if p.get("mu") is not None else None

    if prior_prices:
        n = 0
        for p in players:
            keep = prior_prices.get(p["name"])
            if keep:
                p.update(keep); n += 1
        print(f"carried {n} existing prices into the rebuild")

    # ---- team consistency: make each team's probabilities add up ----------
    # A prop asks "does this player score at least once", so the probabilities
    # on one team should sum to the number of DIFFERENT players expected to
    # score. Nothing used to enforce that, and the board could put six Lions
    # above 40% in a game the projection only supports two or three scorers in.
    #
    # Expected distinct scorers is fitted on real games against points scored
    # (2024 and 2025 agree to three decimals). Note it is well below the
    # touchdown count -- a 24-point team averages 2.56 TDs but only 2.14
    # different scorers, because some of them score twice. Normalising to the TD
    # count instead inflates every team, which is exactly the mistake the
    # backtest caught.
    #
    # The shift is applied on the LOG-ODDS scale, so the order of players inside
    # a team never changes and nobody can be pushed outside 0..1.
    #
    # Applied to the PRICING track only. backtest_teamnorm.py: the constraint
    # improves Brier and cuts expected-scorer error from 5.16 to 4.81 a week,
    # but costs 1.7 points of top-12 hit rate. So the board still RANKS on the
    # untouched score and only the quoted probability is made consistent.
    if have_current and itt:
        import math as _m
        by_team = {}
        for p in players:
            if p.get("rostered", True) and p.get("prob") is not None and p.get("team"):
                by_team.setdefault(p["team"], []).append(p)
        adj = 0
        for tm, grp in by_team.items():
            tt = itt.get(tm)
            if tt is None or len(grp) < 3:
                continue
            target = min(max(SCORERS_A + SCORERS_B * float(tt), 0.4), 5.0)
            lo = [_m.log(min(max(p["prob"], 1e-6), 1-1e-6) / (1 - min(max(p["prob"], 1e-6), 1-1e-6)))
                  for p in grp]
            f = lambda s: sum(1/(1+_m.exp(-(x+s))) for x in lo) - target
            a_, b_ = -2.5, 2.5
            if f(a_) > 0: shift = a_
            elif f(b_) < 0: shift = b_
            else:
                for _ in range(60):                      # bisection, no scipy needed
                    m_ = (a_+b_)/2
                    if f(a_)*f(m_) <= 0: b_ = m_
                    else: a_ = m_
                shift = (a_+b_)/2
            for p, x in zip(grp, lo):
                p["prob_raw"] = p["prob"]
                p["prob"] = round(1/(1+_m.exp(-(x+shift))), 3)
            p_sum = sum(p["prob"] for p in grp)
            adj += 1
        print(f"team-normalised probabilities for {adj} teams "
              f"(sum matches expected distinct scorers from the implied total)")

    players.sort(key=lambda p:(p["score"],p["prob"]),reverse=True)

    out=dict(meta=dict(season=stat_season,predict_week=predict_week,
        source=f"nflverse: {stat_season} stats+pbp + {SEASON} rosters/lines",
        generated=pd.Timestamp.now("UTC").strftime("updated %Y-%m-%d %H:%M UTC"),
        weights=dict(season=int(W_SEASON*100),team_total=int(W_TT*100),red_zone_10=int(W_RZ10*100),goal_line_5=int(W_RZ5*100),yardage=int(W_YDS*100)),
        calib=CALIB,calib_pos=CALIB_POS,calib_pos_prob=CALIB_POS_PROB,calib_prob=CALIB_PROB,
        shrink_k=SHRINK_K, prob_shrink_k=PROB_SHRINK_K, backtest=dict(top5_hit=0.567,top12_hit=0.537,top24_hit=0.475,baseline_top12=0.477,
                      val2024=0.546,val2024_base=0.514,weeks=18,graded=5365,base_rate=0.191,
                      note="current weights, trained on the prior season, graded out-of-sample",
                      # Everything above was measured from week 4 onward, because
                      # that is where the walk-forward harness started. Weeks 1-3,
                      # which is exactly where the board is now, had never been
                      # graded at all until backtest_prior.py went looking.
                      early=dict(window="weeks 1-4", picks=96,
                                 positional=0.479, prior=0.656, gain=0.177, se=0.051,
                                 late_window="weeks 5+", late_positional=0.527,
                                 late_prior=0.527,
                                 note=("shrinking a short sample toward the player's own "
                                       "prior season instead of the position average is "
                                       "worth 17.7 points of top-12 hit rate in the first "
                                       "four weeks, about three and a half standard errors, "
                                       "and worth nothing from week 5 on because by then "
                                       "the sample speaks for itself. See backtest_prior.py."))),
        calibration_curve=CALIBRATION_CURVE, conf_penalty=CONF_PENALTY,
        matchup_weight=MATCHUP_WEIGHT, markets=MARKETS,
        odds=(dict(prior_meta.get("odds"), for_week=predict_week) if prior_meta.get("odds") else None),
        book_bias=prior_meta.get("book_bias") or {},
        preseason_note=f"2026 preseason team totals, footballdb.com, snapshot {PRE_SNAPSHOT_DATE}. Mostly backups; not part of the model score.",
        current_season_note=cur_weeks_note, weeks_played=weeks_played,
        statkeys=SH),players=players,matchup=matchup,teams=teams,games=games,player_box=player_box,week1={a:b for a,b in WK1_PAIRS}|{b:a for a,b in WK1_PAIRS})
    # Grade every past board before archiving this one, so the site can show a
    # live record next to the backtest rather than only the historical claim.
    graded = grade_archives(SEASON, df.assign(position=df.position),
                            complete_weeks=set(complete))
    if graded:
        tot = {k: sum(g[k] for g in graded) for k in ("top5","top5_of","top12","top12_of","top24","top24_of")}
        out["meta"]["live_record"] = {"weeks": graded, "totals": tot}
        print("live record: " + "  ".join(
            f"wk{g['week']} {g['top12']}/{g['top12_of']}" for g in graded)
            + f"  |  season top-12 {tot['top12']}/{tot['top12_of']}")
    board_path = archive_board(players, predict_week)

    # record.json powers the public track-record page. Kept separate from
    # data.json so the page stays small and can be shared on its own.
    record = {"generated": pd.Timestamp.now("UTC").strftime("updated %Y-%m-%d %H:%M UTC"),
              "repo": REPO, "current_board": board_path,
              "weeks": graded,
              "totals": out["meta"].get("live_record", {}).get("totals", {}),
              "backtest_top12": 0.537}
    json.dump(record, open("record.json", "w"), separators=(",", ":"))
    json.dump(out,open("data.json","w"),separators=(",",":"))
    print(f"data.json: {len(players)} players | moved {sum(p['moved'] for p in players)} | off-roster {sum(not p['rostered'] for p in players)}")

if __name__=="__main__": build()
