#!/usr/bin/env python3
"""
TransferSportal -- the slate's actual PICKS, locked before kickoff and graded after.

WHY THIS FILE EXISTS
--------------------
Until now the board was a ranked list of 424 players and a page of game
projections. Neither of them ever said "these are the picks". A ranking is not a
record: you cannot grade it, you cannot sell it, and nobody can check it.

Worse, the two halves of the site could contradict each other without anyone
noticing. The game model can say Philadelphia scores 22 points, which is about
two touchdowns, while the touchdown board shows five Eagles near the top. Both
numbers look fine on their own page and together they are nonsense.

So this file does three things:

  1. Picks the touchdown scorers, with a CAP PER TEAM tied to that team's
     projected points. A team projected for 22 points gets 2 picks, not 5. The
     cap is never more than 3 whatever the projection says.
  2. Picks every game, against the spread and on the total, straight off
     games.json.
  3. Locks the whole thing to picks/<season>-week-<n>.json, WRITE ONCE, and
     grades any earlier week that has since finished.

THE CAP
-------
Measured on real games, a team's expected number of DISTINCT scorers is

    scorers = -0.02 + 0.0902 x points

which is about 2.0 at 22 points and 2.6 at 29. Distinct scorers, not
touchdowns: a prop asks "does he score at least once", so two touchdowns by the
same running back is one scorer, not two. Rounding that and capping it at 3 is
where the pick count comes from. It is not a guess and it is not a preference.

WHY WRITE ONCE
--------------
The builder runs daily. If Monday's run could rewrite Sunday's picks, it would
rewrite them using stats that already contain Sunday's results and then grade
them against those same games. The record would climb every week and every
point of it would be fake. The file is immutable once written and the lock time
is stamped inside it, so the commit history is the public timestamp.

    python picks.py            # lock this week, grade the finished ones
"""
import io, json, os, sys, urllib.request
import pandas as pd

PICK_DIR = "picks"
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI"}

# expected DISTINCT scorers from projected points, fitted on real games in
# backtest_teamnorm.py. Same constants the probability normalisation uses, so
# the pick count and the quoted probabilities cannot drift apart.
SCORERS_A, SCORERS_B = -0.02, 0.0902
MAX_PER_TEAM = 3          # Ryan's cap, and the projection never asks for more
MIN_PER_TEAM = 1


def load(path):
    r = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "Mozilla/5.0"})
    return pd.read_csv(io.BytesIO(urllib.request.urlopen(r, timeout=300).read()),
                       low_memory=False)


def team_cap(points):
    """How many scorers this team is allowed on the board."""
    exp = SCORERS_A + SCORERS_B * float(points)
    return max(MIN_PER_TEAM, min(MAX_PER_TEAM, int(round(exp)))), round(exp, 2)


def select_td_picks(players, games):
    """Top N players per team, N set by that team's projected points.

    Ranked on `score`, which is what the board itself ranks on, so the picks are
    the top of the board rather than a second opinion invented here. Players
    without a projected game are skipped: no game, no pick.
    """
    pts = {}
    for g in games:
        pts[g["home"]] = g["proj_home"]
        pts[g["away"]] = g["proj_away"]

    by_team = {}
    for p in players:
        if not p.get("rostered", True) or p.get("prob") is None:
            continue
        if p.get("team") in pts:
            by_team.setdefault(p["team"], []).append(p)

    picks = []
    for tm, grp in by_team.items():
        cap, exp = team_cap(pts[tm])
        grp.sort(key=lambda x: (-x.get("score", 0), -x.get("prob", 0)))
        for i, p in enumerate(grp[:cap], 1):
            picks.append({
                "name": p["name"], "pos": p.get("pos"), "team": tm,
                "team_rank": i, "team_cap": cap,
                "team_proj_pts": pts[tm], "team_exp_scorers": exp,
                "prob": p.get("prob"), "score": p.get("score"),
                "opp": p.get("next_opp"),
            })
    picks.sort(key=lambda x: (-(x["score"] or 0), -(x["prob"] or 0)))
    return picks


