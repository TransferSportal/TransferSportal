// ============ NFL Matchups ============
//
// The same broadcast-style slides as the NBA Matchups section, built from the NFL
// data already on the page: the game model (DATA.games_model: projected scores,
// spread and total), the touchdown board (DATA.players), the defense versus
// position table (DATA.matchup) and team defense totals (DATA.teams).
//
// Win probability is a normal curve on the model's projected margin with a fixed
// spread of 13 points, a common figure for NFL margins. It is not fit here.
// Headshots come from window.NFLIMG (nfl_images.py) and crests from window.CREST.
// Nothing here is a price. The slides reuse the Mu* pieces from App.matchups.jsx.

const NF_SD = 13.0;
const NF_POS = [['QB', 'QUARTERBACKS'], ['RB', 'RUNNING BACKS'], ['WR', 'RECEIVERS'], ['TE', 'TIGHT ENDS']];

function nfCdf(z) {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return 0.5 * (1 + (z >= 0 ? y : -y));
}
function nfTeam(t) {
  const T = (window.TEAM || {})[t] || {};
  return { nick: String(T.nick || t).toUpperCase(), c: T.c || '#334155' };
}
function nfLogoSrc(t) {
  const v = (window.CREST || {})[t];
  return v ? 'data:image/png;base64,' + v : '';
}
function NfLogo({ t, size }) {
  const src = nfLogoSrc(t);
  return (
    <span className="nfChip" style={{ width: size, height: size }}>
      {src ? <img src={src} alt={t} /> : <b>{t}</b>}
    </span>
  );
}
function nfShot(p) {
  const h = window.NFLIMG && window.NFLIMG.heads;
  return (h && h[p.name + '|' + p.team]) || '';
}
function nfPct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
function nfSigned(x) { return x == null ? '–' : (x > 0 ? '+' : '') + Number(x).toFixed(1); }
function nfDay(kick) {
  return new Date(kick + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function nfPlayers(DATA, team) {
  return DATA.players.filter(p => p.team === team && p.rostered !== false && p.prob != null).sort((a, b) => b.prob - a.prob);
}
function nfGame(g) {
  const sp = g.proj_spread != null ? g.proj_spread : (g.proj_home - g.proj_away);
  const wh = nfCdf(sp / NF_SD);
  return { sp, wh, wa: 1 - wh, fav: sp >= 0 ? g.home : g.away };
}
function nfEnv(DATA, g) {
  const o = t => { const x = DATA.teams[t] && DATA.teams[t].cur_off; return x && x.G ? x.total.aTD / x.G : null; };
  const d = t => { const x = DATA.teams[t] && DATA.teams[t].cur_def; return x && x.G ? x.total.aTD / x.G : null; };
  const parts = [o(g.away), d(g.home), o(g.home), d(g.away)].filter(v => v != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}
// Rank 1 = the defense that allows the most per game.
function nfDefRank(DATA, team, sel) {
  const vals = Object.keys(DATA.teams).map(t => {
    const d = DATA.teams[t].cur_def;
    return { t, v: d && d.G ? sel(d) / d.G : null };
  }).filter(r => r.v != null).sort((a, b) => b.v - a.v);
  const i = vals.findIndex(r => r.t === team);
  const me = vals[i];
  return me ? { rank: i + 1, of: vals.length, v: me.v } : null;
}

// ---- slide 1: the slate ----
function NfSlateSlide({ games, cur, day, onPick }) {
  const cmp = games.length > 6;
  const cols = games.length > 4 ? 3 : 2;
  return (
    <MuSlide tag={games.length + ' GAMES · ONE SLATE'} sub={day}>
      <MuTitle kicker={'NFL GAME DAY / ' + day} title={games.length + (games.length === 1 ? ' GAME.' : ' GAMES.') + ' ONE SLATE.'} sub="Tap a game to open its slides" />
      <div className={'muSlate nfSlate' + (cmp ? ' nfCmp' : '')} style={{ gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))' }}>
        {games.map(g => {
          const m = nfGame(g.g);
          return (
            <button key={g.key} className={'muTile' + (g.key === cur ? ' on' : '')} onClick={() => onPick(g.key)}>
              <div className="muTileRow">
                <div className="muTileTeam"><NfLogo t={g.g.away} size={cmp ? 24 : 30} /><b>{g.g.away}</b></div>
                <div className="nfScore">{g.g.proj_away != null ? Math.round(g.g.proj_away) : '–'}<i>–</i>{g.g.proj_home != null ? Math.round(g.g.proj_home) : '–'}</div>
                <div className="muTileTeam"><b>{g.g.home}</b><NfLogo t={g.g.home} size={cmp ? 24 : 30} /></div>
              </div>
              <div className="muTileTime">WIN {nfPct(m.wa)} / {nfPct(m.wh)} · {m.fav} {g.g.proj_spread != null ? '-' + Math.abs(m.sp).toFixed(1) : ''} · {g.g.kick}</div>
              {!cmp ? (
                <div className="muTileTop">
                  <div className="muBlk"><em>{g.top.away ? muLast(g.top.away.name) + ' ANYTIME TD' : '-'}</em><b>{g.top.away ? nfPct(g.top.away.prob) : ''}</b></div>
                  <div className="muBlk r"><em>{g.top.home ? muLast(g.top.home.name) + ' ANYTIME TD' : '-'}</em><b>{g.top.home ? nfPct(g.top.home.prob) : ''}</b></div>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </MuSlide>
  );
}

// ---- slide 2: the game card ----
function NfStar({ team, p }) {
  const T = nfTeam(team);
  return (
    <div className="muStar" style={{ background: 'linear-gradient(135deg, ' + T.c + '66, #0b1119 70%)', borderColor: T.c + '99' }}>
      <div className="muStarTeam"><NfLogo t={team} size={30} /><span>{team}</span></div>
      <div className="muStarName">{T.nick}</div>
      <div className="muBig">{p ? nfPct(p.prob) : '–'}</div>
      <div className="muCap">TOP ANYTIME TOUCHDOWN PROBABILITY</div>
      {p ? (
        <>
          <div className="muStarPlayer">{p.name}</div>
          <div className="muCap">{p.pos} · FIRST TD {nfPct(p.prob_first)} · 2+ TD {nfPct(p.prob_two)}</div>
          {nfShot(p) ? <img className="muShot" src={nfShot(p)} alt="" /> : null}
        </>
      ) : <div className="muCap">No ranked player on this team</div>}
    </div>
  );
}
function NfGameSlide({ DATA, g, idx, total, day, top }) {
  const m = nfGame(g);
  const env = nfEnv(DATA, g);
  const pos = g.ats_pick_team ? g.ats_pick : null;
  const tiles = [
    { k: 'PROJECTED FINAL', v: Math.round(g.proj_away) + ' – ' + Math.round(g.proj_home), s: g.away + ' – ' + g.home + (env != null ? ' · TD ENV ' + env.toFixed(2) + '/G' : '') },
    { k: 'WIN PROBABILITY', v: nfPct(m.wa) + ' / ' + nfPct(m.wh), s: g.away + ' WIN / ' + g.home + ' WIN', bar: m.wa },
    { k: 'SPREAD, MODEL VS POSTED', v: m.fav + ' -' + Math.abs(m.sp).toFixed(1), s: g.spread_line != null ? 'POSTED ' + (g.spread_line > 0 ? g.home + ' -' + g.spread_line : g.spread_line < 0 ? g.home + ' +' + Math.abs(g.spread_line) : 'PICK') + (pos ? ' · MODEL LEAN ' + pos : '') : 'NO POSTED LINE' },
    { k: 'TOTAL, MODEL VS POSTED', v: g.proj_total != null ? g.proj_total.toFixed(1) : '–', s: g.total_line != null ? 'POSTED ' + g.total_line + (g.ou_pick ? ' · MODEL LEAN ' + g.ou_pick.toUpperCase() : '') : 'NO POSTED TOTAL' },
  ];
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away + ' @ ' + g.home} note={day + ' · ' + g.kick}>
      <div className="muGameTitle">{nfTeam(g.away).nick} AT {nfTeam(g.home).nick}</div>
      <div className="muCard2">
        <NfStar team={g.away} p={top.away} />
        <div className="muMid"><span>WEEK</span><b>{g.week}</b><span>{nfDay(g.kick).split(',')[0].toUpperCase()}</span></div>
        <NfStar team={g.home} p={top.home} />
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
      </div>
    </MuSlide>
  );
}

// ---- slide 3: the matchup edges ----
function NfEdgesSlide({ g, idx, total, day }) {
  const M = g.matchup;
  const rows = (M && M.rows) || [];
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away + ' @ ' + g.home} note={day}>
      <MuTitle kicker={g.away + ' ' + (M ? M.away_areas : 0) + ' AREAS / ' + g.home + ' ' + (M ? M.home_areas : 0) + ' AREAS / ' + (M ? M.even_areas : 0) + ' EVEN'} title="MATCHUP EDGES"
        sub="Each team's offense against the other's defense, scored 0 to 100 against the league. The longer bar wins the area." />
      <div className="nfEdges">
        <div className="nfEdgeHead"><span>{g.away}</span><span /><span>{g.home}</span></div>
        {rows.map(r => (
          <div className="nfEdge" key={r.cat}>
            <b className={r.favors === g.away ? 'w' : ''}>{Math.round(r.away_val)}</b>
            <div className="nfBarL"><i style={{ width: r.away_val + '%' }} className={r.favors === g.away ? 'w' : ''} /></div>
            <span>{r.label.toUpperCase()}</span>
            <div className="nfBarR"><i style={{ width: r.home_val + '%' }} className={r.favors === g.home ? 'w' : ''} /></div>
            <b className={r.favors === g.home ? 'w' : ''}>{Math.round(r.home_val)}</b>
          </div>
        ))}
        {!rows.length ? <div className="muCap" style={{ padding: 16 }}>NO MATCHUP DATA FOR THIS GAME</div> : null}
      </div>
    </MuSlide>
  );
}

// ---- slide 4 and 5: defense versus position ----
function NfDvpSlide({ DATA, g, idx, total, side, opp, day }) {
  const MX = DATA.matchup || {};
  const D = (DATA.teams[opp] && DATA.teams[opp].cur_def) || null;
  const players = nfPlayers(DATA, side);
  const who = pos => { const c = players.find(p => p.pos === pos); return c ? c.name : ''; };
  const n = Object.keys(MX).length || 32;
  const rows = NF_POS.map(([pos, label]) => {
    const m = MX[opp] && MX[opp][pos];
    if (!m) return null;
    const yd = D && D.G ? (pos === 'QB' ? D.pos.QB.paY : pos === 'RB' ? D.pos.RB.ruY : D.pos[pos].reY) / D.G : null;
    const ydl = pos === 'QB' ? 'PASS' : pos === 'RB' ? 'RUSH' : 'REC';
    return { key: pos, rank: m.soft_rank, of: n, label: 'TDS TO ' + pos + ' · PER GAME', val: m.allowed_pg.toFixed(2), sub: 'INDEX ' + m.idx.toFixed(2) + (yd != null ? ' · ' + yd.toFixed(1) + ' ' + ydl + ' YDS/G' : ''), who: who(pos), f: m.idx };
  }).filter(Boolean);
  const pass = nfDefRank(DATA, opp, d => d.total.paY);
  const rush = nfDefRank(DATA, opp, d => d.pos.RB.ruY + d.pos.QB.ruY + d.pos.WR.ruY + d.pos.TE.ruY);
  if (pass) rows.push({ key: 'pass', rank: pass.rank, of: pass.of, label: 'PASSING YARDS ALLOWED · PER GAME', val: pass.v.toFixed(1), sub: 'TEAM DEFENSE', who: who('QB'), f: 0 });
  if (rush) rows.push({ key: 'rush', rank: rush.rank, of: rush.of, label: 'RUSHING YARDS ALLOWED · PER GAME', val: rush.v.toFixed(1), sub: 'TEAM DEFENSE', who: who('RB'), f: 0 });
  rows.sort((a, b) => a.rank - b.rank);
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away + ' @ ' + g.home} note={day}>
      <MuTitle kicker={nfTeam(opp).nick + ' ALLOW / ' + nfTeam(side).nick + ' MATCHUP'} title="DEFENSE VS POSITION"
        sub="Touchdowns and yards allowed per game to each position, ranked among the league's defenses. Rank 1 allows the most." />
      <div className="muRows">
        {rows.map(r => (
          <div className={'muRow' + (r.rank > r.of - 6 ? ' tough' : '')} key={r.key}>
            <div className="muBadge" style={r.rank > 10 && r.rank <= r.of - 6 ? { background: '#56697a', color: '#fff' } : null}>{r.rank > r.of - 6 ? muOrd(r.of - r.rank + 1) + ' FEWEST' : muOrd(r.rank) + ' MOST'}</div>
            <div className="muRowMain"><b>{r.label}</b><span>{r.who}</span></div>
            <div className="muRowVal" style={{ width: 230 }}><b>{r.val}</b><span>{r.sub}</span></div>
          </div>
        ))}
        {!rows.length ? <div className="muCap" style={{ padding: 16 }}>NO DEFENSE DATA FOR {opp}</div> : null}
      </div>
    </MuSlide>
  );
}

// ---- slide 6 and 7: player tables ----
function NfTable({ DATA, team, cols }) {
  const T = nfTeam(team);
  const rows = nfPlayers(DATA, team).slice(0, 7);
  return (
    <div className="muPanel" style={{ '--n': cols.length, '--w': '54px' }}>
      <div className="muPanelHead"><NfLogo t={team} size={26} /><b>{team} {T.nick}</b></div>
      <div className="muTr muTh"><span /><span>PLAYER</span>{cols.map(c => <span key={c[0]}>{c[0]}</span>)}</div>
      {rows.map(p => (
        <div className="muTr" key={p.name}>
          <span className="muAv">{nfShot(p) ? <img src={nfShot(p)} alt="" /> : null}</span>
          <span className="muPl">{p.name}<em className="muSt nfPos">{p.pos}</em></span>
          {cols.map(c => <span key={c[0]}>{c[1](p)}</span>)}
        </div>
      ))}
      {!rows.length ? <div className="muCap" style={{ padding: '10px 14px' }}>NO RANKED PLAYERS ON THIS TEAM</div> : null}
    </div>
  );
}
const NF_COLS_P = [['ANY', p => nfPct(p.prob)], ['1ST', p => nfPct(p.prob_first)], ['2+', p => nfPct(p.prob_two)], ['SCORE', p => (p.score != null ? Math.round(p.score) : '–')]];
const NF_COLS_U = [['YDS/G', p => muF1(p.yds_pg)], ['RZ/G', p => muF1(p.rz_pg)], ['GL/G', p => muF1(p.gl_pg)], ['L5', p => (p.l5_gp ? p.l5_hits + '/' + p.l5_gp : '–')]];
function NfProjSlide({ DATA, g, idx, total, cols, title, sub, day }) {
  return (
    <MuSlide tag={'GAME ' + idx + ' / ' + total} sub={g.away + ' @ ' + g.home} note={day}>
      <MuTitle kicker="TOP 7 TOUCHDOWN PROBABILITIES PER TEAM" title={title} sub={sub} />
      <div className="muPanels">
        <NfTable DATA={DATA} team={g.away} cols={cols} />
        <NfTable DATA={DATA} team={g.home} cols={cols} />
      </div>
    </MuSlide>
  );
}

function NflMatchups({ DATA }) {
  const GM = DATA.games_model;
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const games = useMemo(() => {
    const list = ((GM && GM.games) || []).map(g => ({
      key: g.kick + '|' + g.away + '@' + g.home, g,
      top: { away: nfPlayers(DATA, g.away)[0] || null, home: nfPlayers(DATA, g.home)[0] || null },
    }));
    list.sort((a, b) => a.g.kick.localeCompare(b.g.kick));
    return list;
  }, [DATA]);
  const days = Array.from(new Set(games.map(x => x.g.kick)));
  if (!GM || !games.length) return <section className="view on"><h2 className="tsH">Matchups</h2><div className="dbNote">Waiting for the game model.</div></section>;
  const cur = day || days[0];
  const shown = games.filter(x => x.g.kick === cur);
  const sel = shown.find(x => x.key === pick) || shown[0];
  const idx = shown.indexOf(sel) + 1;
  const dLabel = nfDay(cur).toUpperCase();
  const g = sel.g;
  const bt = GM.meta && GM.meta.backtest;
  return (
    <section className="view on">
      <style>{MU_CSS + NF_CSS}</style>
      <h2 className="tsH">Matchups<span className="pill on">Week {GM.meta ? GM.meta.week : ''}</span></h2>
      <div className="muDays">
        {days.map(d => <button key={d} className={'pill' + (d === cur ? ' on' : '')} onClick={() => { setDay(d); setPick(null); }}>{nfDay(d)}</button>)}
      </div>
      <NfSlateSlide games={shown} cur={sel.key} day={dLabel} onPick={setPick} />
      <div className="muDays" style={{ marginTop: 14 }}>
        {shown.map(x => <button key={x.key} className={'pill' + (x.key === sel.key ? ' on' : '')} onClick={() => setPick(x.key)}>{x.g.away} @ {x.g.home}</button>)}
      </div>
      <NfGameSlide DATA={DATA} g={g} idx={idx} total={shown.length} day={dLabel} top={sel.top} />
      <NfEdgesSlide g={g} idx={idx} total={shown.length} day={dLabel} />
      <NfDvpSlide DATA={DATA} g={g} idx={idx} total={shown.length} side={g.away} opp={g.home} day={dLabel} />
      <NfDvpSlide DATA={DATA} g={g} idx={idx} total={shown.length} side={g.home} opp={g.away} day={dLabel} />
      <NfProjSlide DATA={DATA} g={g} idx={idx} total={shown.length} cols={NF_COLS_P} title="TOUCHDOWN PROBABILITIES" sub="Chance to score at least one touchdown, to score first, and to score two or more. Score is the board's 0 to 100 rating." day={dLabel} />
      <NfProjSlide DATA={DATA} g={g} idx={idx} total={shown.length} cols={NF_COLS_U} title="USAGE" sub="Yards per game, red zone and goal line touches per game, and touchdown games in the last five." day={dLabel} />
      <div className="dbNote" style={{ marginTop: 8 }}>
        Projected scores, spread and total come from the TransferSportal game model
        {bt ? ' (against the closing line it went ' + bt.ats + ' over ' + bt.games + ' games, break-even is ' + bt.ats_breakeven + ')' : ''}.
        Win probability is a normal curve on the projected margin with a fixed spread of 13 points, a rule of thumb that is not fit here.
        Allowances are per game over the games played so far this season. Players who are not active are left off the player tables.
      </div>
    </section>
  );
}

const NF_CSS = `
.nfChip{display:inline-flex;align-items:center;justify-content:center;background:#dfe3e8;border-radius:50%;padding:2px;flex:none;overflow:hidden}
.nfChip img{width:100%;height:100%;object-fit:contain;display:block}
.nfChip b{font-size:9px;color:#222;font-family:'IBM Plex Mono',monospace}
.nfScore{font-size:30px;line-height:1;letter-spacing:.5px}.nfScore i{font-style:normal;color:#6b7684;margin:0 4px}
.muSlate.nfCmp{top:150px;gap:8px}
.muSlate.nfCmp .muTile{padding:6px 12px;justify-content:center;gap:2px}
.muSlate.nfCmp .muTileTeam{font-size:24px;gap:6px}
.muSlate.nfCmp .nfScore{font-size:22px}
.muSlate.nfCmp .muTileTime{font-size:8px}
.nfEdges{position:absolute;left:30px;right:30px;top:178px;z-index:2}
.nfEdgeHead{display:grid;grid-template-columns:40px 1fr 190px 1fr 40px;gap:8px;font-size:22px;margin-bottom:4px}
.nfEdgeHead span:first-child{grid-column:1/3}.nfEdgeHead span:last-child{grid-column:4/6;text-align:right}
.nfEdge{display:grid;grid-template-columns:40px 1fr 190px 1fr 40px;gap:8px;align-items:center;height:40px;border-top:1px solid #16212b}
.nfEdge b{font-weight:400;font-size:24px;color:#9aa5b1;text-align:left}.nfEdge b:last-child{text-align:right}.nfEdge b.w{color:#4ade80}
.nfEdge span{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#cfd6de;text-align:center;letter-spacing:.4px}
.nfBarL,.nfBarR{height:12px;background:#121c26;border-radius:6px;overflow:hidden;display:flex}
.nfBarL{justify-content:flex-end}
.nfBarL i,.nfBarR i{display:block;height:100%;background:#56697a;border-radius:6px}
.nfBarL i.w,.nfBarR i.w{background:#22c55e}
.muRowVal span{white-space:nowrap}
.muSlate.nfSlate .muTile{justify-content:center;gap:16px}
.muSt.nfPos{background:#16222e;color:#8fa3b5}
`;
