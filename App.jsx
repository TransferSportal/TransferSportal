/*
 * TransferSportal — NFL Anytime-TD Model, React/JSX dashboard
 * Loaded via React + ReactDOM + Babel Standalone (CDN, no build step).
 *
 * SPLIT ACROSS TWO FILES. build.py concatenates App.jsx and App.tabs.jsx in
 * that order into one <script type="text/babel"> block, so they behave as a
 * single file and function order does not matter. The split is here because a
 * 1,266-line component file is hard to read, and because each half then fits
 * comfortably inside the size a single API push carries intact.
 *
 * This half: pure calculation helpers, the header, the ticker, the Card, the
 * tab bar, the calibration notice, and the shared pieces the tabs reuse.
 * The other half: the tabs themselves and the root App component.
 */
// Logo is inlined as a data URI so the header renders with no network and no
// broken-image gap, in the browser and in the offline JSX preview alike.
const LOGO = '__LOGO_DATA_URI__';
// ---- pure calculation helpers, shared by every component ----
function trueRate(m, CURVE) {
  const xs = CURVE.map(p => p[0]), ys = CURVE.map(p => p[1]);
  if (m <= xs[0]) return ys[0] * m / xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (m <= xs[i]) { const t = (m - xs[i-1]) / (xs[i] - xs[i-1]); return ys[i-1] + t * (ys[i] - ys[i-1]); }
  }
  return ys[ys.length-1] + (m - xs[xs.length-1]);
}
const sig = x => 1 / (1 + Math.exp(-x));
const impl = o => o < 0 ? (-o) / (-o + 100) : 100 / (o + 100);
function calFor(pos, CALP, CAL) { return CALP[pos] || CAL; }
// The board ranks on one score and prices on another.
//
// Ranking uses the heavily shrunk inputs (eff_*), which order players well and
// stop a one-game sample from producing nonsense. Pricing uses the lightly
// shrunk inputs (pf_*) with their own calibration, because heavy shrinkage
// squashes every score toward the middle and leaves the probability running low
// on exactly the players it is most confident about. Graded out of sample, that
// early-season error on the top 200 was -5.6 points before and -0.0 after.
//
// Both are recomputed here rather than read off the file so the weight sliders
// still move the real numbers. A file built before the split has no pf_ fields,
// so pricing falls back to the ranking inputs and behaves exactly as it used to.
function blend(p, W, w, keys) {
  const hit = p[keys.hit] != null ? p[keys.hit] : p.season_hit;
  const a = Math.min((p[keys.rz10] != null ? p[keys.rz10] : p.rz_pg || 0) / 2.5, 1);
  const b = Math.min((p[keys.rz5] != null ? p[keys.rz5] : p.gl_pg || 0) / 1.2, 1);
  const y = Math.min((p[keys.yds] != null ? p[keys.yds] : p.yds_pg || 0) / 90, 1);
  const itt = p.itt != null ? Math.min(Math.max((p.itt - 15) / 13, 0), 1) : 0.5;
  return (W.wSea*hit + (W.wRZ/2)*a + (W.wRZ/2)*b + W.wTT*itt + W.wYD*y) / w;
}
const RANK_KEYS = { hit:'eff_hit', rz10:'eff_rz10', rz5:'eff_rz5', yds:'eff_yds' };
const PROB_KEYS = { hit:'pf_hit',  rz10:'pf_rz10',  rz5:'pf_rz5',  yds:'pf_yds'  };
function scoreOf(p, W, CALP, CAL, CALPP, CALP2) {
  const w = (W.wSea + W.wRZ + W.wTT + W.wYD) || 1;
  const s = blend(p, W, w, RANK_KEYS);
  const hasProbTrack = p.pf_hit != null;
  const ps = hasProbTrack ? blend(p, W, w, PROB_KEYS) : s;
  const c = hasProbTrack ? calFor(p.pos, CALPP || {}, CALP2 || calFor(p.pos, CALP, CAL))
                         : calFor(p.pos, CALP, CAL);
  return { score: Math.round(s*100), prob: sig(c.b0 + c.b1*ps) };
}
function matchupOf(p, DATA) {
  const o = p.next_opp, T = DATA.teams;
  if (!o || !T[p.team] || !T[o]) return null;
  const fieldMap = { RB:['ruY','ruT','rush'], WR:['reY','reT','rec'], TE:['reY','reT','rec'], QB:['paY','paT','pass'] };
  const [yk,,label] = fieldMap[p.pos] || ['reY','reT','rec'];
  const offNode = T[p.team].off, defNode = T[o].def;
  const offPos = (offNode&&offNode.pos[p.pos]) || {}, defPos = (defNode&&defNode.pos[p.pos]) || {};
  const offG = (offNode&&offNode.G) || 17, defG = (defNode&&defNode.G) || 17;
  const offY = (offPos[yk]||0)/offG, defY = (defPos[yk]||0)/defG;
  let soft = null;
  if (DATA.matchup[o] && DATA.matchup[o][p.pos]) soft = DATA.matchup[o][p.pos].soft_rank;
  return { mu: p.mu, label, offY, defY, opp: o, soft };
}
function matchupPct(p) {
  const hit = (p.eff_hit != null ? p.eff_hit : p.season_hit) || 0;
  const mult = p.mu != null ? Math.min(1.8, Math.max(0.6, p.mu)) : 1.0;
  return Math.min(0.95, Math.max(0.05, hit * mult));
}
// The price you get paid at is not the price the book believes. A -150 ticket
// reads 60.0% but carries the book's cut inside it; strip that and the book is
// really saying about 58.4%. Comparing the model to the raw number invents a
// negative edge on every favourite. So when the feed has handed us a devigged
// probability, the edge is measured against that. A hand-typed price has no
// devig available, and falls back to the raw implied number.
function betOf(p, prob, oddsStr, CURVE) {
  if (oddsStr == null || oddsStr === '' || isNaN(+oddsStr)) return null;
  const typed = p && p.dk_odds != null && +oddsStr !== +p.dk_odds;
  const fair = (!typed && p && p.fair_prob != null) ? p.fair_prob : impl(+oddsStr);
  const be = fair * 100, tr = trueRate(prob*100, CURVE);
  return { be, tr, value: tr - be, devigged: !typed && p && p.fair_prob != null };
}
const ord = n => { const s=['th','st','nd','rd'], v=n%100; return n + (s[(v-20)%10]||s[v]||s[0]); };

