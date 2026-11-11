// ============ NBA Matchups ============
//
// Broadcast-style slides for each game on the slate: a slate overview, a game
// card, defense versus position for each side, player projections and combined
// projections. Everything is built from TransferSportal's own data:
// DATA.nba.defense (opponent defense factors by position group), the top 100
// player projections in DATA.nba.players, and the injury flags in DATA.daily.
//
// Projected scores and win probabilities come from DATA.nba_games (nba_model.py),
// per game allowances from DATA.nba_games.allow, and embedded logos and
// headshots from window.NBAIMG. Nothing here is a price. Each slide is drawn on
// a fixed 960 by 540 canvas and scaled to fit the screen, so it looks the same
// on a phone and a desktop.

const MU_STATS = [['pts', 'POINTS'], ['reb', 'REBOUNDS'], ['ast', 'ASSISTS'], ['fg3', 'MADE THREES']];
const MU_TEAMS = {
  ATL: ['Atlanta', 'Hawks', '#E03A3E'], BKN: ['Brooklyn', 'Nets', '#5b5b5b'], BOS: ['Boston', 'Celtics', '#007A33'],
  CHA: ['Charlotte', 'Hornets', '#00788C'], CHI: ['Chicago', 'Bulls', '#CE1141'], CLE: ['Cleveland', 'Cavaliers', '#860038'],
  DAL: ['Dallas', 'Mavericks', '#00538C'], DEN: ['Denver', 'Nuggets', '#2f5597'], DET: ['Detroit', 'Pistons', '#C8102E'],
  GS: ['Golden State', 'Warriors', '#1D428A'], HOU: ['Houston', 'Rockets', '#CE1141'], IND: ['Indiana', 'Pacers', '#2f4f9f'],
  LAC: ['Los Angeles', 'Clippers', '#C8102E'], LAL: ['Los Angeles', 'Lakers', '#552583'], MEM: ['Memphis', 'Grizzlies', '#5D76A9'],
  MIA: ['Miami', 'Heat', '#98002E'], MIL: ['Milwaukee', 'Bucks', '#00471B'], MIN: ['Minnesota', 'Timberwolves', '#236192'],
  NO: ['New Orleans', 'Pelicans', '#85714D'], NY: ['New York', 'Knicks', '#006BB6'], OKC: ['Oklahoma City', 'Thunder', '#007AC1'],
  ORL: ['Orlando', 'Magic', '#0077C0'], PHI: ['Philadelphia', '76ers', '#006BB6'], PHX: ['Phoenix', 'Suns', '#5b3fb0'],
  POR: ['Portland', 'Trail Blazers', '#E03A3E'], SAC: ['Sacramento', 'Kings', '#5A2D81'], SA: ['San Antonio', 'Spurs', '#8a8d8f'],
  TOR: ['Toronto', 'Raptors', '#CE1141'], UTAH: ['Utah', 'Jazz', '#4b2e83'], WSH: ['Washington', 'Wizards', '#002B5C'],
};
function muTeam(t) { return MU_TEAMS[t] || [t, '', '#333']; }

function muOrd(n) {
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function muF1(v) { return v == null || isNaN(v) ? '–' : Number(v).toFixed(1); }

// Rank every team on every (position group, stat). Rank 1 is the most generous defense.
// With per game allowances, f is the allowance over the league average for that group
// and v is the raw allowance. Without them f is the old model multiplier and v is null.
function muRanks(defense, allow) {
  const A = allow && allow.teams ? allow : null;
  const teams = Object.keys(A ? A.teams : (defense || {}));
  const out = {};
  teams.forEach(t => { out[t] = []; });
  ['G', 'F', 'C'].forEach(g => {
    MU_STATS.forEach(([k, label]) => {
      const lg = A && A.league && A.league[g] ? A.league[g][k] : null;
      const rows = teams
        .map(t => {
          if (A) {
            const v = A.teams[t] && A.teams[t][g] ? A.teams[t][g][k] : null;
            return { t, v, f: v != null && lg ? v / lg : null };
          }
          return { t, v: null, f: defense[t] && defense[t][g] ? defense[t][g][k] : null };
        })
        .filter(r => r.f != null)
        .sort((a, b) => b.f - a.f);
      rows.forEach((r, i) => out[r.t].push({ g, k, label, f: r.f, v: r.v, lg, rank: i + 1, of: rows.length }));
    });
  });
  return out;
}
function muShot(p) {
  const h = window.NBAIMG && window.NBAIMG.heads;
  return (h && h[p.id]) || p.headshot || '';
}
function muModel(DATA) {
  const m = {};
  const G = (DATA.nba_games && DATA.nba_games.games) || [];
  G.forEach(g => { m[g.away + '@' + g.home + '@' + nbaDayKey(g.date)] = g; });
  return m;
}
function muPct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }

