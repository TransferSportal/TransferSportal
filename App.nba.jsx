// ============ NBA tab ============
//
// Reads DATA.nba, which nba.py builds from public ESPN data: the top 100 players
// by a blend of last season and this season, projected for their next game.
//
// Every number here is a projection, not a price. There are no sportsbook lines
// behind it. The backtest box at the bottom says how far off a typical miss is.
// Declarations, not consts, so they hoist across the joined script block.

const NBA_STATS = [
  { k: 'pts', label: 'PTS' }, { k: 'reb', label: 'REB' }, { k: 'ast', label: 'AST' },
  { k: 'fg3', label: '3PM' }, { k: 'pra', label: 'PRA' },
];

function nbaLogo(t) {
  return 'https://a.espncdn.com/i/teamlogos/nba/500/' + String(t || '').toLowerCase() + '.png';
}
function NbaTeam({ t }) {
  return (
    <span className="tc">
      <img src={nbaLogo(t)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
      <span>{t}</span>
    </span>
  );
}
function nbaDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return day + ' ' + time;
}
function nbaDayKey(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
function nbaMu(f) {            // opponent defense factor -> matchup colour
  if (f == null) return '';
  return f >= 1.03 ? 'good' : f <= 0.97 ? 'bad' : '';
}

function NbaTab({ DATA }) {
  const N = DATA.nba;
  const [q, setQ] = useState('');
  const [stat, setStat] = useState('pts');
  const [day, setDay] = useState('all');
  const [sort, setSort] = useState('rank');
  const [open, setOpen] = useState(null);
  const [showTest, setShowTest] = useState(false);

  const days = useMemo(() => {
    if (!N) return [];
    const s = new Set();
    N.players.forEach(p => { if (p.next) s.add(nbaDayKey(p.next.date)); });
    return Array.from(s).sort();
  }, [N]);

  const rows = useMemo(() => {
    if (!N) return [];
    let list = N.players.slice();
    if (q) {
      const ql = q.toLowerCase();
      list = list.filter(p => (p.name + ' ' + p.team).toLowerCase().includes(ql));
    }
    if (day !== 'all') list = list.filter(p => p.next && nbaDayKey(p.next.date) === day);
    const val = p => (p.proj ? p.proj[stat] : -1);
    if (sort === 'proj') list.sort((a, b) => val(b) - val(a));
    else if (sort === 'trend') {
      const tr = p => (p.windows && p.windows['5'] && p.windows['10'] ? (p.windows['5'][stat] || 0) - (p.windows['10'][stat] || 0) : -99);
      list.sort((a, b) => tr(b) - tr(a));
    } else list.sort((a, b) => a.rank - b.rank);
    return list;
  }, [N, q, day, sort, stat]);

  if (!N || !N.players || !N.players.length) {
    return (
      <section className="view on">
        <div className="calNote"><b>NBA projections are waiting for data.</b> They build with the daily refresh. If this
          stays empty tomorrow, the source was down and the last good build is kept.</div>
      </section>
    );
  }

  const fmt = v => (v == null ? '—' : v.toFixed(1));
  const injBadge = p => {
    if (!p.injury) return null;
    const out = p.avail <= 0.25;
    return <span className={'badge'} style={{ marginLeft: 6, color: out ? 'var(--neg)' : 'var(--ink2)', borderColor: out ? 'var(--negLine)' : 'var(--line)', background: out ? 'var(--negBg)' : 'var(--sunk)' }}>{p.injury.status}</span>;
  };

  return (
    <section className="view on">
      <div className="bar">
        <input className="find" placeholder="Search player or team" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg">
          {NBA_STATS.map(s => <button key={s.k} className={stat === s.k ? 'on' : ''} onClick={() => setStat(s.k)}>{s.label}</button>)}
        </div>
        <select value={day} onChange={e => setDay(e.target.value)}>
          <option value="all">All games</option>
          {days.map(d => <option key={d} value={d}>{new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="rank">Sort: player rank</option>
          <option value="proj">Sort: projection</option>
          <option value="trend">Sort: L5 vs L10 trend</option>
        </select>
        <span className="grow" />
        <button className="link" onClick={() => setShowTest(v => !v)}>{showTest ? 'Hide' : 'How accurate is this'}</button>
      </div>

      {showTest && N.backtest && (
        <div className="calNote">
          <b>How far off is it?</b> A typical miss is about {N.backtest.mae.pts} points, {N.backtest.mae.reb} rebounds and {N.backtest.mae.ast} assists
          per game. {N.backtest.read}
          <div style={{ marginTop: 6 }} className="dk">Tested on {N.backtest.games.toLocaleString()} games: {N.backtest.basis}.</div>
        </div>
      )}

      <div className="muKey">
        <span><i className="g" />soft defense for that position</span>
        <span><i className="r" />tough defense</span>
        <span><i />neutral</span>
        <span style={{ marginLeft: 'auto' }}>Projections, not lines. Updated {N.generated}.</span>
      </div>

      <div className="tbl">
        <table>
          <thead><tr>
            <th className="l">#</th><th className="l">Player</th><th className="l">Next</th>
            <th>L5</th><th>L10</th><th>L15</th><th>L20</th><th>H2H</th><th>Proj {NBA_STATS.find(s => s.k === stat).label}</th>
          </tr></thead>
          <tbody>
            {rows.map(p => {
              const f = p.factors && p.factors[stat];
              const isOpen = open === p.id;
              const out = p.avail <= 0.25;
              return (
                <React.Fragment key={p.id}>
                  <tr className={'prow' + (out ? ' dim' : '')} onClick={() => setOpen(isOpen ? null : p.id)}>
                    <td className="l">{p.rank}</td>
                    <td className="l">
                      <div className="tc">
                        <img src={p.headshot} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', background: 'var(--sunk)' }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                        <span style={{ color: 'var(--ink)' }}>{p.name}</span>
                        <span className="dk" style={{ margin: 0 }}>{p.team} {p.pos}</span>
                        {injBadge(p)}
                      </div>
                    </td>
                    <td className={'l mu ' + nbaMu(f && f.def)}>
                      {p.next ? (<>
                        <div className="tc"><span style={{ color: 'var(--ink3)' }}>{p.next.home ? 'vs' : '@'}</span><NbaTeam t={p.next.opp} /></div>
                        <div className="dk" style={{ margin: 0 }}>{nbaDay(p.next.date)}{p.next.b2b ? ' · back to back' : ''}</div>
                      </>) : '—'}
                    </td>
                    {['5', '10', '15', '20'].map(w => <td key={w}>{p.windows[w] ? fmt(p.windows[w][stat]) : '—'}</td>)}
                    <td>{p.h2h && p.h2h.n ? <>{fmt(p.h2h[stat])} <span className="dk" style={{ margin: 0 }}>({p.h2h.n})</span></> : '—'}</td>
                    <td className="max"><b>{p.proj ? fmt(p.proj[stat]) : '—'}</b></td>
                  </tr>
                  {isOpen && (
                    <tr className="pdet"><td colSpan={9}><NbaDetail p={p} stat={stat} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="foot"><p>{N.note}</p></div>
    </section>
  );
}

function NbaDetail({ p, stat }) {
  const f = p.factors && p.factors[stat];
  const label = NBA_STATS.find(s => s.k === stat).label;
  const pct = x => (x >= 1 ? '+' : '') + ((x - 1) * 100).toFixed(1) + '%';
  return (
    <div className="det">
      <div>
        <div className="dk">Last 5 games ({label})</div>
        <div className="log">
          {p.last5.slice().reverse().map((g, i) => (
            <div key={i} className="g" style={{ width: 'auto', padding: '0 6px', height: 22 }}>
              {g.date} {g.home ? 'vs' : '@'} {g.opp} · {g[stat] != null ? g[stat] : (g.pts + g.reb + g.ast)}
            </div>
          ))}
        </div>
        {p.split && (
          <div className="dk" style={{ marginTop: 10 }}>
            Home {p.split.home ? p.split.home[stat].toFixed(1) : '—'} ({p.split.home_n} g) · Away {p.split.away ? p.split.away[stat].toFixed(1) : '—'} ({p.split.away_n} g)
          </div>
        )}
        {p.h2h && p.h2h.n > 0 && (
          <div className="dk" style={{ marginTop: 6 }}>
            Against {p.next && p.next.opp}: {p.h2h.n} games, last {p.h2h.last.map(g => g.pts + '/' + g.reb + '/' + g.ast).join('  ')} (pts/reb/ast)
          </div>
        )}
        {p.injury && (
          <div className="dk" style={{ marginTop: 6 }}>
            <b>{p.injury.status}</b>{p.injury.type ? ' · ' + p.injury.type : ''}{p.injury.return ? ' · return ' + p.injury.return : ''}. {p.injury.comment}
          </div>
        )}
        {p.teammates_out && p.teammates_out.length > 0 && (
          <div className="dk" style={{ marginTop: 6 }}>Teammates out: {p.teammates_out.join(', ')}</div>
        )}
      </div>
      <div>
        <div className="dk">How the {label} projection is built</div>
        {f ? (
          <div className="reasonList">
            <div className="reasonRow"><b>Base</b><span>{f.base.toFixed(1)}: half the long run average, half the L5/L10/L15/L20 blend</span></div>
            <div className="reasonRow"><b>Defense</b><span>{pct(f.def)} ({f.def_n} games sampled). Small weight on purpose.</span></div>
            <div className="reasonRow"><b>Head to head</b><span>{pct(f.h2h)}</span></div>
            <div className="reasonRow"><b>Rest</b><span>{pct(f.rest)}</span></div>
            {f.usage !== 1 && <div className="reasonRow"><b>Teammates out</b><span>{pct(f.usage)}</span></div>}
          </div>
        ) : <div className="dk">No game on the schedule yet.</div>}
        {p.sd10 && p.sd10[stat] != null && (
          <div className="dk" style={{ marginTop: 8 }}>Game to game swing over his last 10: about ±{p.sd10[stat]}. Expect that much noise around the number.</div>
        )}
      </div>
    </div>
  );
}
