#!/usr/bin/env python3
"""
TransferSportal — DraftKings anytime-touchdown odds.

Pulls the anytime-TD market from The Odds API (licensed feed that carries
DraftKings prices), matches each price to a player on the board, and writes
dk_odds / book_prob / edge into data.json. The site then fills the odds column
in automatically and shows where the model disagrees with the price.

    export ODDS_API_KEY=xxxx
    python odds.py                 # merge live odds into data.json
    python odds.py --selftest      # run the name matcher offline, no API key

Cost: the events list is free; each game's props cost 1 credit
(1 market x 1 region). A 16-game slate is ~16 credits. The free plan gives
500 credits a month, so twice-weekly refreshes use well under half of it.

SOURCES, IN ORDER
-----------------
1. The Odds API, whenever ODDS_API_KEY is set. This is a LICENSED feed that
   carries DraftKings prices. It is the right source and it is free at this
   volume.
2. DraftKings' own public endpoint, asked once and politely, via dk.py. If it
   answers, good. If it returns 403, that is the site declining automated
   access from a server and the answer is taken at face value.

What is deliberately NOT here: routing a refused request through an unblocking
proxy to make the 403 go away. That was built on 25 September and removed the
same day. A 403 is an access control, not an obstacle, and a subscription
product resting on circumventing one is a liability as well as being wrong.
"""
import json, os, sys, time, unicodedata, urllib.parse, urllib.request

API = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
KEY = os.environ.get("ODDS_API_KEY", "").strip()
BOOK = os.environ.get("ODDS_BOOK", "draftkings").strip()
MARKET = "player_anytime_td"
TEAM_FULL = {"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Los Angeles Chargers":"LAC","Los Angeles Rams":"LA","Las Vegas Raiders":"LV","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","Seattle Seahawks":"SEA","San Francisco 49ers":"SF","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"}
SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}

def norm(name):
    """Fold a player name to a comparable key: no accents, punctuation or suffix."""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace(".", "").replace("'", "").replace("’", "").replace("-", " ")
    parts = [p for p in s.split() if p and p not in SUFFIX]
    return " ".join(parts)

def initial_key(name):
    """First initial + last name, e.g. 'c mccaffrey' — catches 'C.J.' vs 'CJ' styles."""
    p = norm(name).split()
    return (p[0][0] + " " + p[-1]) if len(p) >= 2 else norm(name)

def tight_key(name):
    """Same letters, no spacing — catches 'St.Brown' vs 'St. Brown'."""
    return norm(name).replace(" ", "")

def build_index(players):
    """Map name keys -> player dicts, scoped later by team so matches stay honest."""
    exact, tight, loose = {}, {}, {}
    for p in players:
        exact.setdefault(norm(p["name"]), []).append(p)
        tight.setdefault(tight_key(p["name"]), []).append(p)
        loose.setdefault(initial_key(p["name"]), []).append(p)
    return exact, tight, loose

def match(book_name, team_pool, exact, tight, loose):
    """Resolve a book's player name to one board player, restricted to the two
    teams playing that game. Returns the player or None."""
    for table, key in ((exact, norm(book_name)), (tight, tight_key(book_name)),
                       (loose, initial_key(book_name))):
        hits = [p for p in table.get(key, []) if not team_pool or p["team"] in team_pool]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:            # same name, same game — refuse to guess
            return None
    return None

def american_to_prob(o):
    o = float(o)
    return (-o) / (-o + 100) if o < 0 else 100 / (o + 100)

DEFAULT_HOLD = 0.055   # typical two-way hold on an anytime-TD market

def devig_pair(yes_p, no_p):
    """Exact two-way devig. A book's Yes and No prices sum to more than 1 --
    that surplus is its cut, not information. Splitting the pair proportionally
    recovers the price the book actually believes."""
    tot = yes_p + no_p
    return yes_p / tot if tot > 0 else yes_p

def devig_one_sided(yes_p, hold):
    """When only the Yes side is posted, scale it down by the measured hold.
    Less exact than a real pair, but far better than pretending the vig is not
    there: at -150 the raw price reads 60.0% when the book means about 58.4%,
    and the model gets blamed for a 1.6-point gap it did not create."""
    return yes_p / (1.0 + hold)

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "td-board"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r), dict(r.headers)

