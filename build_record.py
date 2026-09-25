#!/usr/bin/env python3
"""
Build record.html -- the public track record page.

This is the page that goes in a bio link, so it is deliberately different from
the board: static HTML with the data baked in, no framework, no CDN, no fetch.
It opens instantly on a phone and still works if every external service is down.

The honest part of the design: the page does not ask to be trusted. Each week
links to that board file's commit history on GitHub, where the timestamp is
GitHub's rather than ours. Anyone can check that a pick existed before kickoff.
"""
import json, pathlib, html

HERE = pathlib.Path(__file__).parent
rec = json.loads((HERE / "record.json").read_text())
logos = json.loads((HERE / "logos.js").read_text().split("=", 1)[1].strip().rstrip(";"))
brand = (HERE / "logo_b64.txt").read_text().strip()
css = (HERE / "theme.css").read_text()
repo = rec["repo"]

tot = rec.get("totals") or {}
weeks = sorted(rec.get("weeks", []), key=lambda w: -w["week"])


def pct(hit, of):
    return round(hit / of * 100) if of else None


def crest(team):
    art = logos.get(team)
    if not art:
        return f'<span class="crestWrap crestFail" data-code="{html.escape(team)}"></span>'
    return (f'<span class="crestWrap"><img class="crest" alt="{html.escape(team)}" '
            f'src="data:image/png;base64,{art}"></span>')


# ---------------------------------------------------------------- headline
s12, o12 = tot.get("top12", 0), tot.get("top12_of", 0)
season_pct = pct(s12, o12)
bt = round(rec.get("backtest_top12", 0) * 100)
tone = "up" if season_pct is not None and season_pct >= bt else "down"

# weighted average base rate across graded weeks, for the lift figure
rates = [w["base_rate"] for w in weeks if w.get("base_rate")]
base = round(sum(rates) / len(rates) * 100) if rates else None
lift = round(season_pct / base, 1) if base and season_pct else None

RESULT_LABEL = {"hit": "TD", "miss": "no TD", "dnp": "did not play"}

# Week 1 was graded before board archiving existed, so there is no committed
# file for anyone to check. It is disclosed but deliberately kept OUT of the
# headline record: a track record that counts weeks it cannot prove is worth
# nothing. Stated here rather than dropped, so the page is not quietly
# flattering itself by omission either.
UNVERIFIED = {"week": 1, "top12": 8, "top12_of": 12,
              "why": "graded before board archiving began, so there is no committed file to check"}


def week_block(w):
    p12, p5, p24 = pct(w["top12"], w["top12_of"]), pct(w["top5"], w["top5_of"]), pct(w["top24"], w["top24_of"])
    br = round(w["base_rate"] * 100) if w.get("base_rate") else None
    wl = round(p12 / br, 1) if br and p12 else None
    commits = f"https://github.com/{repo}/commits/main/{w['file'].join(['boards/', ''])}"
    note = w.get("archive_note")
    def pick_row(p):
        extra = f' &times;{p["tds"]}' if p["tds"] > 1 else ''
        return (f'<tr class="r-{p["result"]}"><td class="rk">{p["rank"]}</td>'
                f'<td class="who">{crest(p["team"])}<span class="nm">{html.escape(p["name"])}</span>'
                f'<span class="pos">{p["pos"]}</span></td>'
                f'<td class="mp">{round(p["prob"]*100)}%</td>'
                f'<td class="res">{RESULT_LABEL[p["result"]]}{extra}</td></tr>')
    rows = "".join(pick_row(p) for p in w["picks"])
    return f"""
<section class="wk">
  <div class="wkTop">
    <div>
      <h2>Week {w['week']}</h2>
      <div class="stamp">Board published {html.escape((w.get('archived') or 'time not recorded').replace('T',' ').replace('Z',' UTC'))}
        {f'<span class="flag">{html.escape(note)}</span>' if note else ''}</div>
    </div>
    <div class="wkScore">
      <div class="big {'up' if p12 and br and p12 > br else 'down'}">{w['top12']}<span class="of">/{w['top12_of']}</span></div>
      <div class="sub">top 12 &middot; {p12}%</div>
    </div>
  </div>
  <div class="cuts">
    <span>Top 5 <b>{w['top5']}/{w['top5_of']}</b> <i>{p5}%</i></span>
    <span>Top 12 <b>{w['top12']}/{w['top12_of']}</b> <i>{p12}%</i></span>
    <span>Top 24 <b>{w['top24']}/{w['top24_of']}</b> <i>{p24}%</i></span>
    <span>Anyone's odds <b>{br}%</b></span>
    <span class="liftTag">Lift <b class="up">{wl}x</b></span>
  </div>
  <details>
    <summary>Every pick, graded</summary>
    <table class="picks"><tbody>{rows}</tbody></table>
    <p class="verify">Verify this week:
      <a href="{commits}" target="_blank" rel="noopener">commit history for {html.escape(w['file'])}</a>.
      GitHub timestamps the commit, not us.</p>
  </details>
</section>"""


