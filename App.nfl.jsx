// ============ NFL Research Center, injury and news flags, your own game picks ============
const NR_STATS = [['ry', 'Receiving yds'], ['rc', 'Receptions'], ['ruy', 'Rushing yds'], ['py', 'Passing yds'], ['td', 'Anytime TD']];
const NR_FLOOR = { ry: 8, rc: 1, ruy: 8, py: 25 };
function nrToday() { return rcEt(new Date().toISOString()); }
function nrGame(DATA, tm) { return (DATA.games || []).find(g => g.home === tm || g.away === tm); }
function nrAmerican(s) {
  const o = parseFloat(String(s).replace('+', ''));
  if (!isFinite(o) || o === 0 || Math.abs(o) < 100) return null;
  return o > 0 ? 100 / (o + 100) : -o / (-o + 100);
}
// Yards a defense allows per game to each position, from the logged player games of this season.
// Only the logged players are counted, so totals run under the real ones, but every team is cut the same way.
// Each team is pulled toward the league average (3 games' worth) because the samples are small.
const NR_DEF_STATS = { ry: 4, rc: 5, ruy: 7, py: 9 };
function nrDefense(P, season) {
  const out = {};
  Object.keys(NR_DEF_STATS).forEach(st => {
    const ix = NR_DEF_STATS[st];
    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      const tot = {}, wk = {};
      P.forEach(p => { if (p.pos !== pos) return; (p.g || []).forEach(r => { if (r[0] !== season) return; tot[r[2]] = (tot[r[2]] || 0) + r[ix]; (wk[r[2]] = wk[r[2]] || new Set()).add(r[1]); }); });
      const teams = Object.keys(tot).filter(t => wk[t].size);
      if (teams.length < 8) return;
      const pg = {}; teams.forEach(t => { pg[t] = tot[t] / wk[t].size; });
      const lg = teams.reduce((s, t) => s + pg[t], 0) / teams.length;
      if (!lg) return;
      const m = {};
      teams.forEach(t => { const n = wk[t].size; m[t] = { pg: pg[t], n, ratio: ((n * pg[t] + 3 * lg) / (n + 3)) / lg }; });
      Object.keys(m).sort((a, b) => m[b].ratio - m[a].ratio).forEach((t, i) => { m[t].rank = i + 1; });
      m._lg = lg; m._n = teams.length;
      out[pos + '|' + st] = m;
    });
  });
  return out;
}
function NflResearch({ DATA }) {
  const P = (DATA.props && DATA.props.players) || [];
  const [pos, setPos] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [stat, setStat] = useState('ry');
  const [line, setLine] = useState('');
  const today = nrToday();
  const DEF = useMemo(() => nrDefense(P, DATA.picks && DATA.picks.season), [P]);
  const list = useMemo(() => {
    let l = P.filter(p => p.opp && (pos === 'All' || p.pos === pos));
    if (q) { const ql = q.toLowerCase(); l = l.filter(p => (p.n + ' ' + p.tm).toLowerCase().includes(ql)); }
    return l.sort((a, b) => a.n.localeCompare(b.n));
  }, [P, pos, q]);
  const p = P.find(x => x.n + x.tm === sel);
  const stats = p ? NR_STATS.filter(([k]) => k === 'td' || (PM_BY[k] && PM_BY[k].pos.includes(p.pos))) : NR_STATS;
  const st = p && stats.some(s => s[0] === stat) ? stat : (stats[0] && stats[0][0]);
  let body = <div className="rcEmpty">Pick a player on the left, choose a prop, then type the line from FanDuel.</div>;
  if (p) {
    const gm = nrGame(DATA, p.tm);
    const played = gm && gm.day < today;
    const flag = ((DATA.daily && DATA.daily.nfl && DATA.daily.nfl.flags) || []).find(f => f.player === p.n);
    const out = flag && /out|doubtful/i.test(flag.status);
    const dp = (DATA.players || []).find(x => x.name === p.n && x.team === p.tm);
    const mu = DATA.matchup && DATA.matchup[p.opp] && DATA.matchup[p.opp][p.pos];
    const mates = ((DATA.props && DATA.props.injuries) || []).filter(i => i.tm === p.tm && i.n !== p.n);
    const notes = [];
    if (played) notes.push('His game was already played this week.');
    if (flag) notes.push('Injury flag: ' + flag.status + (flag.note ? ', ' + flag.note : '') + '.');
    if (p.st) notes.push('Status: ' + p.st + '.');
    if (dp && dp.moved) notes.push('Changed teams from ' + dp.team_prev + '. Old numbers may not reflect his role.');
    if (mates.length) notes.push('Out on his team: ' + mates.slice(0, 5).map(m => m.n + ' (' + m.why + ')').join(', ') + '.');
    const m = PM_BY[st];
    const g = p.g || [];
    let v = null, leg = null;
    const base = { sport: 'nfl', name: p.n, team: p.tm, opp: p.opp, gameDate: gm ? gm.day : '', stat: st, season: DATA.picks && DATA.picks.season, week: DATA.picks && DATA.picks.week };
    let facts = [], gamesView = null;
    if (st === 'td') {
      const imp = nrAmerican(line);
      const mp = dp && dp.prob != null ? dp.prob : null;
      const edge = imp != null && mp != null ? mp - imp : null;
      const word = out || played ? 'Pass' : edge == null ? null : edge >= 0.06 ? 'Play' : edge >= 0.03 ? 'Lean' : 'Pass';
      if (word) {
        v = { word, cls: word === 'Play' ? 'p' : word === 'Lean' ? 'l' : 'x', why: out || played ? 'Not bettable right now.' : 'Model has him at ' + Math.round(mp * 100) + '% to score. ' + line + ' needs ' + Math.round(imp * 100) + '%. Gap ' + (edge >= 0 ? '+' : '') + Math.round(edge * 100) + ' points.' + (dp.conf && dp.conf !== 'High' ? ' Confidence ' + dp.conf + ' (' + (dp.conf_note || 'small sample') + ').' : '') };
        leg = mkLeg({ ...base, side: 'yes', line: line, verdict: word, proj: Math.round(mp * 1000) / 1000 });
      }
      facts = [['Model TD chance', mp != null ? Math.round(mp * 100) + '%' : 'n/a'], ['Season TD games', dp ? dp.td_games + ' of ' + dp.games : '—'], ['Last 5 games', dp ? dp.l5_hits + ' of ' + dp.l5_gp : '—'], ['Red zone looks per game', dp ? dp.rz_pg : '—']];
      gamesView = <div className="rcGames">{g.slice(-12).map((r, i) => <span key={i} className={'rcG ' + (r[12] >= 1 ? 'o' : 'u')}>{r[12]}</span>)}</div>;
    } else {
      const L = parseFloat(line), has = isFinite(L);
      const vals = g.map(r => r[m.ix]);
      const rec = vals.slice(-8), k = rec.length;
      const wsum = rec.reduce((s, x, i) => s + x * (i + 1), 0), wt = (k * (k + 1)) / 2;
      const proj0 = k ? wsum / wt : 0;
      const dm = DEF[p.pos + '|' + st] && DEF[p.pos + '|' + st][p.opp];
      const proj = st === 'py' && dm ? proj0 * (1 + 0.5 * (dm.ratio - 1)) : proj0;
      const mean = k ? rec.reduce((s, x) => s + x, 0) / k : 0;
      const sd = Math.max(Math.sqrt(k ? rec.reduce((s, x) => s + (x - mean) * (x - mean), 0) / k : 0), NR_FLOOR[st] || 1);
      const ok = (s, x) => (s === 'over' ? x > L : x < L);
      if (has && k >= 5) {
        const one = s => ({ side: s, z: (s === 'over' ? proj - L : L - proj) / sd, h: rec.filter(x => ok(s, x)).length, h5: vals.slice(-5).filter(x => ok(s, x)).length, hall: vals.filter(x => ok(s, x)).length });
        const o = one('over'), u = one('under'), best = o.z >= u.z ? o : u;
        let play = best.z >= 0.5 && best.h >= Math.ceil(0.75 * k), lean = !play && best.z >= 0.3 && best.h >= Math.ceil(0.625 * k);
        let cap = '';
        if (dm && ((best.side === 'over' && dm.rank >= (DEF[p.pos + '|' + st]._n - 7)) || (best.side === 'under' && dm.rank <= 8))) { if (play) { play = false; lean = true; cap = ' Matchup works against it, so it drops to a lean.'; } }
        const word = out || played ? 'Pass' : play ? 'Play' : lean ? 'Lean' : 'Pass';
        const sideTxt = best.side === 'over' ? 'Over' : 'Under';
        v = { word, cls: word === 'Play' ? 'p' : word === 'Lean' ? 'l' : 'x', best, o, u, k, why: out || played ? 'Not bettable right now.' : word === 'Pass' ? (best.z < 0.3 ? 'The line sits right where his recent games do. No edge.' : sideTxt + ' ' + L + ' hit only ' + best.h + ' of his last ' + k + '.') : sideTxt + ' ' + L + ': ' + best.h + ' of his last ' + k + ', ' + best.hall + ' of ' + vals.length + ' logged. Recent games weighted toward the latest point to ' + proj.toFixed(1) + ', ' + best.z.toFixed(2) + ' swings from the line.' + cap };
        leg = mkLeg({ ...base, side: best.side, line: L, verdict: word, proj: Math.round(proj * 100) / 100 });
      } else if (has) notes.push('Fewer than 5 logged games, so no verdict.');
      if (k && k < 8) notes.push('Only ' + k + ' recent games logged. Small sample, so lean on the caution.');
      if (st === 'py' && dm) notes.push('Projection nudged ' + (proj >= proj0 ? 'up' : 'down') + ' for the matchup (half the gap to league average).');
      facts = [['Weighted recent avg', proj.toFixed(1)], ['Last 5 avg', vals.slice(-5).length ? (vals.slice(-5).reduce((s, x) => s + x, 0) / vals.slice(-5).length).toFixed(1) : '—'], ['Typical swing', '±' + sd.toFixed(1)], ['Home or away', p.h ? 'Home' : 'Away'], ['Vs ' + p.opp + ' history', (() => { const a = g.filter(r => r[2] === p.opp).map(r => r[m.ix]); return a.length ? a.join(', ') : 'none logged'; })()]];
      gamesView = <div className="rcGames">{g.slice(-12).map((r, i) => { const x = r[m.ix]; return <span key={i} className={'rcG ' + (has ? (x > L ? 'o' : x < L ? 'u' : '') : '')} title={(r[3] ? '' : '@') + r[2]}>{x}</span>; })}</div>;
    }
    const dmap = st !== 'td' ? DEF[p.pos + '|' + st] : null;
    const dm2 = dmap && dmap[p.opp];
    if (st === 'td' && mu) facts.push(['Opp vs ' + p.pos + ' (TDs)', 'Soft rank ' + mu.soft_rank + ' of 32']);
    if (dm2) facts.push([p.opp + ' allows to ' + p.pos + 's', Math.round(dm2.pg * 10) / 10 + ' per game, ' + (dm2.ratio >= 1 ? '+' : '') + Math.round((dm2.ratio - 1) * 100) + '% vs avg, rank ' + dm2.rank + ' of ' + dmap._n + ' (1 = softest), ' + dm2.n + ' games']);
    body = (
      <>
        <div className="rcHead"><div><div className="rcName">{p.n}</div><div className="rcSub">{p.tm} · {p.pos} · {p.h ? 'vs ' : '@ '}{p.opp}{gm ? ' · ' + gm.wd : ''}</div></div></div>
        <div className="rcStats">{stats.map(([k, l]) => <button key={k} className={st === k ? 'on' : ''} onClick={() => setStat(k)}>{l}</button>)}</div>
        <div className="rcLine">
          <input type={st === 'td' ? 'text' : 'number'} step="0.5" inputMode={st === 'td' ? 'text' : 'decimal'} placeholder={st === 'td' ? '+150' : 'FanDuel line'} value={line} onChange={e => setLine(e.target.value)} />
          <label>{st === 'td' ? 'Type his anytime TD odds from FanDuel, like +150.' : 'Type the number FanDuel shows.'}</label>
        </div>
        {v && (<div className={'rcVerdict ' + v.cls}><div className="rcV">{v.word}{v.best && v.word !== 'Pass' ? ' · ' + (v.best.side === 'over' ? 'Over ' : 'Under ') + line : ''}{!v.best && v.word !== 'Pass' ? ' · Yes ' + line : ''}</div><div className="rcWhy">{v.why}</div></div>)}
        {leg && !out && !played && <PlayControls leg={leg} />}
        {notes.map((n, i) => <div className="rcWhy" key={i}>{n}</div>)}
        <div className="rcSub" style={{ marginTop: 8 }}>Last {Math.min(g.length, 12)} games, oldest to newest{st !== 'td' && isFinite(parseFloat(line)) ? '. Green cleared ' + line + '.' : '.'}</div>
        {gamesView}
        <div className="rcFacts">{facts.map(([a, b]) => <div className="rcF" key={a}>{a}<b>{b}</b></div>)}</div>
        {dmap && (
          <>
            <div className="rcSub" style={{ marginTop: 12 }}>Every defense against {p.pos}s, {(NR_STATS.find(x => x[0] === st) || [0, st])[1].toLowerCase()} allowed, softest first. Averages are pulled toward the league mean because the samples are small.</div>
            <div className="rcGames">{Object.keys(dmap).filter(t => t[0] !== '_').sort((a, b) => dmap[a].rank - dmap[b].rank).map(t => <span key={t} className="rcG" style={t === p.opp ? { outline: '2px solid var(--ink)', color: 'var(--ink)' } : { color: dmap[t].ratio >= 1.05 ? 'var(--pos)' : dmap[t].ratio <= 0.95 ? 'var(--neg)' : undefined }}>{t} {Math.round(dmap[t].ratio * 100)}</span>)}</div>
          </>
        )}
      </>
    );
  }
  return (
    <section className="view on rc">
      <style>{RC_CSS}</style>
      <h2 className="tsH">Player Research Center<span className="pill">{DATA.picks ? 'Week ' + DATA.picks.week : ''}</span></h2>
      <SlipBar />
      <div className="rcTop">
        <div className="rcList">
          <input placeholder="Search player or team" value={q} onChange={e => setQ(e.target.value)} />
          <div className="rcTog">{['All', 'QB', 'RB', 'WR', 'TE'].map(x => <button key={x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
          <div className="rcScroll">
            {list.map(x => <div key={x.n + x.tm} className={'rcP' + (x.n + x.tm === sel ? ' on' : '')} onClick={() => { setSel(x.n + x.tm); setLine(''); }}><b>{x.n}</b><span>{x.pos} {x.tm} {x.h ? 'vs ' : '@ '}{x.opp}</span></div>)}
            {!list.length && <div className="rcEmpty">No players match.</div>}
          </div>
        </div>
        <div className="rcMain">{body}</div>
      </div>
      <BetsPanel only="props" />
      <div className="rcSub" style={{ marginTop: 10 }}>Stats current as of {DATA.meta && DATA.meta.generated}. Verdict rule: his recent games, weighted toward the latest, have to sit at least half a typical swing from the line and he has to have gone that way in most of his last 8. A tough yards-allowed matchup caps a Play at Lean. Position yards allowed explained little week to week this season except for QB passing yards, so it only moves passing projections. Anytime TD compares the model's chance to the odds you type. Model estimates, not guarantees.</div>
    </section>
  );
}
function NewsFlags({ DATA, sport }) {
  const D = DATA.daily || {};
  const b = D[sport] || {};
  const flags = b.flags || [];
  const moved = sport === 'nfl' ? (DATA.players || []).filter(p => p.moved && p.rank <= 150) : [];
  const out = sport === 'nba' && DATA.nba && DATA.nba.injuries_out ? DATA.nba.injuries_out : {};
  return (
    <section className="view on">
      <h2 className="tsH">{sport === 'nfl' ? 'NFL' : 'NBA'} injuries and news{D.date ? <span className="pill on">{D.date}</span> : null}</h2>
      <div className="dbGrid">
        <div className="dbCard">
          <h4>Flags from this morning's research</h4>
          {flags.length ? flags.map((f, i) => <div className="dbRow" key={i}><b>{f.player}</b><span className="tag r">{f.status}</span><span className="dbNote">{f.team}{f.note ? ' · ' + f.note : ''}</span></div>) : <div className="dbNote">Nothing flagged yet. The 9 a.m. and 4 p.m. runs fill this in.</div>}
          {b.notes ? <div className="dbNote" style={{ marginTop: 8 }}>{b.notes}</div> : null}
        </div>
        {sport === 'nfl' && (
          <div className="dbCard">
            <h4>Players on a new team</h4>
            {moved.length ? moved.map(p => <div className="dbRow" key={p.name}><b>{p.name}</b><span className="dbNote">{p.pos} · {p.team_prev} to {p.team}</span></div>) : <div className="dbNote">No tracked player moves.</div>}
          </div>
        )}
        {sport === 'nba' && (
          <div className="dbCard">
            <h4>Out per the data feed</h4>
            {Object.keys(out).length ? Object.keys(out).map(t => <div className="dbRow" key={t}><b>{t}</b><span className="dbNote">{out[t].join(', ')}</span></div>) : <div className="dbNote">None listed.</div>}
          </div>
        )}
      </div>
    </section>
  );
}
function MyGames({ DATA }) {
  const { db, bets, ok } = useBets();
  const G = (DATA.games_model && DATA.games_model.games) || [];
  const [lines, setLines] = useState({});
  const [busy, setBusy] = useState('');
  const today = nrToday();
  const wk = DATA.picks && DATA.picks.week, season = DATA.picks && DATA.picks.season;
  const pick = async (g, team) => {
    if (!db || busy) return;
    const id = ['game', season, wk, g.away, g.home].join('_');
    const have = bets.find(b => b.id === id);
    const dflt = team === g.home ? g.spread_line * -1 : g.spread_line;
    const typed = parseFloat(lines[g.home]);
    const ln = isFinite(typed) ? typed : dflt;
    setBusy(id);
    try {
      const ref = db.collection('bets').doc(id);
      if (have && have.pickTeam === team && have.status === 'pending') await ref.delete();
      else if (!have || have.status === 'pending') await ref.set({ type: 'game', season, week: wk, home: g.home, away: g.away, kick: g.kick, pickTeam: team, line: ln, modelTeam: g.ats_pick_team, modelPick: g.ats_pick, status: 'pending', placedAt: new Date().toISOString() });
    } catch (e) { /* refused */ }
    setBusy('');
  };
  const btn = on => ({ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, border: '1px solid ' + (on ? 'var(--pos)' : 'var(--line)'), background: on ? 'var(--posBg)' : 'var(--sunk)', color: on ? 'var(--pos)' : 'var(--ink)' });
  return (
    <section className="view on rc">
      <style>{RC_CSS}</style>
      <h2 className="tsH">My game picks<span className="pill">Week {wk}</span></h2>
      <div className="rcSub" style={{ marginBottom: 10 }}>The model's card stays as it is. Tap a team to save your own spread pick next to it. Type a different line first if your book has one.</div>
      <div className="rcMain">
        {G.map(g => {
          const id = ['game', season, wk, g.away, g.home].join('_');
          const have = bets.find(b => b.id === id);
          const past = g.kick < today;
          return (
            <div key={id} style={{ borderTop: '1px solid var(--line2)', padding: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 150 }}><b>{g.away} @ {g.home}</b><div className="rcSub">{g.kick}{past ? ' · played' : ''}</div></div>
              <div className="rcSub" style={{ minWidth: 140 }}>Model: <b style={{ color: 'var(--ink)' }}>{g.ats_pick}</b></div>
              <button style={btn(have && have.pickTeam === g.away)} disabled={!db || past || !!busy} onClick={() => pick(g, g.away)}>{g.away} {(g.spread_line > 0 ? '+' : '') + g.spread_line}</button>
              <button style={btn(have && have.pickTeam === g.home)} disabled={!db || past || !!busy} onClick={() => pick(g, g.home)}>{g.home} {(-g.spread_line > 0 ? '+' : '') + (-g.spread_line)}</button>
              <input className="find" style={{ width: 70 }} placeholder="line" value={lines[g.home] || ''} onChange={e => setLines({ ...lines, [g.home]: e.target.value })} />
              {have ? <span className="rcSub">Yours: <b style={{ color: 'var(--pos)' }}>{have.pickTeam} {have.line > 0 ? '+' : ''}{have.line}</b></span> : null}
            </div>
          );
        })}
        {ok === false && <div className="rcSub">Saving picks works on your private link when you are signed in.</div>}
      </div>
      <BetsPanel only="games" />
    </section>
  );
}
