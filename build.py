#!/usr/bin/env python3
"""
Build both TransferSportal front ends from one source of truth.

  App.jsx  + theme.css + data.json + team.js
      -> index.html            (GitHub Pages; React/Babel from CDN, live data.json refresh)
      -> App.NearbiJSX.jsx     (offline JSX preview; no network, no external images)

Every substitution below is asserted, so a silent miss fails the build instead
of shipping a half-branded file.
"""
import json, pathlib, sys

HERE = pathlib.Path(__file__).parent
BS = chr(92)          # a single backslash, without writing one


def sub(text, old, new, label, count=1):
    n = text.count(old)
    if n != count:
        sys.exit(f"BUILD FAIL: {label!r} matched {n}x, expected {count}x")
    return text.replace(old, new)


css = (HERE / "theme.css").read_text()
# The dashboard is three files (App.jsx, App.props.jsx, App.tabs.jsx). They are concatenated in order into one
# <script type="text/babel"> block, so they behave exactly as the single
# file they used to be: App.jsx has the helpers and shared pieces,
# App.tabs.jsx has the tabs and the root component.
app = "\n".join((HERE / f).read_text() for f in ("App.jsx", "App.props.jsx", "App.nba.jsx", "App.board.jsx", "App.research.jsx", "App.shell.jsx", "App.tabs.jsx"))

# The NBA tab can be driven from the Shell sidebar: pass view and noBar to use its own switch no more.
app = sub(app, "function NbaTab({ DATA }) {", "function NbaTab({ DATA, view: vProp, noBar }) {", "nba props")
app = sub(app, "  const [view, setView] = useState('picks');", "  const [iv, setView] = useState('picks');\n  const view = vProp || iv;", "nba view state")
app = sub(app, "  const viewBar = (\n", "  const viewBar = noBar ? null : (\n", "nba view bar")
app = sub(app, "const nbaSecs = [['picks', 'Best 5 today'], ", "const nbaSecs = [['picks', 'Best 5 today'], ['research', 'Player Research Center'], ", "nba sections")
app = sub(app, "{top === 'nba' && <NbaTab DATA={DATA} view={nsec} noBar />}", "{top === 'nba' && nsec === 'research' && <ResearchCenter DATA={DATA} />}\n            {top === 'nba' && nsec !== 'research' && <NbaTab DATA={DATA} view={nsec} noBar />}", "nba research view")
# The Board is now just the content panel; the Shell supplies the sidebar and frame.
_a = app.index("      <style>{BOARD_CSS}</style>\n      <div className=\"bd\">\n        <aside")
_b = app.index("</aside>\n", _a) + len("</aside>\n")
app = app[:_a] + app[_b:]
_s = app.index("function BoardTab(")
_e = app.index("// ============ Shell")
app = app[:_s] + sub(app[_s:_e], "        </div>\n      </div>\n    </section>\n  );\n}\n", "        </div>\n    </section>\n  );\n}\n", "board wrapper end") + app[_e:]
app = sub(app, "function BoardTab({ DATA, go }) {", "function BoardTab({ DATA }) {", "board props")
app = sub(app, "      <div className=\"dk\" style={{ margin: '8px 0 0 28px' }}>Only take it if your book has {need}. Tap for the reasoning.</div>\n",
          "      <div className=\"dk\" style={{ margin: '8px 0 0 28px' }}>Only take it if your book has {need}. Tap for the reasoning.</div>\n      <LineCheck c={c} />\n", "line check hook")
# The root component renders the Shell (two main tabs, NFL and NBA) instead of the old tab bar.
_i = app.index("  return (\n    <>\n      <Header meta={meta} />")
_j = app.index("function Notes(")
app = (app[:_i] + "  return (\n    <>\n      <Shell DATA={DATA} meta={meta} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />\n    </>\n  );\n}\n" + app[_j:])

