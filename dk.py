#!/usr/bin/env python3
"""
TransferSportal -- anytime-touchdown prices straight from DraftKings.

WHY THIS EXISTS
---------------
The board priced itself against nothing for weeks. The reason was never that
DraftKings is unscrapeable. It is that the two routes tried first each had a
wall:

  * The Odds API needs a key, and until one is set odds.py exits quietly.
  * The Apify actor works and returns correct DraftKings data, but batch runs
    on the free plan stop at exactly 200 dataset rows. Measured, not assumed:
    maxResults 0, 500, 2000 and 5000 all returned 200. The full anytime-TD
    board is roughly 450 rows, so 200 is most of one game's worth of combo
    props and nothing else.

DraftKings publishes this board itself, as JSON, with no key and no login:

    /api/sportscontent/dkusoh/v1/leagues/88808/categories/1003/subcategories/12438

88808 is the NFL. Category 1003 is "TD Scorers" and subcategory 12438 is
"TD Scorer", which is the anytime market -- as opposed to 12424 "Anytime TD -
1st Quarter" or 18744 "Either Anytime TD", both of which look right by name and
are not the market we want. Those ids were read off the live category listing,
not guessed, and CATEGORY/SUBCATEGORY below record where they came from so the
next person does not have to work it out again.

WHERE THIS RUNS
---------------
The GitHub Action, which has open internet. It does NOT run from the model's
own sandbox, whose egress allowlist refuses DraftKings, The Odds API and Apify
alike -- every one of them returns a bare connection failure there. So this file
is written to fail loudly and say exactly what it saw, because the first real
execution is the first honest test of it.

WHAT IT PRODUCES
----------------
The same shape odds.py already consumes, so the devigging, the name matching and
the edge column are unchanged and shared:

    [{"pool": {"BUF", "LAC"}, "sides": {"James Cook": {"yes": -110, "no": +105}}}]
"""
import json, os, re, sys, urllib.request, urllib.error

NFL_LEAGUE = "88808"
CATEGORY = "1003"      # "TD Scorers", from the live category listing
SUBCATEGORY = "12438"  # "TD Scorer" = anytime. NOT 12424 (1st quarter) or 18744 (either player)
HOST = "https://sportsbook-nash.draftkings.com"
PATH = f"/api/sportscontent/dkusoh/v1/leagues/{NFL_LEAGUE}/categories/{CATEGORY}/subcategories/{SUBCATEGORY}"

# A browser-shaped header set. The endpoint is public, but a bare urllib
# user-agent is the one thing that reliably gets a public endpoint blocked.
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://sportsbook.draftkings.com/",
}

TEAM_FULL = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LA",
    "Las Vegas Raiders": "LV", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "Seattle Seahawks": "SEA", "San Francisco 49ers": "SF", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}
# DraftKings writes some teams its own way in places
ALIAS = {"Washington Football Team": "WAS", "Oakland Raiders": "LV",
         "San Diego Chargers": "LAC", "St. Louis Rams": "LA"}
ABBR = set(TEAM_FULL.values()) | {"AZ"}
FIX_ABBR = {"AZ": "ARI"}