function muStatus(p, flags) {
  const f = flags[p.name];
  if (f) return f.status;
  if (p.injury && p.injury.status) return p.injury.status;
  return null;
}
function muShort(s) {
  const t = String(s || '').toLowerCase();
  if (t.indexOf('out') === 0) return 'OUT';
  if (t.indexOf('doubtful') === 0) return 'D';
  if (t.indexOf('question') === 0) return 'Q';
  if (t.indexOf('probable') === 0) return 'P';
  if (t.indexOf('day') === 0) return 'DTD';
  return String(s || '').toUpperCase();
}
function muIsOut(p, flags) {
  const s = muStatus(p, flags);
  return !!s && String(s).toLowerCase().indexOf('out') === 0;
}
function muLast(name) {
  const parts = String(name || '').split(' ');
  const suf = ['Jr.', 'Sr.', 'II', 'III', 'IV'];
  let last = parts[parts.length - 1];
  if (parts.length > 1 && suf.indexOf(last) >= 0) last = parts[parts.length - 2];
  return last;
}

function MuLogo({ t, size }) {
  return (
    <img className="muLogo" style={{ width: size, height: size }} src={(window.NBAIMG && window.NBAIMG.logos && window.NBAIMG.logos[t]) || nbaLogo(t)} alt={t}
      onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
  );
}

// A fixed 960 x 540 slide, scaled down to the width of its container.
function MuSlide({ tag, sub, children, note }) {
  const ref = React.useRef(null);
  const [s, setS] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const f = () => setS((el.clientWidth / 960) || 1);
    f();
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(f); ro.observe(el); }
    window.addEventListener('resize', f);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', f); };
  }, []);
  return (
    <div className="muFrame" ref={ref} style={{ height: 540 * s }}>
      <div className="muSlide" style={{ transform: 'scale(' + s + ')' }}>
        <div className="muBg" />
        <div className="muBrand"><span className="muMark"><i /><i /><i /></span>TransferSportal</div>
        <div className="muTag"><b>{tag}</b>{sub ? <span>{sub}</span> : null}</div>
        {children}
        <div className="muFoot">
          <span>Projections, not prices</span>
          <span>{note || 'TransferSportal model'}</span>
          <span>21+ · Bet responsibly</span>
        </div>
      </div>
    </div>
  );
}

function MuTitle({ kicker, title, sub }) {
  return (
    <div className="muTitle">
      <div className="muKick">{kicker}</div>
      <div className="muH">{title}</div>
      {sub ? <div className="muSubT">{sub}</div> : null}
    </div>
  );
}

