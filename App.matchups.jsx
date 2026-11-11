// ============ NBA Matchups ============
//
// One panel per game on the slate, built only from TransferSportal's own data:
// DATA.nba.defense (opponent defense factors by position group), the top 100
// player projections in DATA.nba.players, and the injury flags in DATA.daily.
//
// Nothing here is a price and nothing is copied from another site. The defense
// numbers are the same factors the player model already uses, shown as a
// percent above or below the league average for that position and stat.

const MU_STATS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3', '3PM']];
const MU_POS = { G: 'guards', F: 'forwards', C: 'centers' };

function muOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Rank every team on every (position group, stat) so a card can say
// "3rd most 3PM to centers". Rank 1 is the most generous defense.
function muRanks(defense) {
  const teams = Object.keys(defense || {});
  const out = {};
  teams.forEach(t => { out[t] = []; });
  ['G', 'F', 'C'].forEach(g => {
    MU_STATS.forEach(([k, label]) => {
      const rows = teams
        .map(t => ({ t, f: defense[t] && defense[t][g] ? defense[t][g][k] : null }))
        .filter(r => r.f != null)
        .sort((a, b) => b.f - a.f);
      rows.forEach((r, i) => out[r.t].push({ g, k, label, f: r.f, rank: i + 1, of: rows.length }));
    });
  });
  return out;
}

function muStatus(p, flags) {
  const f = flags[p.name];
  if (f) return { text: f.status, note: f.note };
  if (p.injury && p.injury.status) return { text: p.injury.status, note: p.injury.comment };
  return null;
}
function muTone(s) {
  if (!s) return '';
  const t = s.toLowerCase();
  if (t.indexOf('out') === 0 || t.indexOf('doubtful') === 0) return 'r';
  return 'y';
}

