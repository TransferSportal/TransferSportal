// ============ Played bets ============
// Singles and parlays are kept apart. Everything lives in the page's private database (collection "bets").
//   type "single": one prop.     type "parlay": legs[] graded by the runs; the page works out win/loss from the legs.
//   type "game": your own spread pick for an NFL game.
// A leg: {key, sport, name, team, opp, gameDate, stat, line, side, verdict, proj, season?, week?}
const STAT_NAME = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3PM', pra: 'PRA', ry: 'rec yds', rc: 'rec', ruy: 'rush yds', py: 'pass yds', td: 'anytime TD' };
const SLIP = { legs: [], subs: new Set() };
function slipSet(legs) { SLIP.legs = legs; SLIP.subs.forEach(f => f()); }
function useSlip() {
  const [, f] = useState(0);
  useEffect(() => { const fn = () => f(x => x + 1); SLIP.subs.add(fn); return () => { SLIP.subs.delete(fn); }; }, []);
  return SLIP.legs;
}
function useBets() {
  const [st, setSt] = useState({ db: null, bets: [], ok: null });
  useEffect(() => {
    let off = () => {}, dead = false;
    (async () => {
      try {
        if (!window.claude || !window.claude.use) { setSt(s => ({ ...s, ok: false })); return; }
        const db = await window.claude.use('db');
        if (dead) return;
        if (!db) { setSt(s => ({ ...s, ok: false })); return; }
        off = db.collection('bets').onSnapshot(
          q => setSt({ db, ok: true, bets: q.docs.map(d => ({ id: d.id, ...d.data() })) }),
          () => setSt(s => ({ ...s, ok: false })));
      } catch (e) { setSt(s => ({ ...s, ok: false })); }
    })();
    return () => { dead = true; off(); };
  }, []);
  return st;
}
function legText(l) {
  if (l.stat === 'td') return l.name + ' anytime TD' + (l.line ? ' (' + l.line + ')' : '');
  return l.name + ' ' + (l.side === 'over' ? 'O' : 'U') + ' ' + l.line + ' ' + (STAT_NAME[l.stat] || l.stat);
}
function mkLeg(o) {
  const slug = String(o.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const key = [o.sport, o.gameDate, o.pid || slug, o.stat, o.side, o.line].join('_').replace(/[^A-Za-z0-9_.+-]/g, '');
  return { key, ...o };
}
function parlayStatus(b) {
  const s = (b.legs || []).map(l => l.status || 'pending');
  if (s.includes('loss')) return 'loss';
  if (s.includes('pending')) return 'pending';
  if (s.every(x => x === 'push' || x === 'void')) return 'push';
  return 'win';
}

// ---- money ----
function amDec(o) { o = Number(o); if (!o || Math.abs(o) < 100) return null; return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o); }
function betState(b) { return b.type === 'parlay' ? parlayStatus(b) : b.status; }
// profit in dollars for a graded bet; null when it cannot be worked out yet
function betPL(b) {
  const st = Number(b.stake) || 0, s = betState(b);
  if (!st) return null;
  if (s === 'loss') return -st;
  if (s === 'push' || s === 'void') return 0;
  if (s === 'win') { const d = amDec(b.odds); return d ? st * (d - 1) : null; }
  return null;
}
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const bkPct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
function BetEdit({ b }) {
  const { db } = useBets();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ stake: b.stake || '', odds: b.odds || '', book: b.book || '', alt: !!b.alt });
  const [msg, setMsg] = useState('');
  const inp = { background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 8px', color: 'var(--ink)', fontSize: 13, width: 84 };
  const sum = b.stake ? '$' + b.stake + (b.odds ? ' at ' + (Number(b.odds) > 0 ? '+' : '') + b.odds : ' (no odds yet)') + (b.book ? ' · ' + b.book : '') + (b.alt ? ' · alt line' : '') : 'Add stake and odds';
  const save = async () => {
    if (!db) return;
    try {
      await db.collection('bets').doc(b.id).update({ stake: Number(f.stake) || 0, odds: Number(f.odds) || 0, book: f.book.trim(), alt: !!f.alt });
      setMsg('Saved'); setOpen(false);
    } catch (e) { setMsg('Could not save'); }
  };
  return (
    <div style={{ marginTop: 4 }}>
      <span className="rcSub" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setOpen(!open)}>{sum}</span>
      {open && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <input style={inp} inputMode="decimal" placeholder="Stake $" value={f.stake} onChange={e => setF({ ...f, stake: e.target.value })} />
          <input style={inp} inputMode="numeric" placeholder="Odds +450" value={f.odds} onChange={e => setF({ ...f, odds: e.target.value })} />
          <input style={{ ...inp, width: 110 }} list="bookList" placeholder="Book" value={f.book} onChange={e => setF({ ...f, book: e.target.value })} />
          <datalist id="bookList"><option value="FanDuel" /><option value="DraftKings" /><option value="BetMGM" /><option value="Caesars" /><option value="Fanatics" /><option value="Other" /></datalist>
          <label className="rcSub" style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.alt} onChange={e => setF({ ...f, alt: e.target.checked })} />Alt line</label>
          <button onClick={save} style={{ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid var(--ink)', background: 'var(--ink)', color: '#0d0f12' }}>Save</button>
          {msg && <span className="rcSub">{msg}</span>}
        </div>
      )}
    </div>
  );
}
function Bankroll() {
  const { db, bets, ok } = useBets();
  const cfg = bets.find(b => b.id === 'config') || {};
  const [sb, setSb] = useState('');
  if (ok === false) return <div className="rcMain"><div className="rcSub">Bankroll saves on your private link when you are signed in.</div></div>;
  const real = bets.filter(b => b.type === 'single' || b.type === 'parlay' || (!b.type && b.id !== 'config'));
  const staked = real.filter(b => Number(b.stake) > 0);
  const graded = staked.filter(b => ['win', 'loss', 'push', 'void'].includes(betState(b)));
  const noOdds = graded.filter(b => betState(b) === 'win' && !amDec(b.odds));
  const priced = graded.filter(b => betPL(b) !== null);
  const risk = staked.filter(b => betState(b) === 'pending').reduce((a, b) => a + Number(b.stake), 0);
  const noStake = real.length - staked.length;
  const agg = rows => { const st = rows.reduce((a, b) => a + Number(b.stake), 0), pl = rows.reduce((a, b) => a + betPL(b), 0); return { n: rows.length, st, pl, roi: st ? pl / st * 100 : 0 }; };
  const tot = agg(priced);
  const start = Number(cfg.start) || 0;
  const rowsDef = [
    ['Singles', priced.filter(b => b.type === 'single' || !b.type)],
    ['Parlays', priced.filter(b => b.type === 'parlay')],
    ['NBA singles', priced.filter(b => (b.type === 'single' || !b.type) && (b.sport || 'nba') === 'nba')],
    ['NFL singles', priced.filter(b => (b.type === 'single' || !b.type) && b.sport === 'nfl')],
    ['Alt lines', priced.filter(b => b.alt)]
  ];
  const books = {};
  priced.forEach(b => { const k = b.book || 'No book'; (books[k] = books[k] || []).push(b); });
  const saveStart = async () => {
    if (!db) return;
    try { await db.collection('bets').doc('config').set({ type: 'config', start: Number(sb) || 0 }); setSb(''); } catch (e) { /* refused */ }
  };
  const col = n => n > 0 ? 'var(--pos)' : n < 0 ? 'var(--neg)' : 'var(--ink2)';
  const cell = { padding: '6px 8px', fontSize: 13, textAlign: 'right' };
  const inp = { background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 8px', color: 'var(--ink)', fontSize: 13, width: 110 };
  const line = (label, a) => <tr key={label}><td style={{ ...cell, textAlign: 'left' }}>{label}</td><td style={cell}>{a.n}</td><td style={cell}>{money(a.st)}</td><td style={{ ...cell, color: col(a.pl), fontWeight: 700 }}>{money(a.pl)}</td><td style={{ ...cell, color: col(a.roi) }}>{a.n ? bkPct(a.roi) : '-'}</td></tr>;
  return (
    <section>
      <h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Bankroll &amp; profit</h2>
      <div className="rcMain">
        <div className="rcFacts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
          <div className="rcF">Profit<b style={{ color: col(tot.pl) }}>{money(tot.pl)}</b></div>
          <div className="rcF">ROI<b style={{ color: col(tot.roi) }}>{tot.n ? bkPct(tot.roi) : '-'}</b></div>
          <div className="rcF">{start ? 'Balance' : 'Total staked'}<b>{start ? money(start + tot.pl) : money(tot.st)}</b></div>
          <div className="rcF">At risk now<b>{money(risk)}</b></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <input style={inp} inputMode="decimal" placeholder={start ? 'Start: $' + start : 'Starting bankroll $'} value={sb} onChange={e => setSb(e.target.value)} />
          <button onClick={saveStart} style={{ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)' }}>Set</button>
          <span className="rcSub">Balance = starting bankroll plus profit on graded bets.</span>
        </div>
      </div>
      {!!(noStake || noOdds.length) && <div className="rcSub" style={{ marginTop: 10 }}>{noStake ? noStake + ' saved bet' + (noStake === 1 ? ' has' : 's have') + ' no stake yet, so ' + (noStake === 1 ? 'it is' : 'they are') + ' left out. Tap "Add stake and odds" on the bet in the Player Research Center. ' : ''}{noOdds.length ? noOdds.length + ' won bet' + (noOdds.length === 1 ? ' needs' : 's need') + ' odds before profit counts.' : ''}</div>}
      <div className="rcMain" style={{ marginTop: 14, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['', 'Bets', 'Staked', 'Profit', 'ROI'].map((h, i) => <th key={i} className="rcSub" style={{ ...cell, textAlign: i ? 'right' : 'left', fontWeight: 600 }}>{h}</th>)}</tr></thead>
          <tbody>
            {line('All graded', tot)}
            {rowsDef.map(([l, r]) => r.length ? line(l, agg(r)) : null)}
            {Object.keys(books).sort().map(k => line(k, agg(books[k])))}
          </tbody>
        </table>
      </div>
      <div className="rcSub" style={{ marginTop: 10 }}>Win profit = stake times the payout from the odds you typed. A loss is minus the stake. A push or void is zero. Pending bets count as money at risk.</div>
    </section>
  );
}
function PlayControls({ leg }) {
  const { db, bets, ok } = useBets();
  const slip = useSlip();
  const [busy, setBusy] = useState(false);
  const sid = 'single_' + leg.key;
  const have = bets.find(b => b.id === sid);
  const onSlip = slip.some(l => l.key === leg.key);
  if (ok === false) return <div className="rcSub" style={{ marginBottom: 12 }}>Played buttons save on your private link when you are signed in.</div>;
  const single = async () => {
    if (!db || busy) return;
    setBusy(true);
    try {
      const ref = db.collection('bets').doc(sid);
      if (have) { if (have.status === 'pending') await ref.delete(); }
      else await ref.set({ type: 'single', ...leg, status: 'pending', placedAt: new Date().toISOString() });
    } catch (e) { /* refused: stays unsaved */ }
    setBusy(false);
  };
  const toggleSlip = () => slipSet(onSlip ? slip.filter(l => l.key !== leg.key) : slip.concat([leg]));
  const b = (on, ac) => ({ appearance: 'none', cursor: 'pointer', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, border: '1px solid ' + (on ? 'var(--pos)' : 'var(--ink)'), background: on ? 'var(--posBg)' : ac ? 'var(--ink)' : 'transparent', color: on ? 'var(--pos)' : ac ? '#0d0f12' : 'var(--ink)' });
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <button style={b(!!have, true)} disabled={!db || busy} onClick={single}>{have ? 'Single saved' + (have.status === 'pending' ? ' (tap to undo)' : '') : 'Play as single'}</button>
      <button style={b(onSlip, false)} onClick={toggleSlip}>{onSlip ? 'On parlay slip (tap to remove)' : 'Add to parlay slip'}</button>
      {have && <div style={{ flexBasis: '100%' }}><BetEdit b={have} /></div>}
    </div>
  );
}
// Called from the NBA verdict. Pass verdicts can be played too: you may be fading the model.
function PlayedBtn({ p, stat, L, v, nx, proj }) {
  if (!v || v.blocked) return null;
  const leg = mkLeg({ sport: 'nba', pid: p.id, name: p.name, team: p.team, opp: nx.opp || '', gameDate: rcEt(nx.date), stat, line: L, side: v.best.side, verdict: v.word, proj: Math.round(proj * 100) / 100 });
  return <PlayControls leg={leg} />;
}
function SlipBar() {
  const slip = useSlip();
  const { db, ok } = useBets();
  const [busy, setBusy] = useState(false);
  const [pf, setPf] = useState({ stake: '', odds: '', book: '', alt: false });
  if (!slip.length || ok === false) return null;
  const place = async () => {
    if (!db || busy || slip.length < 2) return;
    setBusy(true);
    try {
      await db.collection('bets').doc('parlay_' + Date.now()).set({ type: 'parlay', legs: slip.map(l => ({ ...l, status: 'pending' })), status: 'pending', placedAt: new Date().toISOString(), stake: Number(pf.stake) || 0, odds: Number(pf.odds) || 0, book: pf.book.trim(), alt: !!pf.alt });
      slipSet([]); setPf({ stake: '', odds: '', book: '', alt: false });
    } catch (e) { /* refused */ }
    setBusy(false);
  };
  return (
    <div className="rcMain" style={{ marginBottom: 14, borderColor: 'var(--ink)' }}>
      <div className="rcName" style={{ fontSize: 16 }}>Parlay slip · {slip.length} leg{slip.length === 1 ? '' : 's'}</div>
      {slip.map(l => (
        <div key={l.key} className="rcP" style={{ cursor: 'default' }}>
          <span><b>{legText(l)}</b> <span style={{ color: 'var(--ink2)' }}>({l.sport.toUpperCase()}, {l.verdict}, {l.gameDate})</span></span>
          <span style={{ cursor: 'pointer', color: 'var(--neg)' }} onClick={() => slipSet(slip.filter(x => x.key !== l.key))}>remove</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['stake', 'Stake $', 84], ['odds', 'Odds +450', 92], ['book', 'Book', 100]].map(([k, ph, w]) => <input key={k} placeholder={ph} value={pf[k]} onChange={e => setPf({ ...pf, [k]: e.target.value })} style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px', color: 'var(--ink)', fontSize: 13, width: w }} />)}
        <label className="rcSub" style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={pf.alt} onChange={e => setPf({ ...pf, alt: e.target.checked })} />Alt line</label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={slip.length < 2 || busy} onClick={place} style={{ appearance: 'none', cursor: slip.length < 2 ? 'default' : 'pointer', opacity: slip.length < 2 ? 0.5 : 1, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, border: '1px solid var(--ink)', background: 'var(--ink)', color: '#0d0f12' }}>Place parlay</button>
        <button onClick={() => slipSet([])} style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--ink2)', fontSize: 13 }}>Clear slip</button>
        <span className="rcSub">{slip.length < 2 ? 'Add at least 2 legs.' : 'Hits only if every leg hits. A push drops that leg.'}</span>
      </div>
    </div>
  );
}
function resCol(s) { return s === 'win' ? 'var(--pos)' : s === 'loss' ? 'var(--neg)' : 'var(--ink2)'; }
function tally(rows, f) {
  const c = { w: 0, l: 0, p: 0, n: 0 };
  rows.forEach(b => { const s = f(b); if (s === 'win') c.w++; else if (s === 'loss') c.l++; else if (s === 'push') c.p++; else if (s === 'pending') c.n++; });
  return c;
}
const tstr = c => c.w + '-' + c.l + (c.p ? '-' + c.p : '') + (c.n ? ' · ' + c.n + ' pending' : '');
function BetsPanel({ only }) {
  const { bets, ok } = useBets();
  if (ok === false) return null;
  const all = bets.slice().sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''));
  const singles = all.filter(b => b.id !== 'config' && (b.type || 'single') === 'single');
  const parlays = all.filter(b => b.type === 'parlay');
  const games = all.filter(b => b.type === 'game');
  const box = { marginTop: 14 };
  if (only === 'games') {
    const sg = s => s.status;
    const dis = games.filter(b => b.modelTeam && b.modelTeam !== b.pickTeam);
    if (!games.length) return <div className="rcSub" style={box}>Your game picks record starts when a game you picked is graded.</div>;
    return (
      <div className="rcMain" style={box}>
        <div className="rcName" style={{ fontSize: 17 }}>Your game picks <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(tally(games, sg))}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>When you disagreed with the model: {tstr(tally(dis, sg))}</div>
        {games.slice(0, 40).map(b => (
          <div key={b.id} className="rcP" style={{ cursor: 'default' }}>
            <span><b>{b.pickTeam} {b.line > 0 ? '+' : ''}{b.line}</b> <span style={{ color: 'var(--ink2)' }}>({b.away} @ {b.home}, wk {b.week}; model {b.modelPick})</span></span>
            <span style={{ color: resCol(b.status), fontWeight: 700 }}>{b.status === 'pending' ? 'Pending' : String(b.status).toUpperCase() + (b.final ? ' · ' + b.final : '')}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!singles.length && !parlays.length) return <div className="rcSub" style={box}>Your record: nothing saved yet. Use Play as single or build a parlay slip.</div>;
  const by = {};
  singles.forEach(b => { if (b.status === 'win' || b.status === 'loss') { const k = (b.sport || 'nba').toUpperCase() + ' ' + (STAT_NAME[b.stat] || b.stat); by[k] = by[k] || [0, 0]; by[k][b.status === 'win' ? 0 : 1]++; } });
  const pst = parlays.map(parlayStatus);
  const pc = tally(parlays, b => parlayStatus(b));
  const missed = parlays.filter(b => parlayStatus(b) === 'loss');
  const legsHit = missed.reduce((s, b) => s + b.legs.filter(l => l.status === 'win').length, 0), legsAll = missed.reduce((s, b) => s + b.legs.length, 0);
  return (
    <>
      <div className="rcMain" style={box}>
        <div className="rcName" style={{ fontSize: 17 }}>Singles record <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(tally(singles, b => b.status))}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>{Object.keys(by).map(k => k + ' ' + by[k][0] + '-' + by[k][1]).join(' · ') || 'Graded by the 9 a.m. and 4 p.m. runs after the game.'}</div>
        {singles.slice(0, 30).map(b => (
          <div key={b.id} className="rcP" style={{ cursor: 'default' }}>
            <span><b>{legText(b)}</b> <span style={{ color: 'var(--ink2)' }}>({(b.sport || 'nba').toUpperCase()}, {b.verdict}, {b.gameDate})</span></span>
            <span style={{ color: resCol(b.status), fontWeight: 700 }}>{b.status === 'pending' ? 'Pending' : String(b.status).toUpperCase() + (b.actual != null ? ' · ' + b.actual : '')}{betPL(b) !== null && <span style={{ marginLeft: 6 }}>{money(betPL(b))}</span>}</span>
          </div>
        ))}
      </div>
      <div className="rcMain" style={box}>
        <div className="rcName" style={{ fontSize: 17 }}>Parlays record <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(pc)}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>{missed.length ? 'On missed parlays, ' + legsHit + ' of ' + legsAll + ' legs hit.' : 'Win only if every leg hits.'}</div>
        {parlays.slice(0, 20).map((b, i) => (
          <div key={b.id} style={{ borderTop: '1px solid var(--line2)', padding: '9px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <b>{b.legs.length}-leg parlay</b>
              <span style={{ color: resCol(pst[parlays.indexOf(b)]), fontWeight: 700 }}>{pst[parlays.indexOf(b)] === 'pending' ? 'Pending' : pst[parlays.indexOf(b)].toUpperCase()}{betPL(b) !== null && <span style={{ marginLeft: 6 }}>{money(betPL(b))}</span>}</span>
            </div>
            <BetEdit b={b} />
            {b.legs.map(l => <div key={l.key} className="rcSub">{legText(l)} <span style={{ color: resCol(l.status) }}>{l.status && l.status !== 'pending' ? l.status + (l.actual != null ? ' · ' + l.actual : '') : 'pending'}</span></div>)}
          </div>
        ))}
      </div>
    </>
  );
}