def fetch(url=None, timeout=60):
    req = urllib.request.Request(url or (HOST + PATH), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def team_of(text):
    """Pull a team abbreviation out of whatever DraftKings wrote.

    It uses full names in some fields ('Cleveland Browns') and a leading
    abbreviation in others ('CLE Browns'), so both are handled rather than
    assuming one. Returns None rather than a wrong guess.
    """
    if not text:
        return None
    t = str(text).strip()
    if t in TEAM_FULL:
        return TEAM_FULL[t]
    if t in ALIAS:
        return ALIAS[t]
    head = t.split()[0].upper() if t.split() else ""
    if head in ABBR:
        return FIX_ABBR.get(head, head)
    for full, ab in TEAM_FULL.items():
        if full.lower() in t.lower():
            return ab
    return None


def event_teams(ev):
    """Both teams in one event, as board abbreviations.

    DraftKings has moved these fields around over the years, so every place the
    pair has lived is checked before giving up: the explicit team fields, the
    participants list, then the event name itself.
    """
    out = []
    for k in ("teamName1", "teamName2", "homeTeamName", "awayTeamName"):
        t = team_of(ev.get(k))
        if t:
            out.append(t)
    for p in (ev.get("participants") or []):
        if str(p.get("type", "")).lower() in ("", "team", "awayteam", "hometeam"):
            t = team_of(p.get("name"))
            if t:
                out.append(t)
        meta = p.get("metadata") or {}
        t = team_of(meta.get("teamName") or meta.get("shortTeamName"))
        if t:
            out.append(t)
    if len(set(out)) < 2:
        name = ev.get("name") or ev.get("eventName") or ""
        for part in re.split(r"\s+(?:@|at|vs\.?|v)\s+", str(name)):
            t = team_of(part)
            if t:
                out.append(t)
    return {t for t in out if t}


def odds_of(sel):
    """American price for one selection, wherever DraftKings put it this year."""
    for k in ("displayOdds", "trueOdds", "odds"):
        v = sel.get(k)
        if isinstance(v, dict):
            for kk in ("american", "americanOdds", "value"):
                if v.get(kk) not in (None, ""):
                    try:
                        return float(str(v[kk]).replace("+", "").replace("−", "-"))
                    except ValueError:
                        pass
        elif v not in (None, "") and not isinstance(v, (dict, list)):
            try:
                return float(str(v).replace("+", "").replace("−", "-"))
            except ValueError:
                pass
    return None


def player_of(sel):
    """The player a selection is about."""
    for p in (sel.get("participants") or []):
        if p.get("name"):
            return str(p["name"]).strip()
    for k in ("label", "outcomeLabel", "name"):
        v = sel.get(k)
        if v and str(v).strip().lower() not in ("yes", "no", "over", "under"):
            return str(v).strip()
    return None


def side_of(sel):
    """Yes or No. Most anytime-TD selections are one-sided Yes."""
    for k in ("label", "outcomeType", "name", "trueOutcomeType"):
        v = str(sel.get(k, "")).strip().lower()
        if v in ("no", "under"):
            return "no"
        if v in ("yes", "over"):
            return "yes"
    return "yes"


def games(doc=None):
    """Group DraftKings' flat selection list into one entry per game.

    The payload is a flat envelope -- events, markets and selections in three
    separate arrays joined by id -- so it has to be stitched back together
    before it means anything.
    """
    doc = doc if doc is not None else fetch()
    events = {str(e.get("id")): e for e in (doc.get("events") or [])}
    markets = {str(m.get("id")): m for m in (doc.get("markets") or [])}
    sels = doc.get("selections") or []
    if not events or not markets or not sels:
        raise RuntimeError(
            f"DraftKings returned a payload this parser does not recognise: "
            f"{len(events)} events, {len(markets)} markets, {len(sels)} selections. "
            f"Top-level keys were {sorted(doc.keys())}.")

    by_event = {}
    skipped_market = skipped_price = skipped_name = 0
    for s in sels:
        m = markets.get(str(s.get("marketId")))
        if not m:
            skipped_market += 1
            continue
        ev = events.get(str(m.get("eventId")))
        if not ev:
            skipped_market += 1
            continue
        who = player_of(s)
        if not who:
            skipped_name += 1
            continue
        price = odds_of(s)
        if price is None:
            skipped_price += 1
            continue
        key = str(m.get("eventId"))
        slot = by_event.setdefault(key, {"pool": event_teams(ev), "sides": {},
                                         "event": ev.get("name")})
        slot["sides"].setdefault(who, {})[side_of(s)] = price

    out = [v for v in by_event.values() if v["sides"]]
    total = sum(len(v["sides"]) for v in out)
    print(f"DraftKings: {len(out)} games, {total} priced players "
          f"(skipped {skipped_market} unjoinable, {skipped_price} priceless, "
          f"{skipped_name} nameless)")
    thin = [v["event"] for v in out if len(v["pool"]) < 2]
    if thin:
        print(f"  could not identify both teams for: {thin}")
    return out


def selftest():
    """Exercise the join and the field-shape tolerance on a payload built to
    look like DraftKings', including the awkward spellings."""
    doc = {
        "events": [
            {"id": 1, "name": "Carolina Panthers @ Cleveland Browns",
             "participants": [{"name": "Carolina Panthers", "type": "Team"},
                              {"name": "Cleveland Browns", "type": "Team"}]},
            {"id": 2, "name": "LAC Chargers @ BUF Bills"},
        ],
        "markets": [{"id": 10, "eventId": 1, "name": "Anytime TD Scorer"},
                    {"id": 20, "eventId": 2, "name": "Anytime TD Scorer"}],
        "selections": [
            {"id": 100, "marketId": 10, "label": "Yes",
             "participants": [{"name": "Chuba Hubbard"}],
             "displayOdds": {"american": "+110"}},
            {"id": 101, "marketId": 10, "label": "No",
             "participants": [{"name": "Chuba Hubbard"}],
             "displayOdds": {"american": "-140"}},
            {"id": 102, "marketId": 10, "label": "Quinshon Judkins",
             "displayOdds": {"american": "−115"}},
            {"id": 103, "marketId": 20, "label": "Yes",
             "participants": [{"name": "James Cook"}], "odds": "-125"},
            {"id": 104, "marketId": 99, "label": "Orphan",
             "participants": [{"name": "Nobody"}], "odds": "+100"},
            {"id": 105, "marketId": 20, "label": "Yes",
             "participants": [{"name": "No Price"}]},
        ],
    }
    g = games(doc)
    by = {tuple(sorted(x["pool"])): x for x in g}
    assert len(g) == 2, g
    car = by[("CAR", "CLE")]["sides"]
    assert car["Chuba Hubbard"] == {"yes": 110.0, "no": -140.0}, car
    assert car["Quinshon Judkins"] == {"yes": -115.0}, car   # unicode minus survived
    buf = by[("BUF", "LAC")]["sides"]
    assert buf["James Cook"] == {"yes": -125.0}, buf
    assert "No Price" not in buf and "Nobody" not in buf
    print("name from participants, name from label, unicode minus, bare odds string,")
    print("full team names, abbreviated team names, orphan market and missing price:")
    print("all handled. dk.py join is sound.")

    bad = {"events": [], "markets": [], "selections": []}
    try:
        games(bad)
    except RuntimeError as e:
        assert "does not recognise" in str(e)
        print("an unrecognised payload raises loudly instead of returning nothing")
    else:
        raise AssertionError("empty payload should have raised")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        try:
            g = games()
        except urllib.error.URLError as e:
            sys.exit(f"could not reach DraftKings: {e}. This is expected from a "
                     f"sandbox with an egress allowlist; run it in the Action.")
        for x in g[:3]:
            print(" ", sorted(x["pool"]), list(x["sides"].items())[:3])