function MuTeamCard({ team, opp, home, ranks, players, flags }) {
  const soft = ranks.filter(r => r.rank <= 8).sort((a, b) => a.rank - b.rank).slice(0, 4);
  const tough = ranks.filter(r => r.rank > r.of - 5).sort((a, b) => b.rank - a.rank).slice(0, 3);
  const pct = f => (f >= 1 ? '+' : '') + ((f - 1) * 100).toFixed(1) + '%';
  return (
    <div className="dbCard muCard">
      <h4><NbaTeam t={team} /> {home ? 'vs' : 'at'} {opp}</h4>
      <div className="muSub">{opp} defense, what it gives up to {team}</div>
      {soft.length ? soft.map((r, i) => (
        <div className="muDvp" key={'s' + i}>
          <span className="muRank good">{muOrdinal(r.rank)} most</span>
          <b>{r.label} to {MU_POS[r.g]}</b>
          <span className="dbNote">{pct(r.f)} vs average</span>
        </div>
      )) : <div className="dbNote">No soft spots, nothing in the league's top eight.</div>}
      {tough.map((r, i) => (
        <div className="muDvp" key={'t' + i}>
          <span className="muRank bad">{muOrdinal(r.of - r.rank + 1)} fewest</span>
          <b>{r.label} to {MU_POS[r.g]}</b>
          <span className="dbNote">{pct(r.f)} vs average</span>
        </div>
      ))}
      <div className="muSub" style={{ marginTop: 12 }}>{team} model projections, top 100 players only</div>
      {players.length ? (
        <div className="tbl muTbl">
          <table>
            <thead><tr><th style={{ textAlign: 'left' }}>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th><th>PRA</th></tr></thead>
            <tbody>
              {players.map(p => {
                const st = muStatus(p, flags);
                const pr = p.proj || {};
                const mn = p.windows && p.windows['10'] ? p.windows['10'].min : p.min_l10;
                const f1 = v => (v == null ? '–' : Number(v).toFixed(1));
                return (
                  <tr key={p.id || p.name}>
                    <td style={{ textAlign: 'left' }}>
                      <b>{p.name}</b> <span className="dbNote">{p.pos}</span>
                      {st ? <span className={'tag ' + muTone(st.text)} title={st.note || ''} style={{ marginLeft: 6 }}>{st.text}</span> : null}
                    </td>
                    <td>{f1(mn)}</td><td>{f1(pr.pts)}</td><td>{f1(pr.reb)}</td><td>{f1(pr.ast)}</td><td>{f1(pr.fg3)}</td><td>{f1(pr.pra)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="dbNote">No top 100 players on this team.</div>}
    </div>
  );
}

function NbaMatchups({ DATA }) {
  const N = DATA.nba;
  const [day, setDay] = useState(null);
  const ranks = useMemo(() => (N ? muRanks(N.defense) : {}), [N]);
  const flags = useMemo(() => {
    const m = {};
    (((DATA.daily || {}).nba || {}).flags || []).forEach(f => { m[f.player] = f; });
    return m;
  }, [DATA]);

  // Group the top 100 by game: one entry per team pairing and tip time.
  const { days, games } = useMemo(() => {
    const g = {};
    ((N && N.players) || []).forEach(p => {
      const nx = p.next;
      if (!nx || !nx.opp || !nx.date) return;
      const key = nx.date + '|' + [p.team, nx.opp].sort().join('@');
      if (!g[key]) g[key] = { key, date: nx.date, teams: {} };
      const t = g[key].teams;
      if (!t[p.team]) t[p.team] = { team: p.team, opp: nx.opp, home: nx.home, players: [] };
      t[p.team].players.push(p);
    });
    const list = Object.keys(g).map(k => g[k]).sort((a, b) => a.date.localeCompare(b.date));
    list.forEach(x => {
      // A game with players from one side only still shows both teams' defense.
      Object.keys(x.teams).forEach(tm => {
        const o = x.teams[tm].opp;
        if (!x.teams[o]) x.teams[o] = { team: o, opp: tm, home: !x.teams[tm].home, players: [] };
      });
    });
    const d = Array.from(new Set(list.map(x => nbaDayKey(x.date)))).sort();
    return { days: d, games: list };
  }, [N]);

  if (!N) return <section className="view on"><h2 className="tsH">Matchups</h2><div className="dbNote">Waiting for NBA data.</div></section>;
  const cur = day || days[0];
  const shown = games.filter(x => nbaDayKey(x.date) === cur);
  return (
    <section className="view on">
      <style>{MU_CSS}</style>
      <h2 className="tsH">Matchups<span className="pill on">{cur}</span></h2>
      <div className="dbNote" style={{ marginBottom: 10 }}>
        Our own defense-by-position factors and player projections for each game. Projections, not prices. A tag on a player is the latest injury flag, so check it before trusting that row.
      </div>
      <div className="muDays">
        {days.map(d => <button key={d} className={'pill' + (d === cur ? ' on' : '')} onClick={() => setDay(d)}>{d}</button>)}
      </div>
      {shown.map(x => {
        const ts = Object.keys(x.teams).map(k => x.teams[k]).sort((a, b) => (a.home ? 1 : 0) - (b.home ? 1 : 0));
        const away = ts.find(t => !t.home) || ts[0];
        const hm = ts.find(t => t.home) || ts[1];
        return (
          <div key={x.key} style={{ marginBottom: 18 }}>
            <div className="muGame">{away.team} at {hm.team}<span className="dbNote"> · {nbaDay(x.date)} ET</span></div>
            <div className="dbGrid">
              {[away, hm].map(t => (
                <MuTeamCard key={t.team} team={t.team} opp={t.opp} home={t.home}
                  ranks={ranks[t.opp] || []} players={t.players.slice().sort((a, b) => a.rank - b.rank)} flags={flags} />
              ))}
            </div>
          </div>
        );
      })}
      {!shown.length ? <div className="dbNote">No games listed for this day.</div> : null}
    </section>
  );
}

const MU_CSS = `
.muGame{font-size:15px;font-weight:700;margin:4px 0 8px}
.muDays{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.muDays button{appearance:none;background:var(--card);cursor:pointer;font-family:inherit}
.muCard h4{display:flex;align-items:center;gap:8px}
.muSub{font-size:11px;color:var(--ink2);margin:0 0 6px}
.muDvp{display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line2);font-size:13px;flex-wrap:wrap}
.muDvp:first-of-type{border-top:none}
.muRank{font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;min-width:64px;text-align:center}
.muRank.good{background:var(--posBg);color:var(--pos);border:1px solid var(--posLine)}
.muRank.bad{background:var(--negBg);color:#fca5a5;border:1px solid var(--negLine)}
.muTbl th,.muTbl td{font-size:12px;padding:6px 6px;text-align:right;white-space:nowrap}
.muTbl th{color:var(--ink2);font-weight:600}
.tsFrame .tag.y{color:#fde68a;border-color:#6b5a1c}
`;
