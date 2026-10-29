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
  const [view, setView] = useState('picks');
  const P = DATA.nba_picks;

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

  const viewBar = (
    <div className="bar">
      <div className="seg">
        <button className={view === 'picks' ? 'on' : ''} onClick={() => setView('picks')}>Best 5 today</button>
        <button className={view === 'record' ? 'on' : ''} onClick={() => setView('record')}>Pick record{P && P.record && (P.record.w + P.record.l) ? ' ' + P.record.w + '-' + P.record.l : ''}</button>
        <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All 100 players</button>
      </div>
    </div>
  );
  if (view === 'picks') return <section className="view on">{viewBar}<NbaPicks P={P} /></section>;
  if (view === 'record') return <section className="view on">{viewBar}<NbaRecord P={P} /></section>;

  const fmt = v => (v == null ? '—' : v.toFixed(1));
  const injBadge = p => {
    if (!p.injury) return null;
    const out = p.avail <= 0.25;
    return <span className={'badge'} style={{ marginLeft: 6, color: out ? 'var(--neg)' : 'var(--ink2)', borderColor: out ? 'var(--negLine)' : 'var(--line)', background: out ? 'var(--negBg)' : 'var(--sunk)' }}>{p.injury.status}</span>;
  };

  return (
    <section className="view on">
      {viewBar}
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

// ---------------------------------------------------------------- Best 5 and record
const NBA_PICK_STAT = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3PM', pra: 'PRA' };
function nbaPickText(c) { return (c.side === 'over' ? 'OVER ' : 'UNDER ') + c.line + ' ' + NBA_PICK_STAT[c.stat]; }
function NbaResult({ c }) {
  const base = { marginLeft: 8, whiteSpace: 'nowrap' };
  if (c.result === 'win') return <span className="badge" style={base}>Win · {c.actual}</span>;
  if (c.result === 'loss') return <span className="badge" style={{ ...base, color: 'var(--neg)', borderColor: 'var(--negLine)', background: 'var(--negBg)' }}>Loss · {c.actual}</span>;
  if (c.result === 'void') return <span className="badge" style={{ ...base, color: 'var(--ink2)', borderColor: 'var(--line)', background: 'var(--sunk)' }}>Void · did not play</span>;
  return <span className="badge" style={{ ...base, color: 'var(--ink2)', borderColor: 'var(--line)', background: 'var(--sunk)' }}>Pending</span>;
}
function NbaPickRow({ c, rank }) {
  const [open, setOpen] = useState(false);
  const need = c.side === 'over' ? c.line + ' or lower' : c.line + ' or higher';
  const cell = { minWidth: 64 };
  const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--card)', padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} onClick={() => setOpen(!open)}>
        <span className="dk" style={{ margin: 0, width: 16 }}>{rank}</span>
        <img src={'https://a.espncdn.com/i/headshots/nba/players/full/' + c.pid + '.png'} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: 'var(--sunk)' }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
        <div style={{ flex: '1 1 160px', minWidth: 150 }}>
          <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{c.name}{c.lean && <span className="badge" style={{ marginLeft: 8, color: 'var(--ink2)', borderColor: 'var(--line)', background: 'var(--sunk)' }}>Lean</span>}</div>
          <div className="tc dk" style={{ margin: 0 }}>
            <span>{c.team}</span><span>{c.home ? 'vs' : '@'}</span><NbaTeam t={c.opp} /><span>· {nbaDay(c.tip)}{c.b2b ? ' · back to back' : ''}</span>
          </div>
        </div>
        <div style={{ fontFamily: 'var(--num)', fontWeight: 700, fontSize: 18, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{nbaPickText(c)}</div>
        <NbaResult c={c} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, paddingLeft: 28 }}>
        <div style={cell}><div className="dk" style={{ margin: 0 }}>Model tonight</div><b>{c.proj}</b></div>
        <div style={cell}><div className="dk" style={{ margin: 0 }}>Season avg</div><b>{c.avg}</b></div>
        <div style={cell}><div className="dk" style={{ margin: 0 }}>Last 10 {c.side}</div><b>{Math.round(c.hit10 * 10)}/10</b></div>
        <div style={cell}><div className="dk" style={{ margin: 0 }}>Last {c.n20} {c.side}</div><b>{Math.round(c.hit20 * c.n20)}/{c.n20}</b></div>
        <div style={cell}><div className="dk" style={{ margin: 0 }}>L5 / L10 avg</div><b>{f1(c.l5)} / {f1(c.l10)}</b></div>
      </div>
      <div className="dk" style={{ margin: '8px 0 0 28px' }}>Only take it if your book has {need}. Tap for the reasoning.</div>
      {open && (
        <div className="dk" style={{ margin: '6px 0 0 28px', color: 'var(--ink2)' }}>
          {c.why}
          {c.opp_out && c.opp_out.length > 0 && <div style={{ marginTop: 4 }}>{c.opp} without: {c.opp_out.join(', ')}.</div>}
        </div>
      )}
    </div>
  );
}
function NbaPicks({ P }) {
  const card = P && P.card;
  if (!card || !card.picks || !card.picks.length) {
    return (
      <div className="calNote"><b>No card yet today.</b> The Best 5 locks once with the morning refresh, before the first tip. If
        there is no game day or nothing clears the bar, it stays empty.</div>
    );
  }
  const done = card.picks.filter(c => c.result === 'win' || c.result === 'loss');
  return (
    <>
      <div className="muKey">
        <span><b>{card.date}</b> · locked {card.made_at}</span>
        {done.length > 0 && <span>{done.filter(c => c.result === 'win').length}-{done.filter(c => c.result === 'loss').length} so far</span>}
        <span style={{ marginLeft: 'auto' }}>Model lines, not sportsbook lines.</span>
      </div>
      {card.picks.map((c, i) => <NbaPickRow key={c.pid + c.stat} c={c} rank={i + 1} />)}
      <div className="calNote">
        <b>How these are picked.</b> Each line is the player's season average rounded to a half point. A pick needs the model's
        number for tonight to sit well off that line, and the player to have gone that way in at least 7 of his last 10. Last
        season, that rule beat its line about 64% of the time on Overs and 70% on Unders. That finds real gaps but does not
        beat a sportsbook by itself. Check the real number first. Leans have a smaller gap or a shakier last 10.
      </div>
    </>
  );
}
function NbaRecord({ P }) {
  const r = P && P.record;
  if (!r || (!r.w && !r.l && !r.v)) {
    return <div className="calNote"><b>No graded picks yet.</b> Each morning the refresh grades yesterday's card from the box scores and adds it here.</div>;
  }
  const label = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', fg3: 'Threes', pra: 'PRA' };
  return (
    <>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline', margin: '4px 0 14px' }}>
        <div><div className="dk" style={{ margin: 0 }}>Record</div><b style={{ fontSize: 26, fontFamily: 'var(--num)' }}>{r.w}-{r.l}{r.v ? '-' + r.v : ''}</b></div>
        <div><div className="dk" style={{ margin: 0 }}>Hit rate</div><b style={{ fontSize: 26, fontFamily: 'var(--num)' }}>{r.pct != null ? r.pct + '%' : '—'}</b></div>
        <div><div className="dk" style={{ margin: 0 }}>Streak</div><b style={{ fontSize: 26, fontFamily: 'var(--num)' }}>{r.streak || '—'}</b></div>
      </div>
      <div className="tbl" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th className="l">By prop</th><th>W</th><th>L</th><th>Hit rate</th></tr></thead>
          <tbody>
            {Object.keys(r.by_stat).map(k => {
              const b = r.by_stat[k];
              return <tr key={k}><td className="l">{label[k] || k}</td><td>{b.w}</td><td>{b.l}</td><td>{Math.round(100 * b.w / (b.w + b.l))}%</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {(P.history || []).map(day => (
        <div key={day.date} style={{ marginBottom: 14 }}>
          <div className="dk" style={{ margin: '0 0 6px' }}><b>{day.date}</b></div>
          <div className="tbl">
            <table>
              <tbody>
                {day.picks.map(c => (
                  <tr key={c.pid + c.stat}>
                    <td className="l">{c.name} <span className="dk" style={{ margin: 0 }}>{c.team} {c.home ? 'vs' : '@'} {c.opp}</span></td>
                    <td>{nbaPickText(c)}</td>
                    <td className="max"><NbaResult c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="calNote">{r.note}</div>
    </>
  );
}
