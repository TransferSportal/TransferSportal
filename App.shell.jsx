// ============ Shell: two main tabs (NFL, NBA), one sidebar under each ============
function SegBar({ items, v, set }) {
  return (
    <div className="seg">
      {items.map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}
    </div>
  );
}
function LineCheck({ c }) {
  const [v, setV] = useState('');
  if (!c.log || c.log.length < 10) return null;
  const L = parseFloat(v);
  const ok = !isNaN(L);
  let out = null;
  if (ok) {
    const over = c.side === 'over';
    const hit = a => a.filter(x => (over ? x > L : x < L)).length;
    const l10 = c.log.slice(-10), l20 = c.log;
    const h10 = hit(l10), h20 = hit(l20);
    const sd = Math.max(c.sd10 || 1, 1);
    const z = (over ? c.proj - L : L - c.proj) / sd;
    const play = z >= 0.5 && h10 >= 7;
    const lean = !play && z >= 0.3 && h10 >= 6;
    out = (
      <div className="lcOut">
        <span className={'lcTag ' + (play ? 'p' : lean ? 'l' : 'x')}>{play ? 'Still a play' : lean ? 'Lean only' : 'Pass'}</span>
        <span>At {L}: {c.side} in {h10}/10 and {h20}/{l20.length}. Model {c.proj}, gap {z.toFixed(2)} swings.</span>
      </div>
    );
  }
  return (
    <div className="lcBox" onClick={e => e.stopPropagation()}>
      <label>Your book line</label>
      <input type="number" step="0.5" inputMode="decimal" placeholder={String(c.line)} value={v} onChange={e => setV(e.target.value)} />
      <span className="dk" style={{ margin: 0 }}>Type the FanDuel number for {c.stat}. It re-checks this pick at that line.</span>
      {out}
    </div>
  );
}
function DailyBoard({ DATA, meta, go }) {
  const D = DATA.daily || {};
  const nfl = D.nfl || {};
  const flags = nfl.flags || [];
  const P = DATA.nba_picks || {};
  const hist = (P.history || [])[0];
  const card = P.card;
  const top5 = (DATA.players || []).filter(p => p.prob != null && !p.out_reason).sort((a, b) => b.prob - a.prob).slice(0, 5);
  const day = D.date ? new Date(D.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const res = r => r === 'win' ? 'W' : r === 'loss' ? 'L' : r === 'void' ? 'V' : '...';
  const pct = v => Math.round(v * 100) + '%';
  return (
    <section className="view on">
      <h2 className="tsH">Daily board{day ? <span className="pill on">{day}</span> : null}</h2>
      <div className="dbGrid">
        <div className="dbCard">
          <h4>NFL injury watch</h4>
          {flags.length ? flags.map((f, i) => (
            <div className="dbRow" key={i}><b>{f.player}</b><span className="tag r">{f.status}</span><span className="dbNote">{f.team}{f.note ? ' · ' + f.note : ''}</span></div>
          )) : <div className="dbNote">No injury flags posted yet. This updates every morning.</div>}
          {nfl.notes ? <div className="dbNote" style={{ marginTop: 8 }}>{nfl.notes}</div> : null}
        </div>
        <div className="dbCard">
          <h4>Top 5 touchdown chances, {meta.predict_week}</h4>
          {top5.map((p, i) => (
            <div className="dbRow" key={p.name}><span className="dbNote">{i + 1}</span><b>{p.name}</b><span className="dbNote">{p.pos} · {p.team} vs {p.next_opp}</span><span className="dbPct">{pct(p.prob)}</span></div>
          ))}
        </div>
        <div className="dbCard">
          <h4>NBA today</h4>
          {card && card.picks && card.picks.length ? card.picks.map((c, i) => (
            <div className="dbRow" key={i}><b>{c.name}</b><span className="dbNote">{c.side} {c.line} {c.stat}</span><span className="dbNote">{c.team} vs {c.opp}</span></div>
          )) : <div className="dbNote">The Best 5 locks at 4 PM Eastern, after the injury check. Nothing yet, or nothing cleared the bar.</div>}
          <button className="dbLink" onClick={() => go('nba')}>Open NBA</button>
        </div>
        <div className="dbCard">
          <h4>NBA yesterday{hist ? ' · ' + hist.date : ''}</h4>
          {hist ? hist.picks.map((c, i) => (
            <div className="dbRow" key={i}><b>{c.name}</b><span className="dbNote">{c.side} {c.line} {c.stat}{c.actual != null ? ' · got ' + c.actual : ''}</span><span className={'dbRes ' + (c.result || '')}>{res(c.result)}</span></div>
          )) : <div className="dbNote">Nothing graded yet.</div>}
          {P.record ? <div className="dbNote" style={{ marginTop: 8 }}>Record {P.record.w}-{P.record.l}{P.record.v ? '-' + P.record.v : ''}. Lines are the model's own, not sportsbook lines.</div> : null}
        </div>
      </div>
    </section>
  );
}
function Shell({ DATA, meta, CURVE, CALP, CAL, CALPP, CALP2 }) {
  const [top, setTop] = useState('nfl');
  const [sec, setSec] = useState('today');
  const [stats, setStats] = useState('games');
  const [tools, setTools] = useState('sheets');
  const [nsec, setNsec] = useState('picks');
  const lr = meta.live_record && meta.live_record.totals;
  const P = DATA.nba_picks;
  const rec = P && P.record && (P.record.w + P.record.l) ? P.record.w + '-' + P.record.l : null;
  const nflSecs = [['today', 'Daily board'], ['board', 'Anytime TD'], ['card', 'The Card'], ['stats', 'Games & Stats'], ['tools', 'Tools'], ['inj', 'Injuries'], ['about', 'About the model'], ['preds', 'Game picks (ML & spread)']];
  const nbaSecs = [['picks', 'Best 5 today'], ['record', 'Pick record' + (rec ? ' · ' + rec : '')], ['all', 'All 100 players'], ['gpred', 'Game picks (ML & spread)']];
  const secs = top === 'nfl' ? nflSecs : nbaSecs;
  const cur = top === 'nfl' ? sec : nsec;
  const setCur = top === 'nfl' ? setSec : setNsec;
  const GRP = top === 'ncaa' ? [['Games', [['ncaa', 'Top 25 games']]]] : top === 'nfl' ? [
    ['Today', [['today', 'Daily board']]],
    ['Picks', [['best', 'Best Bets'], ['board', 'Anytime TD'], ['card', 'The Card'], ['preds', 'Game picks (ML & spread)'], ['mine', 'My game picks']]],
    ['Games', [['slides', 'Matchups'], ['stats:matchups', 'Matchup table'], ['stats:games', 'Game stats'], ['dvp', 'Defense vs Position'], ['stats:team', 'Team stats']]],
    ['Players', [['research', 'Research Center'], ['stats:players', 'Player stats'], ['tools:sheets', 'Cheatsheets'], ['tools:pairs', 'Parlay builder'], ['tools:full', 'Full board + prices']]],
    ['News', [['news', 'Injuries & news'], ['inj', 'Injuries']]],
    ['Bankroll', [['bank', 'Bankroll']]],
    ['About', [['about', 'About the model']]],
  ] : [
    ['Picks', [['picks', 'Best 5 today'], ['record', 'Pick record' + (rec ? ' · ' + rec : '')], ['gpred', 'Game picks (ML & spread)']]],
    ['Games', [['matchups', 'Matchups'], ['dvp', 'Defense vs Position']]],
    ['Players', [['research', 'Research Center'], ['all', 'All 100 players']]],
    ['News', [['news', 'Injuries & news']]],
    ['Bankroll', [['bank', 'Bankroll']]],
  ];
  const curKey = top === 'nfl' ? (sec === 'stats' ? 'stats:' + stats : sec === 'tools' ? 'tools:' + tools : sec) : top === 'ncaa' ? 'ncaa' : nsec;
  const goKey = k => { if (top === 'ncaa') return; if (top === 'nba') { setNsec(k); return; } const [a, b] = k.split(':'); setSec(a); if (a === 'stats') setStats(b); if (a === 'tools') setTools(b); };
  const grp = GRP.find(g => g[1].some(x => x[0] === curKey)) || GRP[0];
  return (
    <>
      <style>{BOARD_CSS}</style>
      <div className="tsTop">
        <div className="brand"><img src={LOGO} alt="" />TransferSportal</div>
        <div className="main">
          <button className={top === 'nfl' ? 'on' : ''} onClick={() => setTop('nfl')}>NFL</button>
          <button className={top === 'nba' ? 'on' : ''} onClick={() => setTop('nba')}>NBA</button>
          <button className={top === 'ncaa' ? 'on' : ''} onClick={() => setTop('ncaa')}>NCAAB</button>
        </div>
        <div className="stat">
          {top === 'nfl'
            ? <>{lr && lr.top12_of ? <>Live top 12: <b>{lr.top12}/{lr.top12_of}</b> · </> : null}Through week {meta.weeks_played}</>
            : top === 'ncaa' ? <>AP Top 25 · {((DATA.ncaa && DATA.ncaa.games) || []).length} games on the board</>
            : <>{rec ? <>Best 5 record: <b>{rec}</b> · </> : null}ESPN data</>}
        </div>
      </div>
      <div className="tsFrame">
        <div className="bd">
          <aside className="sb">
            <h6>{top === 'nfl' ? 'NFL · ' + (meta.predict_week || '') : top === 'ncaa' ? 'NCAA basketball' : 'NBA'}</h6>
            {GRP.map(([name, items]) => <button key={name} className={grp[0] === name ? 'on' : ''} onClick={() => goKey(items[0][0])}>{name}</button>)}
            <div className="live">{meta.generated}<br />Model estimates, not guarantees</div>
          </aside>
          <div className="mn">
            {grp[1].length > 1 && <SegBar v={curKey} set={goKey} items={grp[1]} />}
            {top === 'nfl' && sec === 'today' && <DailyBoard DATA={DATA} meta={meta} go={setTop} />}
            {top === 'nfl' && sec === 'board' && <BoardTab DATA={DATA} />}
            {top === 'nfl' && sec === 'card' && <CardTab DATA={DATA} />}
            {top === 'nfl' && sec === 'stats' && (<>
              {stats === 'games' && <GamesTab GAMES={DATA.games_model} DATA={DATA} />}
              {stats === 'matchups' && <MatchupsTab DATA={DATA} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />}
              {stats === 'team' && <TeamStatsTab DATA={DATA} />}
              {stats === 'players' && <PlayerStatsTab DATA={DATA} />}
            </>)}
            {top === 'nfl' && sec === 'tools' && (<>
              {tools === 'sheets' && <CheatsheetsTab DATA={DATA} />}
              {tools === 'pairs' && <ParlayTab DATA={DATA} />}
              {tools === 'full' && (<>
                <CalibrationNote DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
                <Alerts DATA={DATA} />
                <PredictionsTab DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
              </>)}
            </>)}
            {top === 'nfl' && sec === 'best' && <NflBestBets DATA={DATA} />}
            {top === 'nfl' && sec === 'inj' && <InjuriesTab DATA={DATA} />}
            {top === 'nfl' && sec === 'about' && <Notes meta={meta} />}
            {top === 'nfl' && sec === 'preds' && <GamePreds sport="nfl" DATA={DATA} />}
            {top === 'nba' && <NbaTab DATA={DATA} view={nsec} noBar />}
            {top === 'ncaa' && <NcaaTab DATA={DATA} />}
          </div>
        </div>
      </div>
    </>
  );
}
