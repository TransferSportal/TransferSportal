// ============ NBA Defense vs Position ============
//
// What the top players at each position group average against each defense, from the
// per game allowances nba_model.py builds (DATA.nba_games.allow). Values are pulled toward
// the league average when a team has few games against a group, so a thin sample cannot
// make a defense look softer or tougher than it is. Rank 1 is the softest defense.
// Green is soft, red is tough. Each row also shows the team's next game.

const NDVP_COLS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3', '3PM'], ['pra', 'PRA']];
const NDVP_GRP = [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']];

function NbaDvp({ DATA }) {
  const G = DATA.nba_games;
  const A = G && G.allow && G.allow.teams ? G.allow : null;
  const [grp, setGrp] = useState('G');
  const [sk, setSk] = useState('team');
  const [desc, setDesc] = useState(false);
  if (!A) {
    return (
      <section className="view on">
        <h2 className="tsH">Defense vs Position</h2>
        <div className="empty">Waiting for the allowance build. It fills in on the next daily run.</div>
      </section>
    );
  }
  const val = (t, k) => {
    const x = A.teams[t] && A.teams[t][grp];
    if (!x) return null;
    if (k === 'pra') return x.pts != null && x.reb != null && x.ast != null ? x.pts + x.reb + x.ast : null;
    return x[k] != null ? x[k] : null;
  };
  const teams = Object.keys(A.teams).filter(t => MU_TEAMS[t] && val(t, 'pts') != null);
  const n = teams.length;
  const rank = {};
  NDVP_COLS.forEach(([k]) => {
    const s = teams.slice().sort((a, b) => val(b, k) - val(a, k));
    rank[k] = {};
    s.forEach((t, i) => { rank[k][t] = i + 1; });
  });
  const lg = k => {
    const L = A.league && A.league[grp];
    if (!L) return null;
    return k === 'pra' ? L.pts + L.reb + L.ast : L[k];
  };
  // each team's next game: the earliest day on the schedule
  const games = (G.games || []).slice();
  const day = games.length ? games.map(g => g.day).sort()[0] : null;
  const nxt = {};
  games.filter(g => g.day === day).forEach(g => { nxt[g.home] = ['vs', g.away]; nxt[g.away] = ['@', g.home]; });
  const dayTxt = day ? new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const nick = t => (muTeam(t)[1] || t);
  const rows = teams.slice().sort((a, b) => {
    const r = sk === 'team' ? nick(a).localeCompare(nick(b)) : val(a, sk) - val(b, sk);
    return desc ? -r : r;
  });
  const pick = k => { if (k === sk) setDesc(!desc); else { setSk(k); setDesc(k !== 'team'); } };
  const arrow = k => (sk === k ? (desc ? ' ▼' : ' ▲') : '');
  const cols = { gridTemplateColumns: 'minmax(150px,1.5fr) repeat(5,minmax(70px,1fr))' };
  const gname = (NDVP_GRP.find(x => x[0] === grp) || [])[1];
  return (
    <section className="view on dvp">
      <style>{DVP_CSS}</style>
      <div className="dvpHead">
        <div>
          <h2 className="tsH" style={{ margin: 0 }}>Defense vs Position</h2>
          {dayTxt ? <div className="dvpWk">Games {dayTxt}</div> : null}
        </div>
        <div className="dvpKey">
          <div className="dvpBar" />
          <div className="dvpKeyL"><i>TOUGH</i><i>SOFT</i></div>
        </div>
      </div>
      <SegBar v={grp} set={setGrp} items={NDVP_GRP} />
      <div className="dvpScroll">
        <div className="dvpGrid">
          <div className="dvpRow" style={cols}>
            <div className={'dvpHd l' + (sk === 'team' ? ' on' : '')} onClick={() => pick('team')}>TEAM{arrow('team')}</div>
            {NDVP_COLS.map(([k, lab]) => <div key={k} className={'dvpHd' + (sk === k ? ' on' : '')} onClick={() => pick(k)}>{lab}{arrow(k)}</div>)}
          </div>
          {rows.map(t => (
            <div className="dvpRow" style={cols} key={t}>
              <div className="dvpTeam">
                <MuLogo t={t} size={30} />
                <div style={{ minWidth: 0 }}>
                  <b>{nick(t)}</b>
                  {nxt[t] ? <span className="o">{nxt[t][0]} {nxt[t][1]}</span> : <span className="o">&nbsp;</span>}
                </div>
              </div>
              {NDVP_COLS.map(([k]) => {
                const v = val(t, k), L = lg(k);
                return (
                  <div key={k} className="dvpCell" style={{ background: dvpColor(rank[k][t], n) }}
                    title={L ? (v >= L ? '+' : '') + ((v / L - 1) * 100).toFixed(1) + '% vs league average' : ''}>
                    <b>{v.toFixed(1)}</b>
                    <i>#{rank[k][t]}</i>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="dvpFoot">
        <span>Average per player game for the top {A.players_sampled} players, shown for {gname ? gname.toLowerCase() : ''}. Pulled toward the league average on thin samples. Rank 1 is the softest defense. Tap a column to sort.</span>
        <span>{dayTxt ? 'Next game under each team' : ''}</span>
      </div>
    </section>
  );
}
