"""
NBA sportsbook prop lines, from The Odds API (a licensed feed that carries DraftKings prices).

Writes nba_lines.json: for every player with a game today, the book's points, rebounds,
threes and points+rebounds+assists line, with the Over and Under prices. nba_picks.py
builds the Best 5 from these lines. There is no fallback to model lines: if a player has
no book line for a stat, he is not a candidate for that stat.

Cost: the events list is free. Each game costs 1 credit per market, and this asks for 4
markets, so a 10 game night is about 40 credits. It fetches once a day, at or after the
4 PM Eastern lock hour, only for games that have not tipped, and reuses today's file if it
already has lines.

The key is read from the ODDS_API_KEY environment variable and is never printed.

    python nba_lines.py
"""
import json, os, sys, urllib.parse, urllib.request, datetime as dt
from pathlib import Path

import nba
from odds import norm

HERE = Path(__file__).parent
OUT = HERE / "nba_lines.json"
API = "https://api.the-odds-api.com/v4/sports/basketball_nba"
KEY = os.environ.get("ODDS_API_KEY", "").strip()
BOOK = os.environ.get("ODDS_BOOK", "draftkings").strip()
BOOK_NAME = {"draftkings": "DraftKings", "fanduel": "FanDuel", "betmgm": "BetMGM"}.get(BOOK, BOOK)
MARKETS = {"player_points": "pts", "player_rebounds": "reb", "player_threes": "fg3",
           "player_points_rebounds_assists": "pra"}
LOCK_HOUR = 16


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ts-board"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r), dict(r.headers)


def q(**kw):
    return urllib.parse.urlencode(kw)


def main(now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(nba.ET).date().isoformat()
    if not KEY:
        print("nba_lines: no ODDS_API_KEY, so no book lines today")
        return
    if now.astimezone(nba.ET).hour < LOCK_HOUR:
        print(f"nba_lines: before {LOCK_HOUR}:00 Eastern, not fetching yet")
        return
    try:
        old = json.loads(OUT.read_text())
        if old.get("date") == today and old.get("lines"):
            print(f"nba_lines: already have {len(old['lines'])} players for {today}")
            return
    except Exception:
        pass
    events, _ = get(f"{API}/events?" + q(apiKey=KEY))
    todays = []
    for e in events:
        t = dt.datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00"))
        if t > now and t.astimezone(nba.ET).date().isoformat() == today:
            todays.append(e)
    lines, remaining = {}, None
    for e in todays:
        try:
            d, hdr = get(f"{API}/events/{e['id']}/odds?" + q(
                apiKey=KEY, regions="us", markets=",".join(MARKETS), bookmakers=BOOK, oddsFormat="american"))
        except Exception as ex:
            print("nba_lines: event failed,", type(ex).__name__)
            continue
        remaining = hdr.get("x-requests-remaining", remaining)
        for bm in d.get("bookmakers", []):
            if bm.get("key") != BOOK:
                continue
            for m in bm.get("markets", []):
                stat = MARKETS.get(m.get("key"))
                if not stat:
                    continue
                by = {}
                for o in m.get("outcomes", []):
                    nm = o.get("description")
                    if not nm or o.get("point") is None:
                        continue
                    r = by.setdefault(nm, {"line": float(o["point"])})
                    side = str(o.get("name", "")).lower()
                    if side in ("over", "under") and float(o["point"]) == r["line"]:
                        r[side] = o.get("price")
                for nm, r in by.items():
                    if "over" in r:
                        lines.setdefault(norm(nm), {})[stat] = {
                            "line": r["line"], "over": r.get("over"), "under": r.get("under"),
                            "name": nm, "game": f"{e.get('away_team')} at {e.get('home_team')}"}
    print(f"nba_lines: {len(todays)} games, {len(lines)} players, credits left {remaining}")
    if lines:
        OUT.write_text(json.dumps({"date": today, "fetched": now.strftime("%Y-%m-%d %H:%M UTC"),
                                   "book": BOOK_NAME, "lines": lines}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                         # noqa
        print("nba_lines.py: skipped,", type(e).__name__)
        sys.exit(0)