def dk_games():
    """DraftKings' own public endpoint, via dk.py.

    A courtesy fallback for when no licensed key is set. It asks once and takes
    a refusal at face value.
    """
    import dk
    return dk.games()


def fetch_and_merge(path="data.json", source=None):
    """Price the board.

    source is "dk", "api", or None to use the licensed feed when a key is set
    and DraftKings' public endpoint otherwise. Whichever source answers,
    everything downstream -- the name matching, the devigging, the edge column
    -- is the same code, so the two paths cannot drift apart or disagree about
    what a price means.
    """
    data = json.load(open(path))
    players = data.get("players", [])
    exact, tight, loose = build_index(players)

    # The licensed feed comes FIRST when a key is set. DraftKings' own endpoint
    # is only tried when there is no key, and it is asked once: if it declines,
    # that is the answer.
    feed, used_source = None, None
    if source in (None, "api") and KEY:
        feed = api_games()
        used_source = f"the-odds-api/{BOOK}"
    if feed is None and source in (None, "dk"):
        try:
            feed = dk_games()
            used_source = "draftkings-public"
        except Exception as e:
            print(f"DraftKings declined or was unreachable: {e}")
            if source == "dk":
                return 0
    if feed is None:
        print("No ODDS_API_KEY set and DraftKings did not answer. The licensed "
              "feed is the supported route: https://the-odds-api.com, free tier, "
              "then add ODDS_API_KEY as a repository secret. "
              "Leaving data.json unchanged.")
        return 0
    if not feed:
        print("no priced games from any source — leaving data.json unchanged")
        return 0
    print(f"pricing from {used_source}: {len(feed)} games")

    matched = unmatched = 0
    misses, game_holds = [], []
    for g in feed:
        pool, sides = g["pool"], g["sides"]
        holds = [american_to_prob(v["yes"]) + american_to_prob(v["no"]) - 1.0
                 for v in sides.values() if "yes" in v and "no" in v]
        hold = sorted(holds)[len(holds) // 2] if holds else DEFAULT_HOLD
        hold = min(max(hold, 0.0), 0.35)
        for who, v in sides.items():
            if "yes" not in v:
                continue
            p = match(who, pool, exact, tight, loose)
            if p is None:
                unmatched += 1; misses.append(f"{who} ({'/'.join(sorted(pool))})")
                continue
            raw = american_to_prob(v["yes"])
            if "no" in v:
                fair = devig_pair(raw, american_to_prob(v["no"])); how = "pair"
            else:
                fair = devig_one_sided(raw, hold); how = "hold"
            p["dk_odds"] = int(v["yes"])
            p["book_prob"] = round(raw, 4)     # what the ticket pays
            p["fair_prob"] = round(fair, 4)    # what the book actually believes
            p["devig"] = how
            p["edge"] = round(p.get("prob", 0) - fair, 4)
            matched += 1
        game_holds.append(hold)

    med_hold = sorted(game_holds)[len(game_holds) // 2] if game_holds else None
    data.setdefault("meta", {})["odds"] = {
        "book": "draftkings", "source": used_source, "market": MARKET,
        "matched": matched, "devigged": True,
        "median_hold": round(med_hold, 4) if med_hold is not None else None,
        "for_week": data.get("meta", {}).get("predict_week"),
        "fetched": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
    }
    json.dump(data, open(path, "w"), separators=(",", ":"))
    print(f"priced {matched} players, {unmatched} unmatched")
    if med_hold is not None:
        print(f"  median book hold {med_hold*100:.1f}% — edges are against the devigged price")
    if misses:
        print("  unmatched:", ", ".join(misses[:12]))
    return matched


def api_games():
    """The Odds API, folded into the same shape dk.games() returns."""
    try:
        events, _ = get(f"{API}/events?apiKey={urllib.parse.quote(KEY)}")   # free call
    except Exception as e:
        print("Could not list events:", e)
        return []
    print(f"{len(events)} scheduled games from the feed")
    out = []
    used = remaining = None
    for ev in events:
        pool = {TEAM_FULL.get(ev.get("home_team"), ""), TEAM_FULL.get(ev.get("away_team"), "")}
        pool.discard("")
        q = urllib.parse.urlencode({"apiKey": KEY, "regions": "us", "markets": MARKET,
                                    "oddsFormat": "american", "bookmakers": BOOK})
        try:
            odds, hdr = get(f"{API}/events/{ev['id']}/odds?{q}")
        except Exception as e:
            print(f"  {ev.get('away_team')} at {ev.get('home_team')}: no props ({e})")
            continue
        used = hdr.get("x-requests-used", used)
        remaining = hdr.get("x-requests-remaining", remaining)
        # Gather both sides per player. The No side is what makes an exact
        # devig possible, so it is collected rather than skipped.
        sides = {}
        for bk in odds.get("bookmakers", []):
            if bk.get("key") != BOOK:
                continue
            for mk in bk.get("markets", []):
                if mk.get("key") != MARKET:
                    continue
                for o in mk.get("outcomes", []):
                    who = o.get("description") or o.get("participant") or ""
                    price = o.get("price")
                    if who == "" or price is None:
                        continue
                    side = "no" if str(o.get("name", "Yes")).lower() in ("no", "under") else "yes"
                    sides.setdefault(who, {})[side] = float(price)
        if sides:
            out.append({"pool": pool, "sides": sides,
                        "event": f"{ev.get('away_team')} at {ev.get('home_team')}"})
        time.sleep(0.25)
    if used:
        print(f"  credits used {used}, remaining {remaining}")
    return out


def selftest():
    """Prove the matcher handles real-world name drift without touching the API."""
    board = [
        {"name": "Christian McCaffrey", "team": "SF", "prob": .6},
        {"name": "Ja'Marr Chase", "team": "CIN", "prob": .4},
        {"name": "Marvin Harrison Jr.", "team": "ARI", "prob": .3},
        {"name": "D.J. Moore", "team": "BUF", "prob": .3},
        {"name": "Amon-Ra St. Brown", "team": "DET", "prob": .45},
        {"name": "Kenneth Walker III", "team": "KC", "prob": .4},
        {"name": "Travis Etienne", "team": "NO", "prob": .34},
        {"name": "Michael Carter", "team": "ARI", "prob": .2},
        {"name": "Michael Carter", "team": "SF", "prob": .2},   # duplicate name trap
    ]
    exact, tight, loose = build_index(board)
    cases = [
        ("Christian McCaffrey", {"SF", "LA"}, "Christian McCaffrey"),
        ("C. McCaffrey",        {"SF", "LA"}, "Christian McCaffrey"),
        ("Ja'Marr Chase",       {"CIN", "TB"}, "Ja'Marr Chase"),
        ("JaMarr Chase",        {"CIN", "TB"}, "Ja'Marr Chase"),
        ("Marvin Harrison",     {"ARI", "LAC"}, "Marvin Harrison Jr."),
        ("Marvin Harrison Jr",  {"ARI", "LAC"}, "Marvin Harrison Jr."),
        ("DJ Moore",            {"BUF", "HOU"}, "D.J. Moore"),
        ("Amon-Ra St.Brown",    {"DET", "NO"}, "Amon-Ra St. Brown"),
        ("Kenneth Walker",      {"KC", "DEN"}, "Kenneth Walker III"),
        ("Travis Etienne Jr.",  {"NO", "DET"}, "Travis Etienne"),
        ("Christian McCaffrey", {"DAL", "NYG"}, None),   # right name, wrong game
        ("Michael Carter",      {"ARI", "SF"},  None),   # ambiguous, must refuse
        ("Some Practice Squader", {"SF", "LA"}, None),
    ]
    bad = 0
    for book_name, pool, want in cases:
        got = match(book_name, pool, exact, tight, loose)
        got_name = got["name"] if got else None
        ok = got_name == want
        bad += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'FAIL'} {book_name:24s} -> {got_name}")
    print(("all matcher cases passed" if not bad else f"{bad} FAILED"))
    return bad

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(1 if selftest() else 0)
    fetch_and_merge()