def select_game_picks(games):
    """Every game with a line: the side and the total, straight off games.json."""
    out = []
    for g in games:
        if not g.get("ats_pick"):
            continue
        out.append({
            "away": g["away"], "home": g["home"],
            "spread_line": g.get("spread_line"), "total_line": g.get("total_line"),
            "proj_away": g.get("proj_away"), "proj_home": g.get("proj_home"),
            "proj_spread": g.get("proj_spread"), "proj_total": g.get("proj_total"),
            "ats_pick": g.get("ats_pick"), "ats_pick_team": g.get("ats_pick_team"),
            "ats_pick_line": g.get("ats_pick_line"), "pick_is_dog": g.get("pick_is_dog"),
            "ou_pick": g.get("ou_pick"), "projected_winner": g.get("projected_winner"),
        })
    return out


def kicked_off(sched, week):
    """Teams whose game this week has already started.

    A game is treated as started once it has a score, which is the only signal
    that cannot be argued with. Anything involving these teams is frozen.
    """
    gw = sched[(sched.week == week) & sched.home_score.notna()]
    out = set()
    for x in gw.itertuples():
        out.add(TEAM_FIX.get(x.home_team, x.home_team))
        out.add(TEAM_FIX.get(x.away_team, x.away_team))
    return out


def lock(season, week, td_picks, game_picks, amend=None, started=frozenset()):
    """Write this week's picks once and never again.

    The one exception is an AMENDMENT, and it is deliberately hard to trigger.
    If the model itself changes mid-week, the old card is no longer what the
    model thinks, but silently rewriting it would destroy the only thing that
    makes the record worth anything. So:

      * the daily build can NEVER amend. It passes amend=None and the file is
        left exactly as it is.
      * an amendment has to be asked for by hand, with a written reason, and
        that reason is stored in the file.
      * a pick for a game that has already kicked off is NEVER touched, whatever
        is asked for. Those come back verbatim from the original lock. Changing
        a pick after the game has started is not an amendment, it is a lie.

    Every amendment is appended to the file with its own timestamp, so the
    history reads as what it is rather than looking like the original.
    """
    os.makedirs(PICK_DIR, exist_ok=True)
    path = f"{PICK_DIR}/{season}-week-{week}.json"
    if os.path.exists(path):
        old = json.load(open(path))
        if not amend:
            print(f"{path} already locked at {old.get('locked')} -- leaving it alone")
            return path, old
        keep_td = [p for p in old.get("td_picks", []) if p["team"] in started]
        keep_gp = [g for g in old.get("game_picks", [])
                   if g["home"] in started or g["away"] in started]
        frozen_teams = {p["team"] for p in keep_td} | {g["home"] for g in keep_gp} | \
                       {g["away"] for g in keep_gp}
        new_td = [p for p in td_picks if p["team"] not in frozen_teams]
        new_gp = [g for g in game_picks
                  if g["home"] not in frozen_teams and g["away"] not in frozen_teams]
        old["td_picks"] = keep_td + new_td
        old["game_picks"] = keep_gp + new_gp
        old.setdefault("amendments", []).append({
            "at": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "reason": amend,
            "frozen_teams": sorted(frozen_teams),
            "frozen_note": ("these picks were left exactly as first locked because "
                            "their games had already kicked off"),
            "replaced": len(new_td) + len(new_gp),
        })
        json.dump(old, open(path, "w"), separators=(",", ":"))
        print(f"{path} AMENDED: {len(keep_td)+len(keep_gp)} picks frozen "
              f"({', '.join(sorted(frozen_teams)) or 'none'}), "
              f"{len(new_td)+len(new_gp)} replaced")
        print(f"  reason: {amend}")
        return path, old
    doc = {
        "season": season, "week": week,
        "locked": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("locked on the first build of this slate and never rewritten; "
                 "touchdown picks are capped per team by that team's projected points"),
        "cap_rule": (f"picks per team = round({SCORERS_A} + {SCORERS_B} x projected points), "
                     f"clamped to {MIN_PER_TEAM}..{MAX_PER_TEAM}"),
        "td_picks": td_picks, "game_picks": game_picks,
    }
    json.dump(doc, open(path, "w"), separators=(",", ":"))
    print(f"{path} locked -- {len(td_picks)} touchdown picks, {len(game_picks)} game picks")
    return path, doc