page_css = """
.rec{max-width:760px;margin:0 auto;padding:0 20px 80px}
.hero{padding:34px 0 26px;border-bottom:1px solid var(--line)}
.heroNum{font-family:var(--num);font-size:60px;font-weight:600;letter-spacing:-.03em;line-height:1}
.heroNum .of{color:var(--ink3);font-size:30px}
.heroSub{font-size:14px;color:var(--ink2);margin-top:10px;line-height:1.6;max-width:56ch}
.excl{margin-top:14px;font-size:12px;line-height:1.6;color:var(--ink3);background:var(--sunk);
  border:1px solid var(--line2);border-left:2px solid var(--warn);border-radius:6px;padding:10px 13px;max-width:60ch}
.excl b{color:var(--warn)}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.kpi{flex:1;min-width:132px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px}
.kpi .k{font-size:10.5px;letter-spacing:.5px;color:var(--ink3);text-transform:uppercase}
.kpi .v{font-family:var(--num);font-size:21px;font-weight:600;margin-top:5px}
.wk{border-bottom:1px solid var(--line2);padding:22px 0}
.wkTop{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.wk h2{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em}
.stamp{font-family:var(--num);font-size:11px;color:var(--ink3);margin-top:4px}
.flag{display:block;color:var(--warn);margin-top:3px;font-family:var(--ui);font-size:10.5px}
.wkScore{text-align:right;flex:none}
.wkScore .big{font-family:var(--num);font-size:28px;font-weight:600;line-height:1}
.wkScore .big.up{color:var(--pos)}.wkScore .big.down{color:var(--neg)}
.wkScore .of{color:var(--ink3);font-size:17px}
.wkScore .sub{font-family:var(--num);font-size:10.5px;color:var(--ink3);margin-top:3px}
.cuts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;font-family:var(--num);font-size:11px;color:var(--ink3)}
.cuts span{background:var(--sunk);border:1px solid var(--line2);border-radius:99px;padding:4px 11px}
.cuts b{color:var(--ink);font-weight:600}
.cuts i{font-style:normal;color:var(--ink2)}
.liftTag b.up{color:var(--pos)}
details{margin-top:14px}
summary{cursor:pointer;font-size:12.5px;color:var(--ink3);padding:6px 0;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'+ ';font-family:var(--num);color:var(--pos)}
details[open] summary::before{content:'\\2212 '}
summary:hover{color:var(--ink)}
table.picks{width:100%;border-collapse:collapse;margin-top:6px}
table.picks td{padding:7px 8px;border-bottom:1px solid var(--line2);font-size:12.5px;vertical-align:middle}
table.picks td.rk{font-family:var(--num);font-size:11px;color:var(--ink3);width:26px;text-align:right}
table.picks td.who{display:flex;align-items:center;gap:9px}
table.picks .nm{font-weight:500;color:var(--ink)}
table.picks .pos{font-family:var(--num);font-size:9.5px;color:var(--ink3);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
table.picks td.mp{font-family:var(--num);font-size:12px;color:var(--ink2);text-align:right;width:52px}
table.picks td.res{font-family:var(--num);font-size:11.5px;text-align:right;width:104px;color:var(--ink3)}
tr.r-hit td.res{color:var(--pos);font-weight:600}
tr.r-miss td.res{color:var(--neg)}
tr.r-dnp{opacity:.45}
.verify{font-size:11.5px;color:var(--ink3);margin:10px 0 0;line-height:1.6}
.verify a{color:var(--pos)}
.how{margin-top:34px;padding-top:22px;border-top:1px solid var(--line);font-size:12.5px;line-height:1.7;color:var(--ink2)}
.how h3{font-size:13px;color:var(--ink);margin:0 0 10px}
.how p{margin:0 0 11px;max-width:66ch}
.how b{color:var(--ink)}
.how a{color:var(--pos)}
@media(max-width:560px){
  .heroNum{font-size:46px}
  .wkTop{flex-direction:column}
  .wkScore{text-align:left}
}
"""

