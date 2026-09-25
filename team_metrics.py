#!/usr/bin/env python3
"""
Advanced team metrics, NFL versions of the categories on the CFB matchup page.

Seven measures, computed separately for offence and defence, then scaled 0-100
across the 32 teams so they can be compared and differenced like percentiles:

  efficiency       EPA per play. The single best summary of how well a team
                   moves the ball relative to down, distance and field position.
  success_rate     share of plays that "stay on schedule": 40% of the needed
                   yards on 1st down, 60% on 2nd, a conversion on 3rd/4th.
  passing          EPA per dropback
  rushing          EPA per rush
  explosiveness    average EPA on SUCCESSFUL plays only. Separates a team that
                   grinds out 5 yards every snap from one that hits chunks.
  havoc            share of the opponent's plays blown up: sacks, tackles for
                   loss, interceptions, passes defensed, forced fumbles.
  finishing_drives points scored per trip inside the opponent's 40. Measures
                   whether a team converts field position into touchdowns, which
                   is the part a TD model actually cares about.
  pace             seconds per play in neutral situations (context, not quality)

For a defence the sign is flipped where lower is better, so on every scale a
higher number is a better team. That makes the matchup edge a plain subtraction:
this offence's percentile minus that defence's percentile.
"""
import io, json, sys, urllib.request
import numpy as np, pandas as pd

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI"}
EVEN_BAND = 5.0     # edges inside this many percentile points read as "even"

CATS = ["efficiency", "success_rate", "passing", "rushing",
        "explosiveness", "havoc", "finishing_drives"]
LABELS = {"efficiency": "Efficiency", "success_rate": "Success rate",
          "passing": "Passing", "rushing": "Rushing",
          "explosiveness": "Explosiveness", "havoc": "Havoc",
          "finishing_drives": "Finishing drives", "pace": "Pace"}


def load(path):
    r = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "Mozilla/5.0"})
    return pd.read_csv(io.BytesIO(urllib.request.urlopen(r, timeout=300).read()), low_memory=False)


def pct(series, higher_is_better=True):
    """Rank 32 teams onto 0-100. Percentile, not a z-score, so one blowout
    cannot drag a team's number somewhere its actual play does not justify."""
    s = series.astype(float)
    r = s.rank(pct=True) if higher_is_better else (-s).rank(pct=True)
    return (r * 100).round(1)


def raw_metrics(season):
    pbp = load(f"pbp/play_by_play_{season}.csv")
    pbp = pbp[(pbp.season_type == "REG")].copy()
    pbp["posteam"] = pbp.posteam.replace(TEAM_FIX)
    pbp["defteam"] = pbp.defteam.replace(TEAM_FIX)
    p = pbp[pbp.epa.notna() & pbp.posteam.notna() & pbp.defteam.notna()].copy()
    scrim = p[(p.rush_attempt == 1) | (p.pass_attempt == 1)].copy()

    # success: on schedule for the down
    ytg = scrim.ydstogo.fillna(10).astype(float)
    gain = scrim.yards_gained.fillna(0).astype(float)
    dn = scrim.down.fillna(1).astype(int)
    need = np.where(dn == 1, 0.40, np.where(dn == 2, 0.60, 1.00))
    scrim["succ"] = (gain >= need * ytg).astype(int)

    # havoc, from the defence's point of view
    for c in ("sack", "interception", "tackled_for_loss", "fumble_forced"):
        if c not in scrim:
            scrim[c] = 0
        scrim[c] = scrim[c].fillna(0)
    pd_col = "pass_defense_1_player_id"
    scrim["pass_def"] = scrim[pd_col].notna().astype(int) if pd_col in scrim else 0
    scrim["havoc_play"] = ((scrim.sack + scrim.interception + scrim.tackled_for_loss
                            + scrim.fumble_forced + scrim.pass_def) > 0).astype(int)

    def side(by, tag):
        g = scrim.groupby(by)
        out = pd.DataFrame({
            "efficiency": g.epa.mean(),
            "success_rate": g.succ.mean(),
            "passing": scrim[scrim.pass_attempt == 1].groupby(by).epa.mean(),
            "rushing": scrim[scrim.rush_attempt == 1].groupby(by).epa.mean(),
            "explosiveness": scrim[scrim.succ == 1].groupby(by).epa.mean(),
            "havoc": g.havoc_play.mean(),
        })
        out.index.name = "team"
        return out.add_suffix(f"_{tag}")

    off = side("posteam", "off")
    dfn = side("defteam", "def")

    # finishing drives: points per trip inside the opponent 40
    trips = p[(p.yardline_100 <= 40) & p.drive.notna()].copy()
    key = ["posteam", "game_id", "drive"]
    tr = trips.groupby(key).agg(res=("fixed_drive_result", "first")).reset_index()
    pts = {"Touchdown": 7.0, "Field goal": 3.0, "Opp touchdown": -7.0, "Safety": -2.0}
    tr["pts"] = tr.res.map(pts).fillna(0.0)
    fin_off = tr.groupby("posteam").pts.mean().rename("finishing_drives_off")
    # defensive version: points allowed per trip the opponent takes inside the 40
    dkey = trips.groupby(["defteam", "game_id", "drive"]).agg(res=("fixed_drive_result", "first")).reset_index()
    dkey["pts"] = dkey.res.map(pts).fillna(0.0)
    fin_def = dkey.groupby("defteam").pts.mean().rename("finishing_drives_def")

    # pace, neutral situations only
    neu = scrim[(scrim.score_differential.abs() <= 10) & (scrim.qtr <= 3)]
    pace = neu.groupby("posteam").apply(
        lambda d: float(np.nanmedian(np.diff(np.sort(-d.game_seconds_remaining.values)))) if len(d) > 5 else np.nan,
        include_groups=False).rename("pace_sec")

    m = off.join(dfn, how="outer").join(fin_off).join(fin_def).join(pace)
    return m.fillna(m.mean(numeric_only=True))


