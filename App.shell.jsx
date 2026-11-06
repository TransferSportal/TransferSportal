// ============ Shell: two main tabs (NFL, NBA), one sidebar under each ============
function SegBar({ items, v, set }) {
  return (
    <div className="seg">
      {items.map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}
    </div>
  );
}
function Shell({ DATA, meta, CURVE, CALP, CAL, CALPP, CALP2 }) {
  const [top, setTop] = useState('nfl');
  const [sec, setSec] = useState('board');
  const [stats, setStats] = useState('games');
  const [tools, setTools] = useState('sheets');
  const [nsec, setNsec] = useState('picks');
  const lr = meta.live_record && meta.live_record.totals;
  const P = DATA.nba_picks;
  const rec = P && P.record && (P.record.w + P.record.l) ? P.record.w + '-' + P.record.l : null;
  const nflSecs = [['board', 'Anytime TD'], ['card', 'The Card'], ['stats', 'Games & Stats'], ['tools', 'Tools'], ['inj', 'Injuries'], ['about', 'About the model']];
  const nbaSecs = [['picks', 'Best 5 today'], ['record', 'Pick record' + (rec ? ' · ' + rec : '')], ['all', 'All 100 players']];
  const secs = top === 'nfl' ? nflSecs : nbaSecs;
  const cur = top === 'nfl' ? sec : nsec;
  const setCur = top === 'nfl' ? setSec : setNsec;
  return (
    <>
      <style>{BOARD_CSS}</style>
      <div className="tsTop">
        <div className="brand"><img src={LOGO} alt="" />TransferSportal</div>
        <div className="main">
          <button className={top === 'nfl' ? 'on' : ''} onClick={() => setTop('nfl')}>NFL</button>
          <button className={top === 'nba' ? 'on' : ''} onClick={() => setTop('nba')}>NBA</button>
        </div>
        <div className="stat">
          {top === 'nfl'
            ? <>{lr && lr.top12_of ? <>Live top 12: <b>{lr.top12}/{lr.top12_of}</b> · </> : null}Through week {meta.weeks_played}</>
            : <>{rec ? <>Best 5 record: <b>{rec}</b> · </> : null}ESPN data</>}
        </div>
      </div>
      <div className="tsFrame">
        <div className="bd">
          <aside className="sb">
            <h6>{top === 'nfl' ? 'NFL · ' + (meta.predict_week || '') : 'NBA'}</h6>
            {secs.map(([k, l]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => setCur(k)}>{l}</button>)}
            <div className="live">{meta.generated}<br />Model estimates, not guarantees</div>
          </aside>
          <div className="mn">
            {top === 'nfl' && sec === 'board' && <BoardTab DATA={DATA} />}
            {top === 'nfl' && sec === 'card' && <CardTab DATA={DATA} />}
            {top === 'nfl' && sec === 'stats' && (<>
              <SegBar v={stats} set={setStats} items={[['games', 'Games'], ['matchups', 'Matchups'], ['team', 'Team stats'], ['players', 'Player stats']]} />
              {stats === 'games' && <GamesTab GAMES={DATA.games_model} DATA={DATA} />}
              {stats === 'matchups' && <MatchupsTab DATA={DATA} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />}
              {stats === 'team' && <TeamStatsTab DATA={DATA} />}
              {stats === 'players' && <PlayerStatsTab DATA={DATA} />}
            </>)}
            {top === 'nfl' && sec === 'tools' && (<>
              <SegBar v={tools} set={setTools} items={[['sheets', 'Cheatsheets'], ['pairs', 'Parlay builder'], ['full', 'Full board + prices']]} />
              {tools === 'sheets' && <CheatsheetsTab DATA={DATA} />}
              {tools === 'pairs' && <ParlayTab DATA={DATA} />}
              {tools === 'full' && (<>
                <CalibrationNote DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
                <Alerts DATA={DATA} />
                <PredictionsTab DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
              </>)}
            </>)}
            {top === 'nfl' && sec === 'inj' && <InjuriesTab DATA={DATA} />}
            {top === 'nfl' && sec === 'about' && <Notes meta={meta} />}
            {top === 'nba' && <NbaTab DATA={DATA} view={nsec} noBar />}
          </div>
        </div>
      </div>
    </>
  );
}
