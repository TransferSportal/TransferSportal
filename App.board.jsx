// ============ Board tab ============
// A dark, market-style view of the week: games across the top, the three strongest
// scorers as big cards, then every player ranked with a probability bar. It reads the
// same live board as the Predictions tab. Nothing here is locked or graded.
function fairOdds(p) {
  if (p == null || p <= 0 || p >= 1) return '';
  const v = p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
  return (v > 0 ? '+' : '') + v;
}
const BOARD_CSS = `
.bd{--bg:#0d0f12;--pn:#14171c;--pn2:#1a1e24;--ln:#242932;--ink:#eceef1;--mu:#8a919c;--gr:#22c55e;--grd:#14532d;--rd:#ef4444;
  display:grid;grid-template-columns:200px 1fr;background:var(--bg);color:var(--ink);border:1px solid var(--ln);border-radius:14px;overflow:hidden;min-height:640px;font-family:Inter,system-ui,sans-serif}
.bd *{box-sizing:border-box}
.bd .sb{background:#0a0c0f;border-right:1px solid var(--ln);padding:16px 12px;display:flex;flex-direction:column;gap:2px}
.bd .sb h6{margin:14px 8px 6px;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mu);font-weight:600}
.bd .sb button{appearance:none;background:none;border:none;color:var(--mu);text-align:left;padding:8px 10px;border-radius:8px;font-size:13px;display:flex;justify-content:space-between;cursor:pointer}
.bd .sb button:hover{color:var(--ink);background:var(--pn)}
.bd .sb button.on{background:#1b2a20;color:var(--gr);font-weight:600}
.bd .sb .live{margin-top:auto;font-size:10px;color:var(--mu);line-height:1.5;padding:10px 8px;border-top:1px solid var(--ln)}
.bd .mn{padding:18px 20px;min-width:0}
.bd h2{margin:0;font-size:22px;letter-spacing:-.3px}
.bd .sub{color:var(--mu);font-size:12px;margin:4px 0 14px;max-width:640px}
.bd .pill{font-size:11px;border:1px solid var(--ln);border-radius:999px;padding:3px 10px;color:var(--mu);margin-left:8px}
.bd .pill.on{color:var(--gr);border-color:var(--grd)}
.bd .strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px;scrollbar-width:thin}
.bd .gm{flex:0 0 auto;background:var(--pn);border:1px solid var(--ln);border-radius:10px;padding:8px 12px;font-size:11px;color:var(--mu);cursor:pointer;text-align:left}
.bd .gm b{color:var(--ink);font-size:12px;display:block}
.bd .gm.on{border-color:var(--gr)}
.bd .flt{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.bd .chips{display:inline-flex;background:var(--pn);border:1px solid var(--ln);border-radius:8px;overflow:hidden}
.bd .chips button{appearance:none;background:none;border:none;color:var(--mu);padding:6px 12px;font-size:12px;cursor:pointer}
.bd .chips button.on{background:var(--ink);color:#0d0f12;font-weight:600}
.bd input.q{background:var(--pn);border:1px solid var(--ln);border-radius:8px;color:var(--ink);padding:7px 12px;font-size:12px;min-width:200px}
.bd .heroes{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.bd .hero{background:var(--pn);border:1px solid var(--ln);border-radius:12px;display:flex;overflow:hidden}
.bd .tile{width:84px;flex:0 0 84px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;background:linear-gradient(160deg,#1f6f43,#0f3b24)}
.bd .hero .in{padding:12px 14px;flex:1;min-width:0}
.bd .nm{font-weight:700;font-size:14px;line-height:1.2}
.bd .meta{font-size:11px;color:var(--mu);margin:2px 0 6px}
.bd .tag{display:inline-block;font-size:10px;padding:2px 7px;border-radius:5px;background:var(--pn2);border:1px solid var(--ln);color:#c8ccd2;margin:0 4px 4px 0}
.bd .tag.r{color:#fca5a5;border-color:#5b2121}
.bd .big{font-size:26px;font-weight:800;color:var(--gr)}
.bd .fair{font-size:10px;color:var(--mu);margin-left:6px}
.bd .bar{height:7px;background:#232831;border-radius:4px;overflow:hidden;margin-top:6px}
.bd .bar i{display:block;height:100%;background:var(--gr);border-radius:4px}
.bd .rows{border:1px solid var(--ln);border-radius:12px;overflow:hidden}
.bd .rw{display:grid;grid-template-columns:34px 44px minmax(150px,1.3fr) minmax(120px,2fr) 84px;gap:10px;align-items:center;padding:9px 14px;border-top:1px solid var(--ln);background:var(--pn)}
.bd .rw:first-child{border-top:none}
.bd .rw:hover{background:var(--pn2)}
.bd .av{width:36px;height:36px;border-radius:8px;background:linear-gradient(160deg,#1f6f43,#0f3b24);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}
.bd .pc{text-align:right;font-weight:700;font-size:15px}
.bd .pc small{display:block;font-weight:500;font-size:10px;color:var(--mu)}
.bd .hd{color:var(--mu);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;padding:8px 14px;background:var(--pn2)}
@media(max-width:860px){.bd{grid-template-columns:1fr}.bd .sb{flex-direction:row;overflow-x:auto;border-right:none;border-bottom:1px solid var(--ln)}.bd .sb h6,.bd .sb .live{display:none}.bd .heroes{grid-template-columns:1fr}.bd .rw{grid-template-columns:28px 1fr 70px}.bd .rw .av,.bd .rw .bc{display:none}}
`;
function BoardTab({ DATA, go }) {
  const [pos, setPos] = useState('All');
  const [q, setQ] = useState('');
  const [game, setGame] = useState(null);
  const [inactive, setInactive] = useState(false);
  const m = DATA.meta || {};
  const gm = (DATA.games_model && DATA.games_model.games) || [];
  const lw = lastWeekIndex(DATA.players);
  const all = useMemo(() => (DATA.players || []).filter(p => p.prob != null && p.rostered !== false).sort((a, b) => b.prob - a.prob), [DATA]);
  const list = useMemo(() => {
    let l = all.filter(p => inactive || !p.out_reason);
    if (pos === 'No QBs') l = l.filter(p => p.pos !== 'QB');
    else if (pos !== 'All') l = l.filter(p => p.pos === pos);
    if (game) l = l.filter(p => p.team === game.home || p.team === game.away);
    if (q) { const ql = q.toLowerCase(); l = l.filter(p => (p.name + ' ' + p.team).toLowerCase().includes(ql)); }
    return l.slice(0, 80);
  }, [all, pos, game, q, inactive]);
  const tags = p => {
    const t = [];
    if (p.role) t.push(<span className="tag" key="r">{p.role}</span>);
    if (p.itt) t.push(<span className="tag" key="t">Team total {Number(p.itt).toFixed(1)}</span>);
    if (p.mu_phase && p.mu != null) t.push(<span className="tag" key="m">{p.mu >= 1.05 ? 'Good ' : p.mu <= 0.95 ? 'Tough ' : ''}{p.mu_phase} matchup</span>);
    const w = lastWeekTag(lw, p);
    if (w) t.push(<span className="tag r" key="w">{w}</span>);
    if (p.out_reason) t.push(<span className="tag r" key="o">{p.out_reason}</span>);
    return t;
  };
  const heroes = list.slice(0, 3);
  const rest = list.slice(3);
  const pct = v => Math.round(v * 100) + '%';
  return (
    <section className="view on">
      <style>{BOARD_CSS}</style>
      <div className="bd">
        <aside className="sb">
          <div style={{ fontWeight: 800, fontSize: 14, padding: '2px 8px 6px' }}>TransferSportal</div>
          <h6>Markets · {m.predict_week}</h6>
          <button className="on">Anytime TD <span>{all.length}</span></button>
          <h6>Tools</h6>
          <button onClick={() => go('picks')}>The Card</button>
          <button onClick={() => go('games')}>Games</button>
          <button onClick={() => go('matchups')}>Matchups</button>
          <button onClick={() => go('sheets')}>Cheatsheets</button>
          <button onClick={() => go('pairs')}>Parlay Builder</button>
          <button onClick={() => go('inj')}>Injuries</button>
          <button onClick={() => go('nba')}>NBA</button>
          <div className="live">Live data<br />Through Week {m.weeks_played}<br />Updated {m.generated}</div>
        </aside>
        <div className="mn">
          <h2>Anytime Touchdown<span className="pill on">{m.predict_week}</span><span className="pill">{gm.length} games</span></h2>
          <div className="sub">Chance each player scores a rushing or receiving touchdown, built from team totals and red zone roles. Model estimates, not guarantees.</div>
          <div className="strip">
            {gm.map(g => (
              <div key={g.away + g.home} className={'gm' + (game && game.home === g.home ? ' on' : '')} onClick={() => setGame(game && game.home === g.home ? null : g)}>
                <b>{g.away} @ {g.home}</b>
                {g.proj_away}-{g.proj_home} · o/u {g.total_line}
              </div>
            ))}
          </div>
          <div className="flt">
            <div className="chips">{['All', 'RB', 'WR', 'TE', 'QB', 'No QBs'].map(x => <button key={x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
            <input className="q" placeholder="Search player or team" value={q} onChange={e => setQ(e.target.value)} />
            <label style={{ fontSize: 12, color: 'var(--mu)', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />Show inactive</label>
          </div>
          <div className="heroes">
            {heroes.map((p, i) => (
              <div className="hero" key={p.name + p.team}>
                <div className="tile">{p.pos}</div>
                <div className="in">
                  <div className="meta">#{i + 1}</div>
                  <div className="nm">{p.name}</div>
                  <div className="meta">{p.pos} · {p.team} vs {p.next_opp}</div>
                  <div>{tags(p)}</div>
                  <div><span className="big">{pct(p.prob)}</span><span className="fair">fair {fairOdds(p.prob)}</span></div>
                  <div className="bar"><i style={{ width: Math.round(p.prob * 100) + '%' }} /></div>
                </div>
              </div>
            ))}
          </div>
          <div className="rows">
            <div className="hd">Ranked by chance to score</div>
            {rest.map((p, i) => (
              <div className="rw" key={p.name + p.team}>
                <span style={{ color: 'var(--mu)', fontSize: 12 }}>{i + 4}</span>
                <span className="av">{p.pos}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{p.name}</div>
                  <div className="meta" style={{ margin: 0 }}>{p.pos} · {p.team} vs {p.next_opp}</div>
                </div>
                <div className="bc"><div style={{ marginBottom: 2 }}>{tags(p)}</div><div className="bar"><i style={{ width: Math.round(p.prob * 100) + '%' }} /></div></div>
                <div className="pc">{pct(p.prob)}<small>fair {fairOdds(p.prob)}</small></div>
              </div>
            ))}
            {!list.length && <div className="rw" style={{ display: 'block', color: 'var(--mu)' }}>No players match.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