// ---- slide 1: the slate ----
function MuSlateSlide({ games, cur, day, onPick, model }) {
  const cols = games.length > 4 ? 3 : 2;
  return (
    <MuSlide tag={games.length + ' GAMES · ONE SLATE'} sub={day}>
      <MuTitle kicker={'NBA GAME NIGHT / ' + day} title={games.length + ' GAMES. ONE SLATE.'} sub="Tap a game to open its slides" />
      <div className="muSlate" style={{ gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))' }}>
        {games.map((g, i) => {
          const m = model[g.away.team + '@' + g.home.team + '@' + nbaDayKey(g.date)];
          return (
          <button key={g.key} className={'muTile' + (g.key === cur ? ' on' : '')} onClick={() => onPick(g.key)}>
            <div className="muTileRow">
              <div className="muTileTeam"><MuLogo t={g.away.team} size={30} /><b>{g.away.team}</b></div>
              <div className="muTileMid">AT</div>
              <div className="muTileTeam"><b>{g.home.team}</b><MuLogo t={g.home.team} size={30} /></div>
            </div>
            <div className="muTileProj">
              <b>{m ? Math.round(m.proj.away) : '–'}</b>
              <span>{m ? 'WIN ' + muPct(m.win.away) + ' / ' + muPct(m.win.home) : 'NO MODEL YET'}</span>
              <b>{m ? Math.round(m.proj.home) : '–'}</b>
            </div>
            {games.length <= 6 ? (
              <div className="muTileTop">
                <div className="muBlk"><em>{g.away.star ? muLast(g.away.star.name) + ' PTS' : '-'}</em><b>{g.away.star ? muF1(g.away.star.proj.pts) : ''}</b></div>
                <div className="muBlk r"><em>{g.home.star ? muLast(g.home.star.name) + ' PTS' : '-'}</em><b>{g.home.star ? muF1(g.home.star.proj.pts) : ''}</b></div>
              </div>
            ) : null}
            <div className="muTileTime">{nbaDay(g.date)} ET · PROJECTED FINAL</div>
          </button>
          );
        })}
      </div>
    </MuSlide>
  );
}

