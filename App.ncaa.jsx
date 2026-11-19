// ===== NCAA men's basketball: projected scores, spreads and moneyline picks for AP Top 25 games =====
// Everything here is read from DATA.ncaa, which ncaa.py writes on the daily run.
const NC_CSS = `
.nc .ncNote{font-size:12.5px;color:var(--ink2);line-height:1.5;margin:0 0 12px}
.nc .ncTabs{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap}
.nc .ncTabs button{font:inherit;font-size:12.5px;font-weight:800;padding:6px 12px;border-radius:999px;border:1px solid var(--line2);background:transparent;color:var(--ink2);cursor:pointer}
.nc .ncTabs button.on{color:var(--pos);border-color:var(--pos)}
.nc .ncDay{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--ink2);margin:16px 0 6px}
.nc .ncRow{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.nc .ncHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.nc .ncTeams{font-size:15px;font-weight:800;line-height:1.35}
.nc .ncTeams small{display:block;font-size:11.5px;font-weight:600;color:var(--ink2);margin-top:2px}
.nc .ncRk{font-size:11px;font-weight:800;color:var(--ink2);margin-right:4px}
.nc .ncConf{font-size:11px;font-weight:800;border-radius:6px;padding:2px 9px;border:1px solid var(--line2);color:var(--ink2);white-space:nowrap}
.nc .ncConf.High{color:var(--pos);border-color:var(--pos)}
.nc .ncConf.Medium{color:var(--ink);border-color:var(--ink2)}
.nc .ncGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:10px}
.nc .ncK{font-size:10px;letter-spacing:1.1px;text-transform:uppercase;font-weight:800;color:var(--ink2);margin-bottom:3px}
.nc .ncV{font-size:14px;font-weight:800}
.nc .ncS{font-size:11.5px;color:var(--ink2);margin-top:2px;line-height:1.4}
.nc .ncBar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px;display:flex}
.nc .ncBar i{display:block;height:100%;background:var(--pos)}
.nc .ncTag{display:inline-block;font-size:10.5px;font-weight:800;border-radius:6px;padding:1px 7px;margin-left:6px;border:1px solid var(--line2);color:var(--ink2)}
.nc .ncTag.on{color:var(--pos);border-color:var(--pos)}
.nc .ncFlag{font-size:11.5px;color:var(--ink2);margin-top:8px}
.nc .ncCtx{font-size:11.5px;color:var(--ink2);margin-top:8px;border-top:1px solid var(--line);padding-top:8px;line-height:1.5}
.nc table{width:100%;border-collapse:collapse;font-size:13px}
.nc th{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink2);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)}
.nc td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
.nc th:nth-child(2),.nc td:nth-child(2){text-align:left}
.nc th:first-child,.nc td:first-child{text-align:left;width:34px}
.nc ul{margin:6px 0 14px 18px;padding:0;font-size:13px;line-height:1.55;color:var(--ink2)}
.nc h4{font-size:13px;margin:16px 0 4px}
@media(max-width:760px){.nc .ncGrid{grid-template-columns:1fr 1fr}}
`;
function ncAm(a) { return a == null ? '--' : (a > 0 ? '+' : '') + a; }
function ncSp(n) { if (n == null) return '--'; const v = Math.round(n * 10) / 10; return v === 0 ? 'PK' : (v > 0 ? '+' : '') + v.toFixed(1); }
function ncPct(p) { return p == null ? '--' : Math.round(p * 100) + '%'; }
function ncDay(iso) {
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')); } catch (e) { return iso; }
}
function ncTime(tip) {
  try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(tip)) + ' ET'; } catch (e) { return ''; }
}
function NcTeam({ t }) { return <>{t.rank ? <span className="ncRk">#{t.rank}</span> : null}{t.name}</>; }
function NcGame({ g }) {
  const h = g.home, a = g.away, p = g.proj, pk = g.picks, mk = g.market;
  const live = g.state !== 'pre';
  const fav = p ? (p.margin >= 0 ? h : a) : null;
  const projTxt = p ? `${a.name} ${Math.round(p.away_pts)}, ${h.name} ${Math.round(p.home_pts)}` : null;
  const spreadModel = p ? (p.margin >= 0 ? `${h.name} -${Math.abs(p.margin).toFixed(1)}` : `${a.name} -${Math.abs(p.margin).toFixed(1)}`) : '--';
  const spreadBook = mk && mk.home_spread != null ? (mk.home_spread <= 0 ? `${h.name} ${ncSp(mk.home_spread)}` : `${a.name} ${ncSp(-mk.home_spread)}`) : null;
  const sp = pk && pk.spread, ml = pk && pk.ml, tot = pk && pk.total;
  const spSide = sp ? (sp.side === 'home' ? h : a) : null;
  const spLine = sp && mk ? (sp.side === 'home' ? mk.home_spread : -mk.home_spread) : null;
  const mlSide = ml ? (ml.side === 'home' ? h : a) : null;
  const pWin = p ? (p.margin >= 0 ? p.p_home : 1 - p.p_home) : null;
  return (
    <div className="ncRow">
      <div className="ncHead">
        <div className="ncTeams">
          <NcTeam t={a} /> <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>at</span> <NcTeam t={h} />
          <small>{live ? (g.score ? `${g.state === 'post' ? 'Final' : 'Live'}: ${a.name} ${g.score.away}, ${h.name} ${g.score.home}` : '') : ncTime(g.tip)}{g.neutral ? ' · neutral site' : ''}{g.venue ? ' · ' + g.venue : ''}</small>
        </div>
        {g.conf ? <span className={'ncConf ' + g.conf}>{g.conf} confidence</span> : null}
      </div>
      {p ? (
        <div className="ncGrid">
          <div>
            <div className="ncK">Projected score</div>
            <div className="ncV">{projTxt}</div>
            <div className="ncS">Total {p.total.toFixed(1)}{mk && mk.total != null ? ` (book ${mk.total})` : ''}{tot && tot.lean ? ` · lean ${tot.lean}` : ''}</div>
          </div>
          <div>
            <div className="ncK">Win chance</div>
            <div className="ncV">{fav.name} {ncPct(pWin)}</div>
            <div className="ncBar"><i style={{ width: Math.round(p.p_home * 100) + '%', background: 'var(--pos)' }} /></div>
            <div className="ncS">{a.name} {ncPct(1 - p.p_home)} · {h.name} {ncPct(p.p_home)}</div>
          </div>
          <div>
            <div className="ncK">Projected spread</div>
            <div className="ncV">{spreadModel}</div>
            <div className="ncS">{spreadBook ? `Book: ${spreadBook}` : 'No book line yet'}</div>
            {sp && spSide ? <div className="ncS">{sp.call === 'Pass' ? 'No spread edge' : <><b>{sp.call}: {spSide.name} {ncSp(spLine)}</b> <span className={'ncTag' + (sp.call === 'Pick' ? ' on' : '')}>{Math.abs(sp.gap).toFixed(1)} pt gap</span></>}</div> : null}
          </div>
          <div>
            <div className="ncK">Moneyline pick</div>
            {ml && mlSide ? (<>
              <div className="ncV">{ml.call === 'Pass' ? 'Pass' : mlSide.name + ' ' + ncAm(ml.price)}{ml.call !== 'Pass' ? <span className={'ncTag' + (ml.call === 'Pick' ? ' on' : '')}>{ml.call}</span> : null}</div>
              <div className="ncS">Model {ncPct(ml.p)} vs price {ncPct(ml.fair)} · edge {ml.edge >= 0 ? '+' : ''}{Math.round(ml.edge * 100)} pts</div>
              <div className="ncS">{ml.call === 'Pass' ? `Best side is ${mlSide.name}, but the edge is too small` : `Fair price ${ncAm(ml.side === 'home' ? p.fair_ml_home : p.fair_ml_away)}`}</div>
            </>) : (<>
              <div className="ncV">{fav.name}</div>
              <div className="ncS">Model winner. Fair price {ncAm(p.margin >= 0 ? p.fair_ml_home : p.fair_ml_away)}. No book moneyline yet.</div>
            </>)}
          </div>
        </div>
      ) : <div className="ncS" style={{ marginTop: 8 }}>No projection yet. Not enough games on one of these teams.</div>}
      {g.flags && g.flags.length ? <div className="ncFlag">Heads up: {g.flags.join(' · ')}</div> : null}
      <div className="ncCtx">
        {[a, h].map(t => (
          <div key={t.id}><b>{t.name}</b>: rating {ncSp(t.rating)} (offense {ncSp(t.off)}, defense {ncSp(t.def)}) · {t.n} games
            {t.ppg != null ? ` · ${t.ppg} ppg` : ''}{t.efg != null ? ` · eFG ${t.efg}%` : ''}{t.rest != null ? ` · ${t.rest} days rest` : ''}</div>
        ))}
      </div>
    </div>
  );
}
function NcRatings({ N }) {
  const T = N.teams || [];
  if (!T.length) return <p className="ncNote">No ratings yet.</p>;
  return (
    <div>
      <p className="ncNote">Offense and defense are points per game above or below an average Division I team after adjusting for who each team has played. Defense is positive when the team holds opponents under average. Rating is the two added together.</p>
      <table>
        <thead><tr><th>AP</th><th>Team</th><th>Games</th><th>Rating</th><th>Offense</th><th>Defense</th></tr></thead>
        <tbody>{T.map(t => <tr key={t.id}><td>{t.rank}</td><td>{t.name}</td><td>{t.n}</td><td><b>{ncSp(t.rating)}</b></td><td>{ncSp(t.off)}</td><td>{ncSp(t.def)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
function NcAbout({ N }) {
  const bt = N.backtest, m = N.model || {};
  return (
    <div>
      <h4>How the projection works</h4>
      <ul>
        <li>Every finished Division I game this season goes into one fit. Each team gets an offense number and a defense number, adjusted for the opponent, plus one home-court number for the sport ({m.hfa != null ? m.hfa.toFixed(1) : '3.5'} points right now).</li>
        <li>Teams with few games lean on their AP rank, so early season numbers do not swing wildly off one blowout. Margins past 22 points count for much less.</li>
        <li>The projected spread is the home team's expected points minus the road team's, plus a small rest adjustment. Win chance comes from that margin.</li>
        <li>The moneyline pick is the side whose win chance beats the book's price after the book's cut is removed. Spread picks compare the model margin to the DraftKings number.</li>
        <li>Confidence goes up with games played and the size of the moneyline edge. It goes down when the model and the book disagree by more than 8 points, because that is usually a missing injury or lineup note, not a real edge.</li>
      </ul>
      <h4>What it does not know</h4>
      <ul>
        <li>Injuries, suspensions and lineups. ESPN has no college injury feed, so a star sitting out does not show up. Check news before betting any pick.</li>
        <li>Scoring average and shooting are shown for context. They do not move the projection, because a few games are not enough to fit weights for them.</li>
        <li>Early season ratings are thin. Anything marked thin sample is mostly the poll talking.</li>
      </ul>
      <h4>Track record of the model</h4>
      {bt ? (
        <ul>
          <li>Walk-forward test: for each past day, the model was fit only on earlier games, then asked about that day's Top 25 games. {bt.games} games.</li>
          <li>Picked the winner {bt.su_pct}% of the time. Average miss on the margin was {bt.mae} points. Spread of misses {bt.sd} points, which is what the win chances use.</li>
        </ul>
      ) : <p className="ncNote">Not enough played games yet for a fair backtest. It fills in as the season goes.</p>}
      <p className="ncNote">Model estimates, not guarantees. Updated {N.generated}. {N.poll ? 'Poll: ' + N.poll + '.' : ''}</p>
    </div>
  );
}
function NcaaTab({ DATA }) {
  const N = DATA && DATA.ncaa;
  const [view, setView] = useState('games');
  const days = useMemo(() => {
    const out = {};
    ((N && N.games) || []).forEach(g => { (out[g.day] = out[g.day] || []).push(g); });
    return Object.keys(out).sort().map(d => [d, out[d]]);
  }, [N]);
  if (!N) return <div className="nc"><style>{NC_CSS}</style><p className="ncNote">The NCAA basketball board fills in after the next daily run.</p></div>;
  const picks = (N.games || []).filter(g => g.picks && ((g.picks.ml && g.picks.ml.call === 'Pick') || (g.picks.spread && g.picks.spread.call === 'Pick'))).length;
  return (
    <div className="nc">
      <style>{NC_CSS}</style>
      <div className="ncTabs">
        {[['games', 'Games'], ['ratings', 'Top 25 ratings'], ['about', 'About the model']].map(([k, n]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{n}</button>)}
      </div>
      {view === 'games' && (<>
        <p className="ncNote">Every game today and tomorrow with an AP Top 25 team. {N.games.length} games, {picks} with a pick. Projected score, spread, win chance and a moneyline call, each with a confidence level. No injury data, so check news first.</p>
        {days.length === 0 ? <p className="ncNote">No Top 25 games on the board today or tomorrow.</p> : days.map(([d, gs]) => (
          <div key={d}><div className="ncDay">{ncDay(d)}</div>{gs.map(g => <NcGame key={g.id} g={g} />)}</div>
        ))}
      </>)}
      {view === 'ratings' && <NcRatings N={N} />}
      {view === 'about' && <NcAbout N={N} />}
    </div>
  );
}
