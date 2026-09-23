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
app = (HERE / "App.jsx").read_text()
team_line = (HERE / "team.js").read_text().strip()
logo_line = (HERE / "logos.js").read_text().strip()
mount = (HERE / "mount.js").read_text().strip()
logo = (HERE / "logo_b64.txt").read_text().strip()
data = json.loads((HERE / "data.json").read_text())
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

n = sub(n, "    <>\n      <Header meta={meta} />",
        "    <>\n      <style>{APP_CSS}</style>\n      <Header meta={meta} />",
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