def scale(m):
    """Everything onto 0-100 with high = good for that unit."""
    s = pd.DataFrame(index=m.index)
    for c in CATS:
        if c == "havoc":
            # havoc an offence ALLOWS is bad for it; havoc a defence creates is good
            s["efficiency_off" if False else "havoc_off"] = pct(m["havoc_off"], higher_is_better=False)
            s["havoc_def"] = pct(m["havoc_def"], higher_is_better=True)
            continue
        s[f"{c}_off"] = pct(m[f"{c}_off"], higher_is_better=True)
        # a defence is good when it ALLOWS little, so lower raw is better
        s[f"{c}_def"] = pct(m[f"{c}_def"], higher_is_better=False)
    s["pace_sec"] = m["pace_sec"].round(1)
    s["overall_off"] = s[[f"{c}_off" for c in CATS]].mean(axis=1).round(1)
    s["overall_def"] = s[[f"{c}_def" for c in CATS]].mean(axis=1).round(1)
    s["overall"] = ((s.overall_off + s.overall_def) / 2).round(1)
    return s.round(1)


def matchup(s, away, home):
    """Each category as a head-to-head edge, the way the reference page does it:
    this team's offence percentile minus the other team's defence percentile."""
    rows = []
    for c in CATS:
        a = float(s.loc[away, f"{c}_off"]) - float(s.loc[home, f"{c}_def"])
        h = float(s.loc[home, f"{c}_off"]) - float(s.loc[away, f"{c}_def"])
        edge = (a - h) / 2.0            # positive favours the away team
        rows.append({
            "cat": c, "label": LABELS[c],
            "away_val": round(float(s.loc[away, f"{c}_off"]), 1),
            "home_val": round(float(s.loc[home, f"{c}_off"]), 1),
            "edge": round(edge, 1),
            "favors": away if edge > EVEN_BAND else (home if edge < -EVEN_BAND else None),
        })
    n_away = sum(1 for r in rows if r["favors"] == away)
    n_home = sum(1 for r in rows if r["favors"] == home)
    return {"rows": rows, "away_areas": n_away, "home_areas": n_home,
            "even_areas": len(rows) - n_away - n_home, "even_band": EVEN_BAND}


def build(season=2026):
    m = raw_metrics(season)
    s = scale(m)
    out = {t: {k: (None if pd.isna(v) else float(v)) for k, v in s.loc[t].items()}
           for t in s.index}
    json.dump({"season": season, "cats": CATS, "labels": LABELS,
               "even_band": EVEN_BAND, "teams": out},
              open("metrics.json", "w"), separators=(",", ":"))
    print(f"metrics.json: {len(out)} teams, {len(CATS)} categories, offence and defence")
    top = s.sort_values("overall", ascending=False)
    print(f"\n{'team':>5}{'overall':>9}{'off':>7}{'def':>7}{'eff-o':>7}{'succ-o':>8}{'expl-o':>8}{'havoc-d':>9}{'fin-d':>7}")
    for t in top.index[:8]:
        r = s.loc[t]
        print(f"{t:>5}{r.overall:>9.1f}{r.overall_off:>7.1f}{r.overall_def:>7.1f}"
              f"{r.efficiency_off:>7.1f}{r.success_rate_off:>8.1f}{r.explosiveness_off:>8.1f}"
              f"{r.havoc_def:>9.1f}{r.finishing_drives_def:>7.1f}")
    return s


if __name__ == "__main__":
    build(int(sys.argv[1]) if len(sys.argv) > 1 else 2026)
