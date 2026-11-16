// ===== Game predictions: moneyline and spread for every NFL and NBA game =====
// Reads what the game models already produce (DATA.games_model for the NFL, DATA.nba_games for the NBA).
// Nothing new is fitted here: the winner, win chance and margin are the models' own numbers, the fair
// moneyline is just the win chance written as American odds, and the spread pick is the model margin
// against the book's number.
const GP_CSS = `
.gp .gpNote{font-size:12.5px;color:var(--ink2);line-height:1.5;margin:0 0 12px}
.gp .gpDay{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--ink2);margin:16px 0 6px}
.gp .gpRow{display:grid;grid-template-columns:minmax(150px,1.3fr) 1fr 1fr 1fr;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
.gp .gpTeams{font-size:15px;font-weight:800}
.gp .gpTeams small{display:block;font-size:11.5px;font-weight:600;color:var(--ink2);margin-top:3px}
.gp .gpK{font-size:10px;letter-spacing:1.1px;text-transform:uppercase;font-weight:800;color:var(--ink2);margin-bottom:3px}
.gp .gpV{font-size:14px;font-weight:800}
.gp .gpS{font-size:11.5px;color:var(--ink2);margin-top:2px}
.gp .gpBar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px;display:flex}
.gp .gpBar i{display:block;height:100%;background:var(--pos)}
.gp .gpTag{display:inline-block;font-size:10.5px;font-weight:800;border-radius:6px;padding:1px 7px;margin-left:6px;border:1px solid var(--line2);color:var(--ink2)}
.gp .gpTag.on{color:var(--pos);border-color:var(--pos)}
@media(max-width:760px){.gp .gpRow{grid-template-columns:1fr 1fr}.gp .gpTeams{grid-column:1/-1}}
`;
function gpAm(p) { if (!(p > 0 && p < 1)) return '--'; const v = p >= 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p); return (v > 0 ? '+' : '') + v; }
function gpPhi(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - q : q; }
function gpSp(n) { return (n > 0 ? '+' : '') + (Math.round(n * 10) / 10).toFixed(1); }
function gpEt(d) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d || new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function gpNfl(DATA) {
  const G = (DATA.games_model && DATA.games_model.games) || [];
  const today = gpEt();
  const rows = G.filter(g => g.kick >= today).map(g => {
    const hm = Number(g.proj_spread) || 0;                 // model margin, home minus away
    const ph = gpPhi(hm / 13.5);
    const win = hm >= 0 ? g.home : g.away, pw = hm >= 0 ? ph : 1 - ph;
    return { day: g.kick, away: g.away, home: g.home, win, pw, margin: Math.abs(hm), proj: g.proj_away + '-' + g.proj_home + ' (' + g.away + '-' + g.home + ')',
      mkt: g.spread_line, mktTxt: g.spread_line == null ? null : (g.spread_line >= 0 ? g.home + ' -' + Math.abs(g.spread_line) : g.away + ' -' + Math.abs(g.spread_line)),
      ats: g.ats_pick, atsDiff: g.spread_diff, ou: g.ou_pick, total: g.proj_total, totalLine: g.total_line, hm };
  });
  return rows;
}
function gpNba(DATA) {
  const G = (DATA.nba_games && DATA.nba_games.games) || [];
  return G.map(g => {
    const hm = Number(g.margin) || 0;
    const win = hm >= 0 ? g.home : g.away, pw = hm >= 0 ? g.win.home : g.win.away;
    let ats = null, atsP = null;
    if (g.line && g.line.spread != null && g.line.fav_covers != null) {
      const dog = g.line.fav === g.home ? g.away : g.home;
      if (g.line.fav_covers >= 0.5) { ats = g.line.fav + ' -' + g.line.spread; atsP = g.line.fav_covers; }
      else { ats = dog + ' +' + g.line.spread; atsP = 1 - g.line.fav_covers; }
    }
    return { day: g.day, away: g.away, home: g.home, win, pw, margin: Math.abs(hm), proj: g.proj.away + '-' + g.proj.home + ' (' + g.away + '-' + g.home + ')',
      mktTxt: g.line && g.line.spread != null ? g.line.fav + ' -' + g.line.spread : null,
      ats, atsP, ou: g.line && g.line.under != null ? (g.line.under >= 0.5 ? 'Under' : 'Over') : null, ouP: g.line && g.line.under != null ? Math.max(g.line.under, 1 - g.line.under) : null,
      total: g.total, totalLine: g.line && g.line.total, hm, out: g.out };
  });
}
function GamePreds({ sport, DATA }) {
  const rows = useMemo(() => sport === 'nfl' ? gpNfl(DATA) : gpNba(DATA), [sport, DATA]);
  const days = [];
  rows.forEach(r => { let d = days.find(x => x.day === r.day); if (!d) days.push(d = { day: r.day, list: [] }); d.list.push(r); });
  days.sort((a, b) => a.day < b.day ? -1 : 1);
  const fmtDay = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); } catch (e) { return d; } };
  const bt = sport === 'nba' ? (DATA.nba_games && DATA.nba_games.backtest) : null;
  const gm = sport === 'nfl' && DATA.games_model && DATA.games_model.meta && DATA.games_model.meta.backtest;
  return (
    <div className="gp">
      <style>{GP_CSS}</style>
      <h3 style={{ margin: '0 0 6px' }}>{sport === 'nfl' ? 'NFL' : 'NBA'} game predictions</h3>
      <p className="gpNote">
        The model's pick for who wins, its win chance and the moneyline that chance is worth (a fair price, so a book price longer than this is the value side), then the
        projected score and margin against the book's spread and total.
        {bt ? <> Back-tested winners: <b>{bt.winner_pct}%</b> over {bt.games} games, typical margin miss {bt.margin_mae} points.</> : null}
        {gm ? <> Against the spread the model is <b>{gm.ats}</b>.</> : null}
        {' '}Model estimates, not guarantees.
      </p>
      {!days.length && <div className="empty">No upcoming games in this build.</div>}
      {days.map(d => (
        <div key={d.day}>
          <div className="gpDay">{fmtDay(d.day)}</div>
          {d.list.map((r, i) => (
            <div className="gpRow" key={d.day + r.away + r.home + i}>
              <div className="gpTeams">{r.away} @ {r.home}<small>Projected {r.proj}</small></div>
              <div>
                <div className="gpK">Moneyline</div>
                <div className="gpV">{r.win} {gpAm(r.pw)}</div>
                <div className="gpS">{Math.round(r.pw * 100)}% to win</div>
                <div className="gpBar"><i style={{ width: Math.round(r.pw * 100) + '%' }} /></div>
              </div>
              <div>
                <div className="gpK">Spread</div>
                <div className="gpV">{r.win} -{(Math.round(r.margin * 10) / 10).toFixed(1)}</div>
                <div className="gpS">{r.mktTxt ? 'Book ' + r.mktTxt : 'No book line yet'}</div>
                {r.ats && <div className="gpS">Pick <b>{r.ats}</b>{r.atsP ? ' (' + Math.round(r.atsP * 100) + '% to cover)' : ''}</div>}
              </div>
              <div>
                <div className="gpK">Total</div>
                <div className="gpV">{Math.round(r.total * 10) / 10}</div>
                <div className="gpS">{r.totalLine != null ? 'Book ' + r.totalLine : 'No book line yet'}</div>
                {r.ou && r.totalLine != null && <div className="gpS">Lean <b>{r.ou}</b>{r.ouP ? ' (' + Math.round(r.ouP * 100) + '%)' : ''}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