// ---- slide 2: the game card ----
function MuStar({ side, game }) {
  const t = muTeam(side.team);
  const p = side.star;
  return (
    <div className="muStar" style={{ background: 'linear-gradient(135deg, ' + t[2] + '66, #0b1119 70%)', borderColor: t[2] + '99' }}>
      <div className="muStarTeam"><MuLogo t={side.team} size={30} /><span>{t[0].toUpperCase()}</span></div>
      <div className="muStarName">{t[1].toUpperCase()}</div>
      <div className="muBig">{p ? muF1(p.proj.pts) : '–'}</div>
      <div className="muCap">TOP PROJECTED SCORER, POINTS</div>
      {p ? (
        <>
          <div className="muStarPlayer">{p.name}</div>
          <div className="muCap">{muF1(p.proj.reb)} REB / {muF1(p.proj.ast)} AST / {muF1(p.proj.fg3)} 3PM</div>
          {muShot(p) ? <img className="muShot" src={muShot(p)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
        </>
      ) : <div className="muCap">No top 100 player on this team</div>}
    </div>
  );
}
function MuGameSlide({ g, idx, total, day, flags, model }) {
  const m = model[g.away.team + '@' + g.home.team + '@' + nbaDayKey(g.date)];
  const watch = [].concat(g.away.players, g.home.players).map(p => ({ p, s: muStatus(p, flags) }))
    .filter(x => x.s && String(x.s).toLowerCase().indexOf('probable') !== 0);
  const A = g.away.team, H = g.home.team;
  const none = 'NO GAME MODEL YET';
  let t1 = { k: 'PROJECTED FINAL', v: '–', s: none };
  let t2 = { k: 'WIN PROBABILITY', v: '–', s: none };
  let t3 = { k: 'MODEL MARGIN AND TOTAL', v: '–', s: none };
  if (m) {
    const fav = m.margin >= 0 ? H : A;
    t1 = { k: 'PROJECTED FINAL', v: m.proj.away.toFixed(0) + ' – ' + m.proj.home.toFixed(0), s: A + ' – ' + H + ' · TOTAL ' + m.total.toFixed(1) };
    t2 = { k: 'WIN PROBABILITY', v: muPct(m.win.away) + ' / ' + muPct(m.win.home), s: A + ' WIN / ' + H + ' WIN', bar: m.win.away };
    t3 = { k: 'MODEL MARGIN AND TOTAL', v: fav + ' -' + Math.abs(m.margin).toFixed(1),
      s: m.line && m.line.spread != null ? 'POSTED ' + m.line.fav + ' -' + m.line.spread + ' · MODEL COVERS ' + muPct(m.line.fav_covers) : 'MODEL ONLY, NO POSTED LINE USED' };
  }
  const adjNote = m && (m.adj.away || m.adj.home)
    ? 'ADJ FOR OUT: ' + [m.adj.away ? A + ' ' + m.adj.away.toFixed(1) : '', m.adj.home ? H + ' ' + m.adj.home.toFixed(1) : ''].filter(Boolean).join(' · ')
    : 'LATEST TRANSFERSPORTAL FLAGS';
  const tiles = [t1, t2, t3];
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={A + ' @ ' + H} note={day + ' · ' + nbaDay(g.date) + ' ET'}>
      <div className="muGameTitle">{muTeam(A)[1].toUpperCase()} AT {muTeam(H)[1].toUpperCase()}</div>
      <div className="muCard2">
        <MuStar side={g.away} game={g} />
        <div className="muMid"><span>TIP</span><b>{nbaDay(g.date).split(' ').slice(1).join(' ')}</b><span>ET</span></div>
        <MuStar side={g.home} game={g} />
      </div>
      <div className="muTiles3">
        {tiles.map((t, i) => (
          <div className="muT3" key={i}>
            <div className="muT3k">{t.k}</div>
            <div className="muT3v">{t.v}</div>
            {t.bar != null ? <div className="muBar"><i style={{ width: (t.bar * 100) + '%' }} /></div> : null}
            <div className="muCap">{t.s}</div>
          </div>
        ))}
        <div className="muT3">
          <div className="muT3k">INJURY WATCH, TOP 100</div>
          <div className="muT3w">{watch.length ? watch.slice(0, 4).map((x, i) => <span key={i}>{muLast(x.p.name).toUpperCase()} <em>{muShort(x.s)}</em></span>) : <span>NO FLAGS</span>}</div>
          <div className="muCap">{adjNote}</div>
        </div>
      </div>
    </MuSlide>
  );
}

// ---- slide 3 and 4: defense versus position ----
function MuDvpSlide({ g, idx, total, side, flags, ranks, players, day }) {
  const list = (ranks[side.opp] || []);
  const soft = list.slice().sort((a, b) => b.f - a.f).slice(0, 4);
  const tough = list.filter(r => r.rank > r.of - 5).sort((a, b) => a.f - b.f).slice(0, 2);
  const rows = soft.map(r => Object.assign({ tough: false }, r)).concat(tough.map(r => Object.assign({ tough: true }, r)));
  const who = grp => {
    const c = players.filter(p => p.team === side.team && p.grp === grp && !muIsOut(p, flags)).sort((a, b) => a.rank - b.rank)[0];
    return c ? c.name : '';
  };
  const pct = f => (f >= 1 ? '+' : '') + ((f - 1) * 100).toFixed(1) + '%';
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away.team + ' @ ' + g.home.team} note={day}>
      <MuTitle kicker={muTeam(side.opp)[1].toUpperCase() + ' ALLOW / ' + muTeam(side.team)[1].toUpperCase() + ' MATCHUP'} title="DEFENSE VS POSITION"
        sub="Average per game allowed to the top 100 players at each position group. Not team totals." />
      <div className="muRows">
        {rows.map((r, i) => (
          <div className={'muRow' + (r.tough ? ' tough' : '')} key={i}>
            <div className="muBadge" style={!r.tough && r.rank > 10 ? { background: '#56697a', color: '#fff' } : null}>{r.tough ? muOrd(r.of - r.rank + 1) + ' FEWEST' : muOrd(r.rank) + ' MOST'}</div>
            <div className="muRowMain"><b>{r.label} TO {r.g}{r.v != null ? ' · PER GAME' : ''}</b><span>{who(r.g)}</span></div>
            <div className="muRowVal"><b>{r.v != null ? muF1(r.v) : pct(r.f)}</b><span>{r.v != null ? pct(r.f) + ' VS LG ' + muF1(r.lg) : 'VS AVG'}</span></div>
          </div>
        ))}
        {!rows.length ? <div className="muCap" style={{ padding: 16 }}>NO DEFENSE DATA FOR {side.opp}</div> : null}
      </div>
    </MuSlide>
  );
}