def grade_week(doc, stats, sched):
    """Grade one locked week against what actually happened.

    A touchdown pick who did not play is recorded as 'dnp' and left out of the
    hit rate, the same convention the player board has always used. A spread
    that lands exactly on the number is a push and is left out of the win rate,
    because a push returns the stake.
    """
    wk = doc["week"]
    sw = stats[stats.week == wk]
    gw = sched[(sched.week == wk) & sched.home_score.notna()]
    if not len(sw) or not len(gw):
        return None

    played = set(sw.player_display_name)
    scored = set(sw[sw.any_td > 0].player_display_name)
    td_by = sw.groupby("player_display_name").any_td.sum().to_dict()

    td_rows, hit = [], 0
    graded = 0
    for p in doc["td_picks"]:
        res = "dnp" if p["name"] not in played else ("hit" if p["name"] in scored else "miss")
        if res != "dnp":
            graded += 1
            hit += res == "hit"
        td_rows.append({**{k: p[k] for k in ("name", "pos", "team", "team_rank", "prob")},
                        "result": res, "tds": int(td_by.get(p["name"], 0))})

    finals = {}
    for x in gw.itertuples():
        h = TEAM_FIX.get(x.home_team, x.home_team)
        a = TEAM_FIX.get(x.away_team, x.away_team)
        finals[(a, h)] = (float(x.away_score), float(x.home_score))

    ats_w = ats_l = ats_p = ou_w = ou_l = ou_p = 0
    game_rows = []
    for g in doc["game_picks"]:
        key = (g["away"], g["home"])
        if key not in finals:
            continue
        asc, hsc = finals[key]
        margin = hsc - asc                       # positive = home won by that much
        total = asc + hsc
        row = {"away": g["away"], "home": g["home"], "score": f"{asc:.0f}-{hsc:.0f}",
               "ats_pick": g["ats_pick"], "ou_pick": g["ou_pick"]}
        sl = g.get("spread_line")
        if sl is not None:
            # spread_line is positive when the home team is favoured, so the home
            # side covers when the home margin beats it.
            if margin == sl:
                row["ats"] = "push"; ats_p += 1
            else:
                home_covered = margin > sl
                picked_home = g["ats_pick_team"] == g["home"]
                won = home_covered == picked_home
                row["ats"] = "win" if won else "loss"
                ats_w += won; ats_l += not won
        tl = g.get("total_line")
        if tl is not None:
            if total == tl:
                row["ou"] = "push"; ou_p += 1
            else:
                went_over = total > tl
                won = (g["ou_pick"] == "Over") == went_over
                row["ou"] = "win" if won else "loss"
                ou_w += won; ou_l += not won
        game_rows.append(row)

    return {
        "season": doc["season"], "week": wk, "locked": doc.get("locked"),
        "td": {"hit": hit, "graded": graded,
               "rate": round(hit / graded, 4) if graded else None,
               "dnp": len(doc["td_picks"]) - graded, "picks": td_rows},
        "ats": {"w": ats_w, "l": ats_l, "push": ats_p,
                "rate": round(ats_w / (ats_w + ats_l), 4) if ats_w + ats_l else None},
        "ou": {"w": ou_w, "l": ou_l, "push": ou_p,
               "rate": round(ou_w / (ou_w + ou_l), 4) if ou_w + ou_l else None},
        "games": game_rows,
    }


def complete_weeks(sched):
    """A week counts as finished once three quarters of its games are final.

    One Thursday night game is enough to make a week appear in the results, and
    grading on that publishes a one-game record that silently changes by Monday.
    """
    done = sched.groupby("week").home_score.apply(lambda s: s.notna().mean())
    return {int(w) for w, frac in done.items() if frac >= 0.75}


