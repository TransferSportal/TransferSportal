// ============ Prop tabs: Cheatsheets, Parlay Builder, Injuries ============
//
// All three read DATA.props, which props.py builds from nflverse weekly stats:
// every eligible player's last 12 games (this season and last), with the
// opponent and home/away for each. Nothing here is a posted line. DraftKings
// prices are not loaded, so every hit rate is against a number the reader picks,
// and the detail panels let them type the real line and the real odds.
//
// A player's "hit" at a number T is a game where the stat reached T or more.
// That reads "40+ receiving yards", which is the same as Over 39.5.
//
// These are function declarations on purpose: the three files are joined into
// one script block, and declarations hoist across the join.

const PM = [
  { k: 'ry',  label: 'Receiving yards', ix: 4,  pos: ['WR','TE','RB'], from: 10,  to: 150, step: 5, unit: 'rec yds' },
  { k: 'rc',  label: 'Receptions',      ix: 5,  pos: ['WR','TE','RB'], from: 2,   to: 11,  step: 1, unit: 'rec' },
  { k: 'ruy', label: 'Rushing yards',   ix: 7,  pos: ['RB','QB'],      from: 10,  to: 120, step: 5, unit: 'rush yds' },
  { k: 'ra',  label: 'Rush attempts',   ix: 8,  pos: ['RB'],           from: 4,   to: 25,  step: 1, unit: 'carries' },
  { k: 'py',  label: 'Passing yards',   ix: 9,  pos: ['QB'],           from: 150, to: 350, step: 5, unit: 'pass yds' },
  { k: 'pc',  label: 'Completions',     ix: 10, pos: ['QB'],           from: 12,  to: 32,  step: 1, unit: 'cmp' },
  { k: 'td',  label: 'Anytime TD',      ix: 12, pos: ['RB','WR','TE','QB'], from: 1, to: 1, step: 1, unit: 'TD' },
];
const PM_BY = Object.fromEntries(PM.map(m => [m.k, m]));

function pmLadder(m) {
  const out = [];
  for (let t = m.to; t >= m.from; t -= m.step) out.push(t);
  return out;
}
function pmRate(vals, T) {
  const n = vals.length;
  let k = 0;
  for (const v of vals) if (v >= T) k++;
  return [k, n];
}
// Lower end of a 95% Wilson interval: what the hit rate could plausibly be on a
// sample this small. 8 of 8 is not "100%", it is "at least about 68%".
function wilsonLow(k, n) {
  if (!n) return 0;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return Math.max(0, (c - w) / d);
}
function pctStr(x) { return Math.round(x * 100) + '%'; }
function medianOf(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
// Games for one player, split the three ways a cheatsheet cares about.
function pmSets(p, formN) {
  const g = p.g || [];
  return {
    form: g.slice(-formN),
    opp: g.filter(r => r[2] === p.opp),
    venue: g.filter(r => r[3] === p.h),
  };
}
const PM_MIN = { form: 5, opp: 2, venue: 3 };
// Matchup colour for a row: how the player did at this number against this week's opponent.
function muClass(o) {
  if (!o || o[1] < 2) return '';
  const r = o[0] / o[1];
  return r >= 0.8 ? 'good' : r < 0.5 ? 'bad' : '';
}

function pmBest(p, m, sets, mode, minRate) {
  const need = mode === 'all' ? ['form', 'opp', 'venue'] : [mode];
  for (const T of pmLadder(m)) {
    let ok = true;
    for (const s of need) {
      const vals = sets[s].map(r => r[m.ix]);
      if (vals.length < PM_MIN[s]) { ok = false; break; }
      const [k, n] = pmRate(vals, T);
      if (k / n < minRate) { ok = false; break; }
    }
    if (ok) return T;
  }
  return null;
}

function Bars({ games, ix, line, opp }) {
  // One bar per game, oldest left. Green cleared the line, red did not.
  const vals = games.map(r => r[ix]);
  const top = Math.max(line * 1.25, ...vals, 1);
  const W = 560, H = 150, pad = 22, bw = Math.min(34, (W - pad) / Math.max(vals.length, 1) - 6);
  const y = v => H - 18 - (v / top) * (H - 36);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 620, display: 'block' }} role="img"
         aria-label="Last games against the line">
      {vals.map((v, i) => {
        const x = pad + i * ((W - pad) / vals.length) + 3;
        const hit = v > line;
        const r = games[i];
        return (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={Math.max(H - 18 - y(v), 1)} rx="2"
                  fill={hit ? 'var(--pos)' : 'var(--neg)'} opacity={r[2] === opp ? 1 : 0.7} />
            <text x={x + bw / 2} y={y(v) - 4} fontSize="10" textAnchor="middle" fill="var(--ink2)">{v}</text>
            <text x={x + bw / 2} y={H - 5} fontSize="9" textAnchor="middle" fill="var(--ink3)">{(r[3] ? '' : '@') + r[2]}</text>
          </g>
        );
      })}
      <line x1={pad - 4} x2={W} y1={y(line)} y2={y(line)} stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