// ---- slide 5 and 6: projections ----
function MuTable({ side, cols, flags }) {
  const t = muTeam(side.team);
  const rows = side.players.slice().sort((a, b) => (b.proj.pts || 0) - (a.proj.pts || 0)).slice(0, 7);
  return (
    <div className="muPanel" style={{ '--n': cols.length, '--w': cols.length === 4 ? '56px' : '42px' }}>
      <div className="muPanelHead"><MuLogo t={side.team} size={26} /><b>{t[0].toUpperCase()} {t[1].toUpperCase()}</b></div>
      <div className="muTr muTh"><span /><span>PLAYER</span>{cols.map(c => <span key={c[0]}>{c[0]}</span>)}</div>
      {rows.map(p => {
        const st = muStatus(p, flags);
        return (
          <div className="muTr" key={p.id || p.name}>
            <span className="muAv">{muShot(p) ? <img src={muShot(p)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}</span>
            <span className="muPl">{p.name}{st && String(st).toLowerCase().indexOf('probable') !== 0 ? <em className={'muSt ' + muShort(st).toLowerCase()}>{muShort(st)}</em> : null}</span>
            {cols.map(c => <span key={c[0]}>{muF1(c[1](p))}</span>)}
          </div>
        );
      })}
      {!rows.length ? <div className="muCap" style={{ padding: '10px 14px' }}>NO TOP 100 PLAYERS ON THIS TEAM</div> : null}
    </div>
  );
}
const MU_COLS_P = [['MIN', p => (p.windows && p.windows['10'] ? p.windows['10'].min : p.min_l10)], ['PTS', p => p.proj.pts], ['REB', p => p.proj.reb], ['AST', p => p.proj.ast], ['3PM', p => p.proj.fg3]];
const MU_COLS_C = [['PRA', p => p.proj.pra != null ? p.proj.pra : (p.proj.pts + p.proj.reb + p.proj.ast)], ['P+R', p => p.proj.pts + p.proj.reb], ['P+A', p => p.proj.pts + p.proj.ast], ['R+A', p => p.proj.reb + p.proj.ast]];
function MuProjSlide({ g, idx, total, flags, cols, title, kicker, day }) {
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away.team + ' @ ' + g.home.team} note={day}>
      <MuTitle kicker={(g.away.players.length + g.home.players.length) + ' PROJECTED PLAYERS'} title={title} sub={kicker} />
      <div className="muPanels">
        <MuTable side={g.away} cols={cols} flags={flags} />
        <MuTable side={g.home} cols={cols} flags={flags} />
      </div>
    </MuSlide>
  );
}

function MuMethod({ G }) {
  if (!G) return <div className="dbNote" style={{ marginTop: 8 }}>Projected scores and allowances appear after the next daily build.</div>;
  const bt = G.backtest;
  return (
    <div className="dbNote" style={{ marginTop: 8 }}>
      Projected scores come from team scoring ratings fit on every final score this season and last. Win probability is a normal curve on the projected margin
      {G.sd ? ' (spread ' + G.sd + ' points' + (bt ? ', set by a walk forward test on last season: ' + bt.winner_pct + '% winners picked, ' + bt.margin_mae + ' point average miss on the margin, ' + bt.games + ' games' : '') + ')' : ''}.
      Players listed out cost their team about a third of their last 10 scoring, which is a rule of thumb and not a fit.
      Allowances are per player averages for the top 100 players only, so they are not team totals.
      {G.generated ? ' Model built ' + G.generated + '.' : ''}
    </div>
  );
}