def build(season=None, amend=None):
    data = json.load(open("data.json"))
    gm = data.get("games_model") or json.load(open("games.json"))
    season = season or int(gm["meta"]["season"])
    week = int(gm["meta"]["week"])

    sched = load("schedules/games.csv")
    sched = sched[(sched.season == season) & (sched.game_type == "REG")]

    td_picks = select_td_picks(data["players"], gm["games"])
    game_picks = select_game_picks(gm["games"])
    path, doc = lock(season, week, td_picks, game_picks,
                     amend=amend, started=kicked_off(sched, week))

    # mark the live board so the site can show which players are the picks
    chosen = {(p["name"], p["team"]): p for p in doc["td_picks"]}
    for p in data["players"]:
        c = chosen.get((p.get("name"), p.get("team")))
        p["td_pick"] = bool(c)
        if c:
            p["td_pick_rank"] = c["team_rank"]
            p["td_pick_cap"] = c["team_cap"]

    done = complete_weeks(sched)
    try:
        stats = load(f"stats_player/stats_player_week_{season}.csv")
        stats = stats[stats.season_type == "REG"].copy()
        for c in ("rushing_tds", "receiving_tds"):
            stats[c] = stats[c].fillna(0)
        stats["any_td"] = (stats.rushing_tds + stats.receiving_tds > 0).astype(int)
    except Exception as e:
        print("no player results yet, grading skipped:", e)
        stats = None

    graded = []
    for fn in sorted(os.listdir(PICK_DIR)):
        if not fn.endswith(".json"):
            continue
        d = json.load(open(os.path.join(PICK_DIR, fn)))
        if int(d["season"]) != season or stats is None:
            continue
        if int(d["week"]) not in done:
            print(f"  week {d['week']} still in progress -- not grading it yet")
            continue
        g = grade_week(d, stats, sched)
        if g:
            graded.append(g)

    tw = sum(g["td"]["hit"] for g in graded); tn = sum(g["td"]["graded"] for g in graded)
    aw = sum(g["ats"]["w"] for g in graded);  al = sum(g["ats"]["l"] for g in graded)
    ow = sum(g["ou"]["w"] for g in graded);   ol = sum(g["ou"]["l"] for g in graded)
    record = {
        "season": season, "through_week": max((g["week"] for g in graded), default=None),
        "weeks": graded,
        "totals": {
            "td": {"hit": tw, "graded": tn, "rate": round(tw / tn, 4) if tn else None},
            "ats": {"w": aw, "l": al, "rate": round(aw / (aw + al), 4) if aw + al else None},
            "ou": {"w": ow, "l": ol, "rate": round(ow / (ow + ol), 4) if ow + ol else None},
            "breakeven": 0.5238,
        },
        "note": ("every pick here was locked before its games kicked off; the lock "
                 "time is inside each file in picks/ and in the commit history"),
    }
    json.dump(record, open("picks_record.json", "w"), separators=(",", ":"))

    data["picks"] = {"week": week, "season": season, "locked": doc.get("locked"),
                     "cap_rule": doc.get("cap_rule"),
                     "td_picks": doc["td_picks"], "game_picks": doc["game_picks"]}
    data["picks_record"] = record
    json.dump(data, open("data.json", "w"), separators=(",", ":"))

    print(f"\n{season} week {week}: {len(td_picks)} touchdown picks across "
          f"{len({p['team'] for p in td_picks})} teams, {len(game_picks)} game picks")
    if graded:
        print(f"graded record through week {record['through_week']}: "
              f"TD {tw}/{tn}, ATS {aw}-{al}, O/U {ow}-{ol}")
    else:
        print("nothing finished yet to grade")
    return record


if __name__ == "__main__":
    # python picks.py                      normal daily run, never amends
    # python picks.py --amend "reason"     hand-run amendment, started games frozen
    amend = None
    args = sys.argv[1:]
    if "--amend" in args:
        i = args.index("--amend")
        amend = args[i + 1] if len(args) > i + 1 else None
        if not amend:
            sys.exit("--amend needs a reason in quotes; an unexplained rewrite is not allowed")
        args = args[:i]
    build(int(args[0]) if args else None, amend=amend)