function PropDetail({ p, m, T0, onClose }) {
  const [txt, setTxt] = useState(String(T0 - 0.5));
  const line = parseFloat(txt);
  const ok = Number.isFinite(line);
  const L = ok ? line : T0 - 0.5;
  const g = p.g || [];
  const frames = [
    ['Last 5', g.slice(-5)], ['Last 10', g.slice(-10)], ['All logged', g],
    ['vs ' + p.opp, g.filter(r => r[2] === p.opp)],
    [p.h ? 'Home' : 'Away', g.filter(r => r[3] === p.h)],
  ];
  return (
    <div className="dk" style={{ margin: '0 0 12px', padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, color: 'var(--ink)' }}>{p.n}</b>
        <span>{p.pos} &middot; {p.tm} {p.h ? 'vs' : '@'} {p.opp}</span>
        <span className="grow" />
        <label>{m.label} line&nbsp;
          <input className="find" style={{ width: 80 }} value={txt} inputMode="decimal" onChange={e => setTxt(e.target.value)} />
        </label>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <div style={{ margin: '10px 0' }}><Bars games={g} ix={m.ix} line={L} opp={p.opp} /></div>
      <div className="tbl"><table>
        <thead><tr><th className="l">Window</th><th>GP</th><th>Avg</th><th>Median</th><th>Low</th><th>High</th><th>Over {L}</th></tr></thead>
        <tbody>
          {frames.map(([lab, rows]) => {
            const v = rows.map(r => r[m.ix]);
            const k = v.filter(x => x > L).length;
            return (
              <tr key={lab}>
                <td className="l">{lab}</td><td>{v.length}</td>
                <td>{v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'}</td>
                <td>{v.length ? medianOf(v) : '—'}</td>
                <td>{v.length ? Math.min(...v) : '—'}</td><td>{v.length ? Math.max(...v) : '—'}</td>
                <td>{v.length ? <b>{k}/{v.length} ({pctStr(k / v.length)})</b> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div className="sub" style={{ marginTop: 8 }}>
        Type the number DraftKings shows. Bars in full colour are games against {p.opp}. Games the player missed are not counted.
      </div>
    </div>
  );
}

function CheatsheetsTab({ DATA }) {
  const P = DATA.props;
  const [mk, setMk] = useState('ry');
  const [mode, setMode] = useState('form');
  const [minRate, setMinRate] = useState(1);
  const [formN, setFormN] = useState(10);
  const [minPct, setMinPct] = useState(0.7);
  const [pos, setPos] = useState('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const m = PM_BY[mk];

  const rows = useMemo(() => {
    if (!P) return [];
    const out = [];
    for (const p of P.players) {
      if (!m.pos.includes(p.pos)) continue;
      if (pos !== 'ALL' && p.pos !== pos) continue;
      if (q && !(p.n + ' ' + p.tm).toLowerCase().includes(q.toLowerCase())) continue;
      const sets = pmSets(p, formN);
      const T = pmBest(p, m, sets, mode, minRate);
      if (T == null) continue;
      const at = s => pmRate(sets[s].map(r => r[m.ix]), T);
      const f = at('form'), o = at('opp'), v = at('venue');
      const avg = sets.form.length ? sets.form.reduce((a, r) => a + r[m.ix], 0) / sets.form.length : 0;
      if (m.k !== 'td' && avg > 0 && T / avg < minPct) continue;
      out.push({ p, T, f, o, v, avg, pct: avg > 0 ? T / avg : 0 });
    }
    const key = x => (mode === 'opp' ? x.o : mode === 'venue' ? x.v : x.f);
    out.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return (kb[0] / kb[1] - ka[0] / ka[1]) || (kb[1] - ka[1]) || (b.avg - a.avg);
    });
    return out;
  }, [P, mk, mode, minRate, formN, minPct, pos, q]);

  if (!P) return <section className="view on"><div className="dk">Prop data has not been built yet. It arrives with the next daily build.</div></section>;
  const modes = [['form', 'Recent form'], ['opp', 'Vs opponent'], ['venue', 'Home / away'], ['all', 'All three']];
  return (
    <section className="view on">
      <div className="bar">
        <div className="seg">
          {modes.map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        <select value={mk} onChange={e => { setMk(e.target.value); setOpen(null); }}>
          {PM.map(x => <option key={x.k} value={x.k}>{x.label}</option>)}
        </select>
        <select value={minRate} onChange={e => setMinRate(parseFloat(e.target.value))}>
          <option value={1}>Hit 100%</option><option value={0.9}>Hit 90%+</option><option value={0.8}>Hit 80%+</option>
        </select>
        <select value={formN} onChange={e => setFormN(parseInt(e.target.value))}>
          <option value={5}>Last 5</option><option value={10}>Last 10</option><option value={12}>Last 12</option>
        </select>
        <select value={minPct} onChange={e => setMinPct(parseFloat(e.target.value))}>
          <option value={0}>Any line</option><option value={0.5}>Line 50%+ of avg</option><option value={0.7}>Line 70%+ of avg</option>
          <option value={0.8}>Line 80%+ of avg</option><option value={0.9}>Line 90%+ of avg</option>
        </select>
        <select value={pos} onChange={e => setPos(e.target.value)}>
          <option value="ALL">All positions</option>
          {['QB', 'RB', 'WR', 'TE'].filter(x => m.pos.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="grow" />
        <input className="find" placeholder="Search player or team" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="dk" style={{ marginBottom: 10 }}>
        {P.week}: the highest number each player has cleared {mode === 'all' ? 'in recent form, against this opponent and at this venue' : mode === 'opp' ? 'in games against this week’s opponent (2+ games)' : mode === 'venue' ? 'at this week’s venue (3+ games)' : 'in the last ' + formN + ' games (5+ games)'}, through {P.through}.
        No lines are loaded. Tap a row, type the DraftKings number, and the chart and hit rates redraw against it.
        A perfect record at a number far below the player&rsquo;s average is real but useless, because books do not post those numbers at a price worth taking, so the line-to-average filter hides them by default.
      </div>
      <div className="muKey">
        <span><i className="g" />Good matchup: cleared this number in 80%+ of games against this opponent</span>
        <span><i className="r" />Bad matchup: under 50%</span>
        <span><i />Neutral, or too few games against them</span>
      </div>
      {open && <PropDetail key={open.n + mk} p={open} m={m} T0={open.T0} onClose={() => setOpen(null)} />}
      <div className="tbl">
        <table>
          <thead><tr>
            <th className="l">Player</th><th className="l">Game</th><th className="l">Prop</th>
            <th>Recent</th><th>Vs opp</th><th>{`Home/away`}</th><th>Avg</th><th>Line / avg</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p.n + r.p.tm} onClick={() => setOpen({ ...r.p, T0: r.T })} style={{ cursor: 'pointer' }}>
                <td className={'l mu ' + muClass(r.o)}><b>{r.p.n}</b> <span className="sub">{r.p.pos}</span>{r.p.st ? <span className="sub"> &middot; {r.p.st}</span> : null}</td>
                <td className="l">{r.p.tm} {r.p.h ? 'vs' : '@'} {r.p.opp}</td>
                <td className="l"><b>{m.k === 'td' ? 'Anytime TD' : r.T + '+ ' + m.unit}</b></td>
                <td>{r.f[0]}/{r.f[1]}</td>
                <td>{r.o[1] ? r.o[0] + '/' + r.o[1] : '—'}</td>
                <td>{r.v[1] ? r.v[0] + '/' + r.v[1] : '—'}</td>
                <td>{r.avg.toFixed(1)}</td>
                <td>{m.k === 'td' ? '—' : pctStr(r.pct)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="empty">Nobody clears that bar. Loosen the hit rate, lower the line-to-average floor, or switch the window.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- parlay builder
function americanToProb(o) {
  if (!Number.isFinite(o) || o === 0) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}
// probToAmerican comes from App.jsx.

function PairDetail({ pr, onClose }) {
  const [txt, setTxt] = useState('');
  const o = parseFloat(txt);
  const imp = americanToProb(o);
  const [k, n] = pr.joint;
  const hist = n ? k / n : 0;
  const low = wilsonLow(k, n);
  return (
    <div className="dk" style={{ margin: '0 0 12px', padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, color: 'var(--ink)' }}>{pr.qb.n} + {pr.rc.n}</b>
        <span>{pr.qb.tm} {pr.qb.h ? 'vs' : '@'} {pr.qb.opp}</span>
        <span className="grow" />
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <div style={{ margin: '8px 0' }}>
        {pr.qT}+ {PM_BY[pr.qm].unit} and {pr.cT}+ {PM_BY[pr.cm].unit}, together in {k} of {n} shared games ({pctStr(hist)}).
        If you assumed the legs were independent you would get {pctStr(pr.indep)}.
        With a sample this size the real rate could be as low as about {pctStr(low)}.
      </div>
      <label>DraftKings price for the pair (American odds)&nbsp;
        <input className="find" style={{ width: 90 }} value={txt} inputMode="numeric" placeholder="-250" onChange={e => setTxt(e.target.value)} />
      </label>
      {imp != null && (
        <div style={{ marginTop: 8 }}>
          That price implies {pctStr(imp)}. Past games say {pctStr(hist)}, conservative {pctStr(low)}.{' '}
          {low > imp
            ? <b className="up">Beats the price even on the conservative read.</b>
            : hist > imp
              ? <b>Beats the price on the raw record only. The sample is too thin to lean on.</b>
              : <b className="down">The price is shorter than the record. No edge here.</b>}
          {' '}Break-even on the raw record is about {probToAmerican(hist) || '—'}.
        </div>
      )}
      <div className="sub" style={{ marginTop: 8 }}>
        Past games are a record, not a forecast. Check that both players are active before you bet.
      </div>
    </div>
  );
}

function ParlayTab({ DATA }) {
  const P = DATA.props;
  const [minRate, setMinRate] = useState(0.8);
  const [formN, setFormN] = useState(10);
  const [minPct, setMinPct] = useState(0.7);
  const [qm, setQm] = useState('py');
  const [cm, setCm] = useState('ry');
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    if (!P) return [];
    const out = [];
    const QM = PM_BY[qm], CM = PM_BY[cm];
    const byTeam = {};
    for (const p of P.players) (byTeam[p.tm] = byTeam[p.tm] || []).push(p);
    for (const tm of Object.keys(byTeam)) {
      const qbs = byTeam[tm].filter(p => p.pos === 'QB');
      const rcs = byTeam[tm].filter(p => ['WR', 'TE', 'RB'].includes(p.pos));
      for (const qb of qbs) for (const rc of rcs) {
        // only games both played, matched on season and week
        const key = r => r[0] + '-' + r[1];
        const rcMap = new Map(rc.g.map(r => [key(r), r]));
        const both = qb.g.map(r => [r, rcMap.get(key(r))]).filter(x => x[1]).slice(-formN);
        if (both.length < 6) continue;
        const pick = (ix, M, which) => {
          for (const T of pmLadder(M)) {
            const [k, n] = pmRate(both.map(x => x[which][ix]), T);
            if (k / n >= minRate) return T;
          }
          return null;
        };
        const qT = pick(QM.ix, QM, 0), cT = pick(CM.ix, CM, 1);
        if (qT == null || cT == null) continue;
        const mean = (ix, w) => both.reduce((a, x) => a + x[w][ix], 0) / both.length;
        const qa = mean(QM.ix, 0), ca = mean(CM.ix, 1);
        if ((qa > 0 && qT / qa < minPct) || (ca > 0 && cT / ca < minPct)) continue;
        const qk = pmRate(both.map(x => x[0][QM.ix]), qT)[0];
        const ck = pmRate(both.map(x => x[1][CM.ix]), cT)[0];
        const jk = both.filter(x => x[0][QM.ix] >= qT && x[1][CM.ix] >= cT).length;
        out.push({ qb, rc, qm, cm, qT, cT, q: [qk, both.length], c: [ck, both.length], joint: [jk, both.length],
                   indep: (qk / both.length) * (ck / both.length) });
      }
    }
    out.sort((a, b) => (b.joint[0] / b.joint[1] - a.joint[0] / a.joint[1]) || (b.joint[1] - a.joint[1]));
    return out;
  }, [P, minRate, formN, minPct, qm, cm]);

  if (!P) return <section className="view on"><div className="dk">Prop data has not been built yet. It arrives with the next daily build.</div></section>;
  return (
    <section className="view on">
      <div className="bar">
        <select value={qm} onChange={e => setQm(e.target.value)}>
          <option value="py">QB passing yards</option><option value="pc">QB completions</option>
        </select>
        <select value={cm} onChange={e => setCm(e.target.value)}>
          <option value="ry">Catcher receiving yards</option><option value="rc">Catcher receptions</option>
        </select>
        <select value={minRate} onChange={e => setMinRate(parseFloat(e.target.value))}>
          <option value={0.9}>Each leg 90%+</option><option value={0.8}>Each leg 80%+</option><option value={0.7}>Each leg 70%+</option>
        </select>
        <select value={minPct} onChange={e => setMinPct(parseFloat(e.target.value))}>
          <option value={0}>Any line</option><option value={0.5}>Lines 50%+ of avg</option><option value={0.7}>Lines 70%+ of avg</option>
          <option value={0.8}>Lines 80%+ of avg</option><option value={0.9}>Lines 90%+ of avg</option>
        </select>
        <select value={formN} onChange={e => setFormN(parseInt(e.target.value))}>
          <option value={8}>Last 8 together</option><option value={10}>Last 10 together</option><option value={12}>Last 12 together</option>
        </select>
      </div>
      <div className="dk" style={{ marginBottom: 10 }}>
        {P.week}: a quarterback and one of his own pass catchers. Both legs go up together when the offence has a big day, which is why a same-game
        parlay of the two should pay less than two separate bets, and why the joint record matters more than the two single records.
        Only games both players played count. Tap a pair, type the DraftKings price, and the page tells you whether the record beats it.
      </div>
      {open && <PairDetail key={open.qb.n + open.rc.n} pr={open} onClose={() => setOpen(null)} />}
      <div className="tbl">
        <table>
          <thead><tr>
            <th className="l">Game</th><th className="l">Quarterback</th><th className="l">Catcher</th>
            <th>QB leg</th><th>Catcher leg</th><th>Together</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.qb.n + r.rc.n} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
                <td className="l">{r.qb.tm} {r.qb.h ? 'vs' : '@'} {r.qb.opp}</td>
                <td className="l"><b>{r.qb.n}</b> {r.qT}+ {PM_BY[qm].unit}</td>
                <td className="l"><b>{r.rc.n}</b> <span className="sub">{r.rc.pos}</span> {r.cT}+ {PM_BY[cm].unit}</td>
                <td>{r.q[0]}/{r.q[1]}</td><td>{r.c[0]}/{r.c[1]}</td>
                <td><b>{r.joint[0]}/{r.joint[1]}</b></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="empty">No pair clears that bar together. Loosen the hit rate or the line-to-average floor.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- injuries
const INJ_STAT = {
  QB: [['py', 'Pass yds']],
  RB: [['ruy', 'Rush yds'], ['ra', 'Carries'], ['tg', 'Targets']],
  WR: [['tg', 'Targets'], ['ry', 'Rec yds']],
  TE: [['tg', 'Targets'], ['ry', 'Rec yds']],
};

function InjuriesTab({ DATA }) {
  const P = DATA.props;
  if (!P) return <section className="view on"><div className="dk">Prop data has not been built yet. It arrives with the next daily build.</div></section>;
  const list = P.injuries || [];
  return (
    <section className="view on">
      <div className="dk" style={{ marginBottom: 10 }}>
        {P.week}: starters who are out, and how their teammates have produced with and without them over this team&rsquo;s recent games
        (this season and last). A &ldquo;without&rdquo; number built on one or two games is a hint, not a trend, and it is flagged when the sample is thin.
      </div>
      {!list.length && <div className="dk">No starters on this slate are listed out with enough history to compare.</div>}
      <div className="cardGrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
        {list.map(inj => (
          <div className="cardTeam" key={inj.n + inj.tm}>
            <div className="cardTeamHead">
              <span className="cardTeamName">{inj.n} <span className="sub">{inj.pos} &middot; {inj.tm}</span></span>
              <span className="cardTeamMeta">{inj.why} &middot; {inj.gw} games with him, {inj.go} without{inj.go < 3 ? ' (thin sample)' : ''}</span>
            </div>
            {inj.mates.map(t => {
              const cols = INJ_STAT[t.pos] || [];
              return (
                <div key={t.n} style={{ padding: '6px 0', borderTop: '1px solid var(--line2)' }}>
                  <b>{t.n}</b> <span className="sub">{t.pos}</span>
                  <div className="sub" style={{ marginTop: 2 }}>
                    {cols.map(([k, l]) => {
                      const a = t.with[k], b = t.without[k], d = b - a;
                      return (
                        <span key={k} style={{ marginRight: 14 }}>
                          {l}: {a} &rarr; <b className={d > 0.4 ? 'up' : d < -0.4 ? 'down' : ''}>{b}</b>
                        </span>
                      );
                    })}
                    <span>({t.with.g}g / {t.without.g}g)</span>
                  </div>
                </div>
              );
            })}
            {!inj.mates.length && <div className="sub">No teammate has enough games on both sides.</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
