"""Extra context for the NFL Research Center: game-day weather, snap share and target share.

Writes context.json. Every piece is optional. If a source fails, that piece is left out and the page shows
nothing for it. Nothing here is guessed or filled in. This file never fails the daily run.

Sources: Open-Meteo forecast (free, no key) for weather, nflverse weekly stats for target share and air yards share,
nflverse snap counts for offensive snap share.
"""
import io, json, sys, time, datetime as dt, urllib.request
import pandas as pd

SEASON = next((int(x) for x in sys.argv[1:] if x.isdigit()), 2026)
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
TEAM_FIX = {"AZ": "ARI", "LAR": "LA", "JAC": "JAX", "WSH": "WAS"}
# lat, lon, roof. "dome" means the game is played indoors (or under a roof that is normally closed), so weather is ignored.
STADIUMS = {
    "ARI": (33.5276, -112.2626, "dome"), "ATL": (33.7554, -84.4009, "dome"), "BAL": (39.2780, -76.6227, "open"),
    "BUF": (42.7738, -78.7870, "open"), "CAR": (35.2258, -80.8528, "open"), "CHI": (41.8623, -87.6167, "open"),
    "CIN": (39.0955, -84.5161, "open"), "CLE": (41.5061, -81.6995, "open"), "DAL": (32.7473, -97.0945, "dome"),
    "DEN": (39.7439, -105.0201, "open"), "DET": (42.3400, -83.0456, "dome"), "GB": (44.5013, -88.0622, "open"),
    "HOU": (29.6847, -95.4107, "dome"), "IND": (39.7601, -86.1639, "dome"), "JAX": (30.3239, -81.6373, "open"),
    "KC": (39.0489, -94.4839, "open"), "LA": (33.9535, -118.3392, "dome"), "LAC": (33.9535, -118.3392, "dome"),
    "LV": (36.0909, -115.1833, "dome"), "MIA": (25.9580, -80.2389, "open"), "MIN": (44.9735, -93.2575, "dome"),
    "NE": (42.0909, -71.2643, "open"), "NO": (29.9511, -90.0812, "dome"), "NYG": (40.8135, -74.0745, "open"),
    "NYJ": (40.8135, -74.0745, "open"), "PHI": (39.9008, -75.1675, "open"), "PIT": (40.4468, -80.0158, "open"),
    "SF": (37.4030, -121.9700, "open"), "SEA": (47.5952, -122.3316, "open"), "TB": (27.9759, -82.5033, "open"),
    "TEN": (36.1665, -86.7713, "open"), "WAS": (38.9076, -76.8645, "open"),
}
WIND_MPH, GUST_MPH, COLD_F, RAIN_PCT = 15, 25, 25, 60


def get(url, tries=3):
    err = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url}: {err}")


def weather_for(day, team):
    """Worst conditions between noon and 10pm local on game day, or None."""
    lat, lon, roof = STADIUMS[team]
    if roof == "dome":
        return {"roof": True}
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability"
           "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=10")
    h = json.loads(get(url))["hourly"]
    rows = []
    for t, tmp, w, g, pp in zip(h["time"], h["temperature_2m"], h["wind_speed_10m"], h["wind_gusts_10m"], h["precipitation_probability"]):
        if t[:10] == day and 12 <= int(t[11:13]) <= 22 and tmp is not None and w is not None:
            rows.append((tmp, w, g or w, pp or 0))
    if not rows:
        return None
    temp = min(r[0] for r in rows); wind = max(r[1] for r in rows)
    gust = max(r[2] for r in rows); rain = max(r[3] for r in rows)
    flags = []
    if wind >= WIND_MPH or gust >= GUST_MPH: flags.append("wind")
    if temp <= COLD_F: flags.append("cold")
    if rain >= RAIN_PCT: flags.append("rain")
    return {"roof": False, "temp": round(temp), "wind": round(wind), "gust": round(gust), "rain": round(rain), "flags": flags}


def usage():
    """Last three games of target share, air yards share and offensive snap share, by player name."""
    out = {}
    try:
        raw = None
        for name in (f"stats_player/stats_player_week_{SEASON}.csv", f"player_stats/stats_player_week_{SEASON}.csv"):
            try:
                raw = get(f"{BASE}/{name}", tries=1); break
            except RuntimeError:
                continue
        if raw is None:
            raise RuntimeError("no weekly stats file")
        a = pd.read_csv(io.BytesIO(raw), low_memory=False)
        a = a[a.season_type == "REG"].copy()
        a["team"] = a.team.replace(TEAM_FIX)
        for c in ("target_share", "air_yards_share", "targets", "week"):
            a[c] = pd.to_numeric(a.get(c), errors="coerce")
        a = a[a.position.isin(["WR", "TE", "RB"])].sort_values("week")
        for name, g in a.groupby("player_display_name"):
            g = g.tail(3)
            if len(g) < 2 or g.target_share.isna().all():
                continue
            out[name] = {"team": g.team.iloc[-1], "n": int(len(g)),
                         "tgt": round(float(g.target_share.mean()) * 100, 1),
                         "air": round(float(g.air_yards_share.mean()) * 100, 1) if not g.air_yards_share.isna().all() else None,
                         "tpg": round(float(g.targets.mean()), 1)}
    except Exception as e:
        print("context.py: target share skipped:", e)
    try:
        s = pd.read_csv(io.BytesIO(get(f"{BASE}/snap_counts/snap_counts_{SEASON}.csv")), low_memory=False)
        s = s[(s.game_type == "REG")].copy()
        s["offense_pct"] = pd.to_numeric(s.offense_pct, errors="coerce")
        scale = 100.0 if s.offense_pct.max() <= 1.5 else 1.0     # file stores a fraction or a percent
        s["team"] = s.team.replace(TEAM_FIX)
        s = s.sort_values("week")
        for name, g in s.groupby("player"):
            g = g[g.offense_pct.notna()].tail(3)
            if len(g) < 2:
                continue
            out.setdefault(name, {"team": g.team.iloc[-1], "n": int(len(g))})["snap"] = round(float(g.offense_pct.mean()) * scale)
    except Exception as e:
        print("context.py: snap counts skipped:", e)
    return out


def main():
    res = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "weather": {}, "players": {}}
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        games = json.load(open("games.json"))["games"]
    except Exception as e:
        games = []
        print("context.py: no games.json:", e)
    for g in games:
        home, day = g.get("home"), str(g.get("kick") or "")[:10]
        if not home or home not in STADIUMS or day < today:
            continue
        try:
            w = weather_for(day, home)
            if w:
                w["day"] = day
                res["weather"][home] = w
        except Exception as e:
            print("context.py: weather skipped for", home, ":", e)
    res["players"] = usage()
    json.dump(res, open("context.json", "w"), separators=(",", ":"))
    print("context.json:", len(res["weather"]), "stadiums,", len(res["players"]), "players")


def selftest():
    assert STADIUMS["IND"][2] == "dome" and len(STADIUMS) == 32
    assert weather_for("2026-01-01", "DET") == {"roof": True}
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        try:
            main()
        except Exception as e:
            print("context.py failed; building without it:", e)
            json.dump({"generated": None, "weather": {}, "players": {}}, open("context.json", "w"))