function NbaMatchups({ DATA }) {
  const N = DATA.nba;
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const ranks = useMemo(() => (N ? muRanks(N.defense, DATA.nba_games && DATA.nba_games.allow) : {}), [N, DATA]);
  const model = useMemo(() => muModel(DATA), [DATA]);
  const flags = useMemo(() => {
    const m = {};
    (((DATA.daily || {}).nba || {}).flags || []).forEach(f => { m[f.player] = f; });
    return m;
  }, [DATA]);

  const { days, games } = useMemo(() => {
    const g = {};
    ((N && N.players) || []).forEach(p => {
      const nx = p.next;
      if (!nx || !nx.opp || !nx.date || !p.proj) return;
      const key = nx.date + '|' + [p.team, nx.opp].sort().join('@');
      if (!g[key]) g[key] = { key, date: nx.date, teams: {} };
      const t = g[key].teams;
      if (!t[p.team]) t[p.team] = { team: p.team, opp: nx.opp, home: nx.home, players: [] };
      t[p.team].players.push(p);
    });
    const list = Object.keys(g).map(k => g[k]).sort((a, b) => a.date.localeCompare(b.date));
    list.forEach(x => {
      Object.keys(x.teams).forEach(tm => {
        const o = x.teams[tm].opp;
        if (!x.teams[o]) x.teams[o] = { team: o, opp: tm, home: !x.teams[tm].home, players: [] };
      });
      const ts = Object.keys(x.teams).map(k => x.teams[k]);
      x.away = ts.find(t => !t.home) || ts[0];
      x.home = ts.find(t => t.home) || ts[1];
      [x.away, x.home].forEach(s => {
        s.star = s.players.filter(p => !muIsOut(p, flags)).sort((a, b) => b.proj.pts - a.proj.pts)[0] || null;
      });
    });
    return { days: Array.from(new Set(list.map(x => nbaDayKey(x.date)))).sort(), games: list };
  }, [N, flags]);

  if (!N) return <section className="view on"><h2 className="tsH">Matchups</h2><div className="dbNote">Waiting for NBA data.</div></section>;
  const cur = day || days[0];
  const shown = games.filter(x => nbaDayKey(x.date) === cur);
  const sel = shown.find(x => x.key === pick) || shown[0];
  const idx = sel ? shown.indexOf(sel) + 1 : 0;
  const dLabel = new Date(cur + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  return (
    <section className="view on">
      <style>{MU_CSS}</style>
      <h2 className="tsH">Matchups<span className="pill on">{cur}</span></h2>
      <div className="muDays">
        {days.map(d => <button key={d} className={'pill' + (d === cur ? ' on' : '')} onClick={() => { setDay(d); setPick(null); }}>{d}</button>)}
      </div>
      {shown.length ? (
        <>
          <MuSlateSlide games={shown} cur={sel.key} day={dLabel} onPick={setPick} model={model} />
          <div className="muDays" style={{ marginTop: 14 }}>
            {shown.map(x => <button key={x.key} className={'pill' + (x.key === sel.key ? ' on' : '')} onClick={() => setPick(x.key)}>{x.away.team} @ {x.home.team}</button>)}
          </div>
          <MuGameSlide g={sel} idx={idx} total={shown.length} day={dLabel} flags={flags} model={model} />
          <MuDvpSlide g={sel} idx={idx} total={shown.length} side={sel.away} flags={flags} ranks={ranks} players={N.players} day={dLabel} />
          <MuDvpSlide g={sel} idx={idx} total={shown.length} side={sel.home} flags={flags} ranks={ranks} players={N.players} day={dLabel} />
          <MuProjSlide g={sel} idx={idx} total={shown.length} flags={flags} cols={MU_COLS_P} title="PLAYER PROJECTIONS" kicker="Minutes are the last 10 game average. Everything else is the model projection for this game." day={dLabel} />
          <MuProjSlide g={sel} idx={idx} total={shown.length} flags={flags} cols={MU_COLS_C} title="COMBINATION PROJECTIONS" kicker="Sums of the model's points, rebounds and assists projections." day={dLabel} />
          <div className="dbNote" style={{ marginTop: 8 }}>Tags: OUT, D doubtful, Q questionable, DTD day to day. They come from the latest TransferSportal injury flags, so confirm before tip.</div>
          <MuMethod G={DATA.nba_games} />
        </>
      ) : <div className="dbNote">No games listed for this day.</div>}
    </section>
  );
}

const MU_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
.muDays{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.muDays button{appearance:none;background:var(--card);cursor:pointer;font-family:inherit}
.muFrame{width:100%;margin:0 0 14px;position:relative;overflow:hidden;border-radius:10px;border:1px solid #1d2a36}
.muSlide{position:absolute;left:0;top:0;width:960px;height:540px;transform-origin:top left;background:#070b10;color:#eef2f6;font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;overflow:hidden}
.muSlide *{box-sizing:border-box}
.muBg{position:absolute;inset:0;background:
  linear-gradient(115deg,transparent 0 14%,rgba(34,197,94,.07) 14% 15%,transparent 15% 85%,rgba(251,146,60,.06) 85% 86%,transparent 86%),
  repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 36px),
  repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 1px,transparent 1px 36px),
  radial-gradient(ellipse at 50% 38%,#122030 0,#070b10 70%)}
.muBrand{position:absolute;left:26px;top:20px;font-size:25px;letter-spacing:.5px;display:flex;align-items:center;gap:9px;z-index:2}
.muMark{display:inline-flex;align-items:flex-end;gap:3px;height:22px}
.muMark i{display:block;width:5px;background:#22c55e;border-radius:1px}
.muMark i:nth-child(1){height:10px;background:#ef4444}.muMark i:nth-child(2){height:16px}.muMark i:nth-child(3){height:22px}
.muTag{position:absolute;right:26px;top:18px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#7fe0a0;z-index:2;border-top:2px solid #22c55e;padding-top:6px;min-width:230px;background:rgba(10,18,26,.7)}
.muTag b{font-weight:500;display:block;letter-spacing:.5px}
.muTag span{display:block;color:#aeb8c4;font-size:10px;margin-top:2px}
.muTitle{position:absolute;left:0;right:0;top:62px;text-align:center;z-index:2}
.muKick{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#4ade80;letter-spacing:.8px}
.muH{font-size:54px;line-height:1;margin-top:4px;color:#fff;letter-spacing:.5px}
.muSubT{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#aeb8c4;margin-top:4px}
.muFoot{position:absolute;left:0;right:0;bottom:0;height:34px;display:flex;justify-content:space-between;align-items:center;padding:0 26px;background:rgba(5,8,12,.9);border-top:1px solid #16212b;font-size:15px;letter-spacing:.4px;z-index:2}
.muFoot span:nth-child(2){font-family:'IBM Plex Mono',monospace;font-size:10px;color:#7d8896}
.muFoot span:first-child,.muFoot span:last-child{font-size:15px}
.muCap{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#9aa5b1;letter-spacing:.3px;text-transform:uppercase}
.muLogo{object-fit:contain;display:inline-block}
.muSlate{position:absolute;left:30px;right:30px;top:170px;bottom:50px;display:grid;gap:14px;z-index:2}
.muTile{appearance:none;text-align:left;font-family:inherit;color:inherit;cursor:pointer;background:linear-gradient(160deg,#142131,#0c131b);border:1px solid #213244;border-radius:10px;padding:12px 18px;display:flex;flex-direction:column;justify-content:space-between}
.muTile.on{border-color:#22c55e;box-shadow:0 0 0 1px #22c55e inset}
.muTileRow{display:flex;align-items:center;justify-content:space-between}
.muTileTeam{display:flex;align-items:center;gap:8px;font-size:32px}
.muTileMid{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#7d8896}
.muTileProj{display:flex;align-items:center;justify-content:space-between;gap:6px}.muTileProj b{font-weight:400;font-size:34px;line-height:1}.muTileProj span{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#4ade80;text-align:center}
.muTileTop{display:flex;justify-content:space-between;align-items:flex-end;gap:8px}
.muBlk{display:flex;flex-direction:column;min-width:0;max-width:48%}.muBlk.r{align-items:flex-end;text-align:right}.muBlk em{font-style:normal;font-size:11px;color:#9aa5b1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.muBlk b{font-weight:400;font-size:22px;line-height:1}
.muTileDash{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#6b7684}
.muTileTime{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#8a95a2}
.muGameTitle{position:absolute;left:0;right:0;top:62px;text-align:center;font-size:50px;z-index:2;letter-spacing:.5px}
.muCard2{position:absolute;left:26px;right:26px;top:128px;height:230px;display:flex;gap:10px;z-index:2}
.muStar{flex:1;position:relative;border:1px solid;border-radius:6px;padding:12px 16px;overflow:hidden}
.muStarTeam{display:flex;align-items:center;gap:8px;font-size:15px;color:#cfd6de;letter-spacing:.8px}
.muStarName{font-size:34px;line-height:1}
.muBig{font-size:96px;line-height:.95;margin-top:2px;position:relative;z-index:2}
.muStarPlayer{font-size:28px;margin-top:6px;position:relative;z-index:1}
.muStar .muCap{position:relative;z-index:1}
.muShot{position:absolute;right:8px;bottom:0;height:178px;object-fit:contain;object-position:bottom}
.muMid{width:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.muMid span{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#7d8896}
.muMid b{font-size:26px;font-weight:400;line-height:1.05;margin:4px 0}
.muTiles3{position:absolute;left:26px;right:26px;top:372px;height:112px;display:flex;gap:10px;z-index:2}
.muT3{flex:1;background:rgba(18,28,38,.92);border:1px solid #1f2f3d;border-radius:6px;padding:9px 14px;position:relative;overflow:hidden}
.muT3k{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#9aa5b1;letter-spacing:.4px}
.muT3v{font-size:34px;color:#4ade80;line-height:1.1;white-space:nowrap}
.muBar{height:5px;background:#fb923c;border-radius:3px;overflow:hidden;margin:2px 0 3px}.muBar i{display:block;height:100%;background:#22c55e}
.muT3w{font-size:19px;line-height:1.25;display:flex;gap:10px;flex-wrap:wrap;margin:2px 0}
.muT3w em{font-style:normal;color:#fbbf24}
.muRows{position:absolute;left:30px;right:30px;top:178px;z-index:2}
.muRow{display:flex;align-items:stretch;margin-bottom:6px;height:44px;background:#121c26;border:1px solid #1f2f3d;border-radius:4px;overflow:hidden;position:relative}
.muRow:after{content:'';position:absolute;right:0;bottom:0;width:46px;height:2px;background:#fb923c}
.muBadge{width:128px;white-space:nowrap;display:flex;align-items:center;justify-content:center;background:#5fb765;color:#08140b;font-size:20px;letter-spacing:.3px}
.muRow.tough .muBadge{background:#b94a4a;color:#fff}
.muRowMain{flex:1;padding:2px 16px;display:flex;flex-direction:column;justify-content:center}
.muRowMain b{font-size:23px;font-weight:400;line-height:1}
.muRowMain span{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#e0a94a}
.muRowVal{width:130px;padding:0 16px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center}
.muRowVal b{font-size:30px;font-weight:400;line-height:1}
.muRowVal span{font-family:'IBM Plex Mono',monospace;font-size:8px;color:#7d8896}
.muPanels{position:absolute;left:24px;right:24px;top:168px;display:flex;gap:12px;z-index:2}
.muPanel{flex:1;background:rgba(14,22,31,.92);border:1px solid #1f2f3d;border-radius:6px;padding:8px 12px;min-height:290px}
.muPanelHead{display:flex;align-items:center;gap:8px;font-size:20px;padding-bottom:6px;border-bottom:1px solid #1d2a36}
.muTr{display:grid;grid-template-columns:26px 1fr repeat(5,46px);align-items:center;gap:4px;height:35px;font-size:21px;border-bottom:1px solid #131d27}
.muPanels .muTr{grid-template-columns:26px 1fr repeat(var(--n,5),var(--w,42px))}
.muTr span:nth-child(n+3){text-align:right;font-family:'Bebas Neue','Arial Narrow',sans-serif}
.muTh{height:26px;font-size:11px;color:#8a95a2;font-family:'IBM Plex Mono',monospace}
.muTh span{font-family:'IBM Plex Mono',monospace!important}
.muAv{width:24px;height:24px;border-radius:50%;background:#1a2733;overflow:hidden;display:block}
.muAv img{width:100%;height:100%;object-fit:cover;object-position:top}
.muPl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:17px}
.muSt{font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:9px;margin-left:6px;padding:1px 5px;border-radius:4px;background:#3a3016;color:#fbbf24;vertical-align:middle}
.muSt.out,.muSt.d{background:#4a1d1d;color:#fca5a5}
`;