# The prop tabs (Cheatsheets, Parlay Builder, Injuries) live in App.props.jsx.
# They are wired into the shell here rather than by editing App.jsx and
# App.tabs.jsx, so those two stay exactly as they were. Each substitution is
# asserted: if either file changes shape, the build fails loudly instead of
# shipping tabs that do not appear.
app = sub(app, "['pstats','Player Stats']];",
          "['pstats','Player Stats'],['sheets','Cheatsheets'],['pairs','Parlay Builder'],['inj','Injuries'],['nba','NBA'],['board','Board']];",
          "prop tab buttons")
# The Card's touchdown list is the top 15 by probability: a flat ranked list instead
# of the old per-team grid. The old view is left in place behind a key that is never set.
app = sub(app, "{view === 'td' && (",
          "{view === 'td' && <TopPicksView P={P} players={DATA.players} />}\n"
          "      {view === 'tdOld' && (", "card td view")
app = sub(app, "['td', `Touchdown picks (${td.length})`]", "['td', `Touchdown picks (${tdCount(P)})`]", "card td label")
app = sub(app, """            <> Touchdown picks are capped per team by that team's projected points: <b>{P.cap_rule}</b>.
            A team projected for 22 points gets two picks, not five, so the scorer board and the
            game projection cannot contradict each other.</>""",
          """            <> Touchdown card: <b>{P.cap_rule}</b>. Fewer picks, higher conviction.</>""", "card cap note")
# Nine tabs do not fit a phone: let the bar scroll sideways instead of widening
# the page, and keep each label on one line. Plus the win/loss colours the prop
# tabs use inside bold text.
css += (
    "\n.tabs{overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}"
    "\n.tab{white-space:nowrap;flex:none}"
    "\nb.up{color:var(--pos)}b.down{color:var(--neg)}\n"
)
# White and black theme with red / green / grey for matchups, layered over the base styles.
css += (HERE / "theme.board.css").read_text()
team_line = (HERE / "team.js").read_text().strip()
logo_line = (HERE / "logos.js").read_text().strip()
mount = (HERE / "mount.js").read_text().strip()
logo = (HERE / "logo_b64.txt").read_text().strip()
data = json.loads((HERE / "data.json").read_text())
# The game model is built separately by games.py and folded in here, so a build
# still succeeds on a machine that has not run it yet -- the Games tab just says
# so instead of the page failing to render.
gm = HERE / "games.json"
data["games_model"] = json.loads(gm.read_text()) if gm.exists() else None
# NBA projections are built separately by nba.py. A missing or empty file just
# leaves the NBA tab saying it is waiting for data.
nb = HERE / "nba.json"
data["nba"] = json.loads(nb.read_text()) if nb.exists() else None
_logs = {}
if data["nba"]:
    for _p in data["nba"].get("players", []):
        _logs[_p.get("id")] = _p.get("log20") or []
        _p["logs"] = {s: [g[s] for g in (_p.get("log20") or []) if g.get(s) is not None] for s in ("pts", "reb", "ast", "fg3", "pra")}
        _p.pop("log20", None)          # raw logs are for nba_picks.py only
# Daily best 5 props and the running record, built by nba_picks.py. Missing is fine.
npk = HERE / "nba_picks.json"
data["nba_picks"] = json.loads(npk.read_text()) if npk.exists() else None
# Today's picks carry their last 20 raw values so the page can check a sportsbook line.
if data["nba_picks"] and (data["nba_picks"].get("card") or {}).get("picks"):
    for _c in data["nba_picks"]["card"]["picks"]:
        _c["log"] = [g.get(_c["stat"]) for g in _logs.get(_c["pid"], []) if g.get(_c["stat"]) is not None]
# The daily board note (injury flags and notes), written each morning by the scheduled run.
dj = HERE / "daily.json"
data["daily"] = json.loads(dj.read_text()) if dj.exists() else None
embed = json.dumps(data, separators=(",", ":"))

