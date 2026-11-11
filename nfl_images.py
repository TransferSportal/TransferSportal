"""
Embedded player headshots for the NFL Matchups slides.

Runs after nba_model.py in the daily build. For every team on this week's slate it
takes the top 7 players by anytime touchdown probability, looks up their picture
in the public nflverse roster file, shrinks it to a small WebP and stores it inline
in nfl_images.json, so the page shows it even where outside image hosts are blocked.

Only missing pictures are fetched, so a normal day costs almost nothing. If the
roster file or a picture cannot be fetched, that player simply has no photo and the
slide shows an empty circle. This never raises and never blocks the board.
"""
import csv, io, json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
SEASON = 2026
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
PER_TEAM = 10
FIX = {"AZ": "ARI"}


def key(name, team):
    return f"{name}|{team}"


def roster_photos():
    url = f"{BASE}/rosters/roster_{SEASON}.csv"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    by_team, by_name = {}, {}
    for r in csv.DictReader(io.StringIO(raw)):
        u = (r.get("headshot_url") or "").strip()
        n = (r.get("full_name") or "").strip()
        if not u or not n:
            continue
        t = FIX.get(r.get("team"), r.get("team"))
        by_team[(n, t)] = u
        by_name.setdefault(n, u)
    return by_team, by_name


def main():
    try:
        from nba_model import shrink, grab
    except Exception as e:                       # noqa
        print("nfl_images.py: skipped,", e)
        return
    dj, gj = HERE / "data.json", HERE / "games.json"
    if not dj.exists() or not gj.exists():
        print("nfl_images.py: no data.json or games.json, skipped")
        return
    data = json.loads(dj.read_text())
    games = json.loads(gj.read_text()).get("games") or []
    teams = {g["home"] for g in games} | {g["away"] for g in games}
    want = []
    for t in sorted(teams):
        ps = [p for p in data["players"] if p.get("team") == t and p.get("rostered", True) and p.get("prob") is not None]
        ps.sort(key=lambda p: -p["prob"])
        want += [(p["name"], t) for p in ps[:PER_TEAM]]
    # the locked card's picks always get a face, even past the per team cut
    seen = set(want)
    for p in ((data.get("picks") or {}).get("td_picks") or []):
        w = (p.get("name"), p.get("team"))
        if w[0] and w[1] and w not in seen:
            want.append(w); seen.add(w)
    out = HERE / "nfl_images.json"
    old = json.loads(out.read_text()) if out.exists() else {}
    heads = dict(old.get("heads") or {})
    todo = [w for w in want if key(*w) not in heads]
    if not todo:
        print(f"nfl_images.py: {len(heads)} headshots, nothing new")
        return
    try:
        by_team, by_name = roster_photos()
    except Exception as e:                       # noqa
        print("nfl_images.py: roster file unavailable,", e)
        return

    def one(w):
        u = by_team.get(w) or by_name.get(w[0])
        if not u:
            return w, None
        try:
            return w, shrink(grab(u), (260, 180), "webp")
        except Exception:
            return w, None

    got = 0
    with ThreadPoolExecutor(8) as ex:
        for w, v in ex.map(one, todo):
            if v:
                heads[key(*w)] = v
                got += 1
    out.write_text(json.dumps({"heads": heads}, separators=(",", ":")))
    print(f"nfl_images.py: {len(heads)} headshots ({got} new of {len(todo)} wanted)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                       # noqa
        print("nfl_images.py: skipped,", e)
    sys.exit(0)