weeks_html = "".join(week_block(w) for w in weeks) if weeks else (
    '<section class="wk"><p class="verify">No completed weeks graded yet. '
    'The first record appears once a published board has been played.</p></section>')

doc = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TransferSportal — Track Record</title>
<meta name="description" content="Every NFL anytime-touchdown board TransferSportal has published, graded against what actually happened.">
<link rel="icon" href="{brand}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>{css}{page_css}</style></head><body>
<header class="mast"><div class="mast-in">
  <div class="brand">
    <img class="brandMark" src="{brand}" alt="TransferSportal">
    <div><div class="wordmark">Transfer<b>Sportal</b></div>
      <div class="wtag">NFL anytime-TD model &middot; 2026 &middot; <span class="badge">track record</span></div></div>
  </div>
  <div class="meta"><a href="./index.html" style="color:var(--pos)">This week's board &rarr;</a></div>
</div></header>

<div class="rec">
  <div class="hero">
    <div class="heroNum {tone}">{s12}<span class="of">/{o12}</span></div>
    <div class="heroSub">Top-12 picks that scored a touchdown, across every week published so far.
      {f'That is <b>{season_pct}%</b> against <b>{base}%</b> for a random skill-position player, a <b>{lift}x</b> lift.' if base else ''}
      Boards are published before kickoff and never edited afterwards.</div>
    <div class="excl">Not counted above: <b>Week {UNVERIFIED['week']}</b> went
      {UNVERIFIED['top12']}/{UNVERIFIED['top12_of']}, but it was {UNVERIFIED['why']}.
      It stays out of the record on purpose. A number you cannot check should not
      help the number you are being sold.</div>
    <div class="kpis">
      <div class="kpi"><div class="k">Season top 12</div><div class="v {tone}">{season_pct}%</div></div>
      <div class="kpi"><div class="k">Backtest said</div><div class="v">{bt}%</div></div>
      <div class="kpi"><div class="k">Base rate</div><div class="v">{base}%</div></div>
      <div class="kpi"><div class="k">Weeks graded</div><div class="v">{len(weeks)}</div></div>
    </div>
  </div>

  {weeks_html}

  <div class="how">
    <h3>How to read this, and how to check it</h3>
    <p><b>What counts as a hit.</b> The player scored a rushing or receiving touchdown that week.
      Not a near miss, not yardage. A pick who did not take a snap is dropped from the count rather
      than recorded as a miss, which is the standard way a weekly hit rate is read. Every one of
      those is shown and labelled, so you can recount it the other way if you disagree.</p>
    <p><b>What the base rate is.</b> The share of all skill-position players with a stat line that
      week who scored. It is the honest benchmark: it is what you would hit picking names out of a
      hat. A hit rate only means something next to it.</p>
    <p><b>How you verify it.</b> Each week's board is a file committed to a public repository before
      the games are played. Expand a week and follow the commit link. The timestamp there is
      GitHub's, not ours, and the file cannot be changed after the fact without the edit showing in
      the history. Results are graded against
      <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a>,
      a public source neither of us controls.</p>
    <p><b>What this is not.</b> A small number of weeks is a small sample, and a good stretch can be
      luck. The backtest figure is what the model did over 18 out-of-sample weeks of a prior season,
      shown here so the live record has something to be measured against rather than standing alone.
      Nothing here is financial advice or a promise about future weeks.</p>
    <p class="verify">TransferSportal &middot;
      {html.escape(rec.get('generated','').replace('updated ',''))} &middot;
      <a href="https://github.com/{repo}" target="_blank" rel="noopener">source</a></p>
  </div>
</div></body></html>"""

(HERE / "record.html").write_text(doc)
print(f"record.html   {len(doc):>9,} chars   {len(weeks)} week(s) graded   season {s12}/{o12}")