app = sub(app, "__LOGO_DATA_URI__", logo, "logo data URI")

# ---------------------------------------------------------------- web build
head = (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    "<title>TransferSportal — NFL Anytime TD Model</title>"
    '<meta name="description" content="TransferSportal ranks the best anytime-touchdown bets each week '
    'and prices the model against the book.">'
    f'<link rel="icon" href="{logo}">'
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&'
    'family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>'
)
scripts = (
    '</style></head><body><div id="root"></div>'
    '<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>'
    '<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js"></script>'
)
# The data, the team map and the logo art are plain JS -- putting them in their
# own script tag keeps Babel from parsing half a megabyte of string literals in
# the browser on every page load. Only the JSX below needs transforming.
data_block = (
    "<script>\nconst EMBED = " + embed + ";\n"
    + team_line + "\n" + logo_line + "\n</script>"
)
html = (
    head + css + scripts + data_block
    + '<script type="text/babel" data-presets="react">\n'
    + app + "\n\n"
    + mount + "\n"
    + "</script></body></html>"
)
(HERE / "index.html").write_text(html)

# ----------------------------------------------------------- NearbiJSX build
n = app

n = sub(
    n,
    """function App({ initialData }) {
  const [DATA, setData] = useState(initialData);
  const [tab, setTab] = useState('picks');

  useEffect(() => {
    try {
      fetch('./data.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setData(withHelpers(d)); })
        .catch(()=>{});
    } catch (e) { /* no fetch available -- keep the embedded data */ }
  }, []);
""",
    """function App() {
  const [DATA] = useState(() => withHelpers(EMBED));
  const [tab, setTab] = useState('picks');

  // NearbiJSX sandboxes network access, so this build has no live refresh --
  // it renders the embedded snapshot exactly as generated. Deploy the
  // GitHub Pages version (index.html) for the auto-updating site.
""",
    "nearbi App root",
)

n = sub(n, "    <>\n      <Shell DATA={DATA}",
        "    <>\n      <style>{APP_CSS}</style>\n      <Shell DATA={DATA}",
        "nearbi style injection")

n = sub(n, "const { useState, useMemo, useEffect } = React;",
        "const { useState, useMemo } = React;", "nearbi drop useEffect")

# Both builds draw the same inlined logos; the offline one just reads them from
# module-level consts instead of window, since it has no page to attach them to.
n = sub(n, "window.CREST && window.CREST[t]", "CREST[t]", "nearbi crest lookup")
n = n.replace("window.TEAM", "TEAM").replace("window.CREST", "CREST")
for leaked in ("window.TEAM", "window.CREST"):
    if leaked in n:
        sys.exit(f"BUILD FAIL: {leaked} still present in the NearbiJSX build")

team_nearbi = team_line.replace("window.TEAM =", "const TEAM =")
logo_nearbi = logo_line.replace("window.CREST =", "const CREST =")

nearbi = (
    "const EMBED = " + embed + ";\n"
    + team_nearbi + "\n"
    + logo_nearbi + "\n"
    # BS is a single backslash. Spelled with chr() rather than as a literal so
    # this line survives being transmitted through JSON-escaped tooling, where
    # a miscounted backslash silently breaks the offline build's CSS escaping.
    + "const APP_CSS = `" + css.replace(BS, BS * 2).replace("`", BS + "`").replace("${", BS + "${") + "`;\n\n"
    + n
    + "\n\nexport default App;\n"
)
# keep the file-leading comment at the very top
lead_end = n.index("*/") + 2
nearbi = n[:lead_end] + "\n\n" + nearbi.replace(n[:lead_end], "", 1)
(HERE / "App.NearbiJSX.jsx").write_text(nearbi)

print(f"index.html          {len(html):>9,} chars")
print(f"App.NearbiJSX.jsx   {len(nearbi):>9,} chars")
print(f"players             {len(data['players']):>9,}")