// ---- team color/logo lookups, attached to DATA so components can call DATA._tc(t) / DATA._crest(t) ----
// Logos are inlined as data URIs rather than fetched from a CDN: the board then
// renders identically online, offline and in the JSX preview, and cannot end up
// showing broken images because someone else moved a file. They sit on a soft
// off-white chip because a dozen of the marks -- Carolina, the Giants, Dallas,
// Arizona -- are nearly black themselves and vanish against this background.
function withHelpers(data) {
  data._tc = t => (window.TEAM[t] && window.TEAM[t].c) || '#6b7280';
  data._crest = t => {
    const T = window.TEAM[t], art = window.CREST && window.CREST[t];
    if (!art) return React.createElement('span',
      { className: 'crestWrap crestFail', 'data-code': t || '?', style: { '--cc': (T && T.c) || '#6b7280' } });
    return React.createElement('span',
      { className: 'crestWrap', 'data-code': t, style: { '--cc': T.c }, title: T.nick },
      React.createElement('img', {
        className: 'crest', src: 'data:image/png;base64,' + art, alt: t + ' logo',
      })
    );
  };
  return data;
}

// ---- paste-odds parser (DraftKings board -> name/price map) ----
const SUFFIX = new Set(['jr','sr','ii','iii','iv','v']);
function pnorm(s) {
  s = String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  s = s.replace(/[.'’]/g,'').replace(/-/g,' ');
  return s.split(/\s+/).filter(w=>w && !SUFFIX.has(w)).join(' ');
}
const ptight = s => pnorm(s).replace(/ /g,'');
function pinit(s) { const p=pnorm(s).split(' '); return p.length>1 ? p[0][0]+' '+p[p.length-1] : pnorm(s); }
function buildIdx(players) {
  const e={}, t={}, l={};
  const push=(m,k,p)=>{(m[k]=m[k]||[]).push(p);};
  players.forEach(p=>{push(e,pnorm(p.name),p);push(t,ptight(p.name),p);push(l,pinit(p.name),p);});
  return { e, t, l };
}
function parseOdds(text, players) {
  const idx = buildIdx(players);
  const applied = { first_td:{}, two_plus:{}, anytime:{} }, unmatched=[], ambiguous=[];
  const priceRe = /^[+−-]\d{2,4}$/;
  const lines = String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const pairs = []; let pending=null, bucket=[];
  const flush = () => { if (pending && bucket.length) pairs.push([pending, bucket.slice()]); pending=null; bucket=[]; };
  lines.forEach(line => {
    const clean = line.replace(/−/g,'-');
    const inline = clean.match(/^(.*?[A-Za-z].*?)[\s\t|,]+([+-]\d{2,4})\s*$/);
    if (inline) { flush(); pairs.push([inline[1],[inline[2]]]); return; }
    if (priceRe.test(clean)) { if (pending) bucket.push(clean.replace('−','-')); return; }
    if (/[A-Za-z]{2,}/.test(clean)) { flush(); pending = clean; }
  });
  flush();
  const ORDER = ['anytime','first_td','two_plus'];
  pairs.forEach(([rawName, prices]) => {
    let nm = rawName.replace(/\b(anytime|atd|td|scorer|yes|no|first|2\+|tds)\b/gi,'')
      .replace(/\([^)]*\)/g,'').replace(/[|,]/g,' ').replace(/\s{2,}/g,' ').trim();
    const teamHit = nm.match(/\b([A-Z]{2,3})\b\s*$/); let team=null;
    if (teamHit && teamHit[1]!==nm.trim()) { team=teamHit[1]; nm=nm.slice(0,teamHit.index).trim(); }
    if (nm.length<3) return;
    let hit=null;
    for (const [map,key] of [[idx.e,pnorm(nm)],[idx.t,ptight(nm)],[idx.l,pinit(nm)]]) {
      let cands = map[key] || [];
      if (team && cands.filter(p=>p.team===team).length) cands = cands.filter(p=>p.team===team);
      if (cands.length===1) { hit=cands[0]; break; }
      if (cands.length>1) { ambiguous.push(nm); return; }
    }
    if (!hit) { unmatched.push(nm); return; }
    prices.slice(0,3).forEach((raw,i) => { const v=parseInt(raw,10); applied[ORDER[i]][hit.name]=(v>0?'+':'')+v; });
  });
  return { applied, unmatched, ambiguous, found: pairs.length };
}

// American-odds equivalent of a probability, matching how a sportsbook would price it.
function probToAmerican(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}

const { useState, useMemo, useEffect } = React;

// ============ Header ============
function Header({ meta }) {
  const bt = meta.backtest || {};
  const wp = meta.weeks_played || 0;
  // The season-to-date top-12 record, graded from the archived boards. Shown
  // beside the backtest so the historical claim and the live result sit
  // together rather than the backtest standing alone.
  const lr = meta.live_record && meta.live_record.totals;
  const live = lr && lr.top12_of
    ? { hit: lr.top12, of: lr.top12_of, pct: Math.round(lr.top12 / lr.top12_of * 100) }
    : null;
  const liveTone = live ? (live.pct >= Math.round((bt.top12_hit || 0) * 100) ? 'up' : 'down') : '';
  return (
    <header className="mast">
      <div className="mast-in">
        <div className="brand">
          <img className="brandMark" src={LOGO} alt="TransferSportal" />
          <div>
            <div className="wordmark">Transfer<b>Sportal</b></div>
            <div className="wtag">NFL anytime-TD model &middot; 2026 &middot; <span className="badge">2026 form, 2025 baseline</span></div>
          </div>
        </div>
        <div className="meta">
          {wp > 0 && <>2026 week {wp} in &nbsp;&middot;&nbsp; </>}
          predicting <b>{meta.predict_week || '—'}</b> &nbsp;&middot;&nbsp; backtest{' '}
          <b>{Math.round((bt.top12_hit||0)*100)}%</b> top 12
          {live && <> &nbsp;&middot;&nbsp; <a className="recLink" href="./record.html">live <b className={liveTone}>{live.hit}/{live.of}</b> ({live.pct}%)</a></>}
          &nbsp;&middot;&nbsp;{' '}
          {(meta.generated||'').replace('updated ','') || 'auto-updates Tuesdays'}
        </div>
      </div>
    </header>
  );
}

// ============ Ticker tape ============
// The biggest disagreements between the model and the posted book price, the
// way a market screen shows its movers. Every number here is already computed:
// model probability run through the calibration curve, minus the book's
// implied probability. Green means the model is higher than the price.
function Ticker({ DATA, CURVE, CALP, CAL, CALPP, CALP2 }) {
  const ticks = useMemo(() => {
    const out = [];
    (DATA.players || []).forEach(p => {
      if (p.rostered === false || p.dk_odds == null) return;
      const { prob } = scoreOf(p, { wSea:32, wRZ:32, wYD:20, wTT:16 }, CALP, CAL, CALPP, CALP2);
      const b = betOf(p, prob, String(p.dk_odds), CURVE);
      if (!b) return;
      out.push({ name: p.name, team: p.team, value: b.value });
    });
    // Gainers and losers separately, the way a movers strip works. Sorting by
    // raw size would show only red: with one week of data the model shrinks
    // stars hard toward the positional mean, so the biggest gaps are all fades.
    out.sort((a, b) => b.value - a.value);
    return [...out.slice(0, 8), ...out.slice(-5)];
  }, [DATA, CURVE, CALP, CAL]);

  if (!ticks.length) return null;
  const last = n => { const s = n.split(' '); return s.length > 1 ? s[0][0] + '.' + s[s.length-1] : n; };
  return (
    <div className="ticker">
      <div className="tickerIn">
        <span className="tickLabel">EDGE</span>
        {ticks.map(t => (
          <span className={'tick ' + (t.value >= 0 ? 'up' : 'down')} key={t.name}>
            <span className="tickNm">{last(t.name)}</span>
            <span className="tickVal">
              <span className="tickArrow">{t.value >= 0 ? '▲' : '▼'}</span>
              {t.value >= 0 ? '+' : ''}{t.value.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ============ The Card ============
// The week's actual PICKS, locked before kickoff, and the graded record of every
// week that has finished.
//
// A ranked list of 424 players is not a record. You cannot grade it and nobody
// can check it. This tab is the part of the site that can be held to account: a
// fixed set of named picks, written to picks/<season>-week-<n>.json on the first
// build of the slate and never rewritten, so the commit history is the public
// timestamp.
//
// Touchdown picks are CAPPED PER TEAM by that team's projected points. Measured
// on real games a team's expected number of different scorers is about
// -0.02 + 0.0902 x points, so a 22-point team gets 2 picks and never more than
// 3. Without that cap the two halves of the site could contradict each other:
// the game model saying Philadelphia scores 22 while the board shows five
// Eagles near the top. Both look fine alone and together they are nonsense.
function CardTab({ DATA }) {
  const P = DATA.picks, R = DATA.picks_record;
  const [view, setView] = useState('td');
  if (!P) {
    return <div className="empty">No locked card in this build. Run <code>picks.py</code>.</div>;
  }
  const td = P.td_picks || [], gp = P.game_picks || [];
  const byTeam = {};
  td.forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  const teams = Object.keys(byTeam).sort(
    (a, b) => byTeam[b][0].team_proj_pts - byTeam[a][0].team_proj_pts);
  const tot = (R && R.totals) || {};
  const pct = v => (v == null ? null : (v * 100).toFixed(1) + '%');

  return (
    <>
      <div className="calNote" style={{ marginBottom: 12 }}>
        <div className="noteHead"><b>This is the card, and it is locked</b></div>
        <div className="noteBody" style={{ display: 'block' }}>
          These picks were written on the first build of the slate and are never rewritten, so
          every one of them was posted before its game kicked off. The lock time sits inside the
          file and in the commit history, which is what makes the record below checkable rather
          than claimed.
          {P.cap_rule && (
            <> Touchdown picks are capped per team by that team's projected points: <b>{P.cap_rule}</b>.
            A team projected for 22 points gets two picks, not five, so the scorer board and the
            game projection cannot contradict each other.</>
          )}
        </div>
      </div>

      <nav className="tabs" style={{ marginBottom: 10 }}>
        {[['td', `Touchdown picks (${td.length})`],
          ['games', `Game picks (${gp.length})`],
          ['record', 'Record']].map(([k, l]) => (
          <button key={k} className={'tab' + (view === k ? ' on' : '')}
                  onClick={() => setView(k)}>{l}</button>
        ))}
      </nav>

      {view === 'td' && (
        <div className="cardGrid">
          {teams.map(t => {
            const g = byTeam[t];
            return (
              <div className="cardTeam" key={t}>
                <div className="cardTeamHead">
                  <span className="cardTeamName">{t}</span>
                  <span className="cardTeamMeta">
                    {g[0].team_proj_pts} proj pts · {g[0].team_exp_scorers} expected scorers
                    · <b>{g[0].team_cap} pick{g[0].team_cap === 1 ? '' : 's'}</b>
                  </span>
                </div>
                {g.map(p => (
                  <div className="cardPick" key={p.name}>
                    <span className="cardPickN">{p.team_rank}</span>
                    <span className="cardPickName">{p.name}</span>
                    <span className="cardPickPos">{p.pos}</span>
                    <span className="cardPickProb">{Math.round((p.prob || 0) * 100)}%</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {view === 'games' && (
        <div className="cardGames">
          {gp.map((g, i) => (
            <div className="cardGame" key={i}>
              <div className="cardGameTeams">{g.away} <em>@</em> {g.home}</div>
              <div className="cardGameLine">
                line {g.spread_line > 0 ? `${g.home} -${g.spread_line}` : `${g.away} -${Math.abs(g.spread_line)}`}
                {' · o/u '}{g.total_line}
              </div>
              <div className="cardGamePick">
                <b>{g.ats_pick}</b>
                <span className={'cardTag' + (g.pick_is_dog ? ' dog' : '')}>
                  {g.pick_is_dog ? 'dog' : 'fav'}
                </span>
                <span className="cardOu">{g.ou_pick} {g.total_line}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'record' && (
        <div className="cardRecord">
          {!R || !R.weeks || !R.weeks.length ? (
            <div className="empty">
              Nothing graded yet. The card started locking in {P.season} Week {P.week}, so the
              first graded week appears once those games are final. An empty record is the
              honest state; a record that appeared out of nowhere would not be.
            </div>
          ) : (
            <>
              <div className="recTotals">
                <div className="recBox">
                  <div className="recLbl">Touchdown picks</div>
                  <div className="recNum">{tot.td && tot.td.hit}/{tot.td && tot.td.graded}</div>
                  <div className="recSub">{tot.td && pct(tot.td.rate)} hit</div>
                </div>
                <div className="recBox">
                  <div className="recLbl">Against the spread</div>
                  <div className="recNum">{tot.ats && tot.ats.w}-{tot.ats && tot.ats.l}</div>
                  <div className="recSub">
                    {tot.ats && pct(tot.ats.rate)} · break-even {pct(tot.breakeven)}
                  </div>
                </div>
                <div className="recBox">
                  <div className="recLbl">Totals</div>
                  <div className="recNum">{tot.ou && tot.ou.w}-{tot.ou && tot.ou.l}</div>
                  <div className="recSub">
                    {tot.ou && pct(tot.ou.rate)} · break-even {pct(tot.breakeven)}
                  </div>
                </div>
              </div>
              {R.weeks.slice().reverse().map(w => (
                <div className="recWeek" key={w.week}>
                  <div className="recWeekHead">
                    <b>Week {w.week}</b>
                    <span>
                      TD {w.td.hit}/{w.td.graded} · ATS {w.ats.w}-{w.ats.l} · O/U {w.ou.w}-{w.ou.l}
                    </span>
                  </div>
                  <div className="recWeekBody">
                    {w.games.map((g, i) => (
                      <div className="recGame" key={i}>
                        <span>{g.away} @ {g.home} {g.score}</span>
                        <span className={'recRes ' + (g.ats || '')}>{g.ats_pick} {g.ats}</span>
                        <span className={'recRes ' + (g.ou || '')}>{g.ou_pick} {g.ou}</span>
                      </div>
                    ))}
                    {w.td.picks.map((p, i) => (
                      <div className="recGame" key={'t' + i}>
                        <span>{p.name} <em>{p.team}</em></span>
                        <span className={'recRes ' + (p.result === 'hit' ? 'win'
                          : p.result === 'miss' ? 'loss' : 'push')}>
                          {p.result}{p.tds ? ` (${p.tds})` : ''}
                        </span>
                        <span />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ============ Tabs ============
function Tabs({ tab, setTab }) {
  const tabs = [['picks','Predictions'],['card','The Card'],['games','Games'],['matchups','Matchups'],['team','Team Stats'],['pstats','Player Stats']];
  return (
    <nav className="tabs">
      {tabs.map(([k,l]) => (
        <button key={k} className={'tab' + (tab===k?' on':'')} onClick={()=>setTab(k)}>{l}</button>
      ))}
    </nav>
  );
}

// ============ Calibration notice ============
// Measures, live from the shipped prices, how far the model sits below the book
// at each price tier. Early in the season the shrinkage compresses every rate
// toward the positional mean, so the model cannot reach the high probabilities
// the book posts on workhorses -- which makes a big negative "edge" on chalk an
// artifact, not a fade. This checks for that rather than assuming it, so once
// enough weeks accumulate and the gap closes, the notice stops rendering.
function CalibrationNote({ DATA, CURVE, CALP, CAL, CALPP, CALP2 }) {
  const gap = useMemo(() => {
    const chalk = [];
    (DATA.players || []).forEach(p => {
      if (p.rostered === false || p.dk_odds == null) return;
      // measured against the devigged price, same as the edge column, so the
      // notice reports a real calibration gap and not the book's cut
      const bk = (p.fair_prob != null ? p.fair_prob : impl(+p.dk_odds)) * 100;
      if (bk < 45) return;
      const { prob } = scoreOf(p, { wSea:32, wRZ:32, wYD:20, wTT:16 }, CALP, CAL, CALPP, CALP2);
      chalk.push(trueRate(prob*100, CURVE) - bk);
    });
    if (chalk.length < 8) return null;
    return chalk.reduce((a, b) => a + b, 0) / chalk.length;
  }, [DATA, CURVE, CALP, CAL]);

  const [open, setOpen] = useState(false);
  if (gap == null || gap > -8) return null;
  const wk = DATA.meta.weeks_played || 1;
  return (
    <div className="calNote">
      <button className="noteHead" onClick={()=>setOpen(v=>!v)}>
        <span><b>Read the edge with care on favourites</b> — the model sits {Math.abs(gap).toFixed(0)} pts under the book on short prices</span>
        <span className="noteChev">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="noteBody">
          On players the book prices at 45% or better, the model is averaging {Math.abs(gap).toFixed(0)} points
          below the market. With {wk} week{wk === 1 ? '' : 's'} of data, most of each player's rate is still the
          positional average, so the model cannot reach the numbers the book posts on workhorses. Treat a big red
          edge on a short price as the sample talking, not a fade. Edges on longshots are the ones worth reading —
          there the model and the book currently agree to within a point.
        </div>
      )}
    </div>
  );
}
