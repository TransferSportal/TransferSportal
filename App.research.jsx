// ============ Player Research Center ============
// Pick any player, any prop, type the sportsbook line, get a verdict.
// Same rules as the Best 5 checker: the gap between the model and the line must be
// at least half a typical swing, and he must have gone that way in most of his last 10.
const RC_STATS = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3', 'Threes'], ['pra', 'Pts+Reb+Ast']];
const RC_CSS = `
.rc .rcTop{display:grid;grid-template-columns:260px 1fr;gap:14px}
.rc .rcList{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;max-height:560px}
.rc .rcList input{background:var(--sunk);border:none;border-bottom:1px solid var(--line);color:var(--ink);padding:10px 12px;font-size:13px;outline:none}
.rc .rcScroll{overflow-y:auto}
.rc .rcP{display:flex;justify-content:space-between;gap:8px;padding:9px 12px;border-top:1px solid var(--line2);font-size:13px;cursor:pointer;color:var(--ink2)}
.rc .rcP b{color:var(--ink);font-weight:600}
.rc .rcP:hover{background:var(--raise)}
.rc .rcP.on{background:#1b2a20;color:var(--pos)}
.rc .rcP.on b{color:var(--pos)}
.rc .rcTog{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
.rc .rcTog button{appearance:none;border:1px solid var(--line);background:var(--sunk);color:var(--ink2);border-radius:7px;font-size:11px;padding:4px 9px;cursor:pointer}
.rc .rcTog button.on{background:var(--ink);color:#0d0f12;border-color:var(--ink)}
.rc .rcMain{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;min-width:0}
.rc .rcHead{display:flex;gap:14px;align-items:center;margin-bottom:12px}
.rc .rcHead img{width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--sunk)}
.rc .rcName{font-size:20px;font-weight:700;letter-spacing:-.2px}
.rc .rcSub{font-size:12px;color:var(--ink2)}
.rc .rcStats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.rc .rcStats button{appearance:none;border:1px solid var(--line);background:var(--sunk);color:var(--ink2);border-radius:8px;font-size:13px;padding:7px 14px;cursor:pointer}
.rc .rcStats button.on{background:var(--ink);color:#0d0f12;border-color:var(--ink);font-weight:600}
.rc .rcLine{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.rc .rcLine input{width:110px;background:var(--sunk);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:10px 12px;font-size:20px;font-weight:700}
.rc .rcLine label{font-size:12px;color:var(--ink2)}
.rc .rcVerdict{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--sunk)}
.rc .rcVerdict.p{border-color:var(--posLine);background:var(--posBg)}
.rc .rcVerdict.l{border-color:#6b5a1e;background:rgba(251,191,36,.08)}
.rc .rcVerdict.x{border-color:var(--negLine);background:var(--negBg)}
.rc .rcV{font-size:22px;font-weight:800;letter-spacing:-.3px}
.rc .rcVerdict.p .rcV{color:var(--pos)}.rc .rcVerdict.l .rcV{color:#fbbf24}.rc .rcVerdict.x .rcV{color:var(--neg)}
.rc .rcWhy{font-size:13px;color:var(--ink2);margin-top:4px;line-height:1.5}
.rc .rcSides{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.rc .rcSide{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--ink2)}
.rc .rcSide.best{border-color:var(--ink)}
.rc .rcSide b{display:block;color:var(--ink);font-size:14px;margin-bottom:2px}
.rc .rcGames{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 12px}
.rc .rcG{min-width:34px;text-align:center;padding:5px 7px;border-radius:7px;font-size:12px;font-weight:600;background:var(--raise);color:var(--ink2)}
.rc .rcG.o{background:var(--posBg);color:var(--pos)}.rc .rcG.u{background:var(--negBg);color:var(--neg)}
.rc .rcFacts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.rc .rcF{border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--ink2)}
.rc .rcF b{display:block;color:var(--ink);font-size:14px;margin-top:2px}
.rc .rcEmpty{padding:50px 20px;text-align:center;color:var(--ink2);font-size:13px}
@media(max-width:860px){.rc .rcTop{grid-template-columns:1fr}.rc .rcList{max-height:260px}.rc .rcSides{grid-template-columns:1fr}}
`;
function rcEt(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } catch (e) { return ''; }
}
function rcSd(vals) {
  const a = vals.slice(-10);
  if (a.length < 3) return 1;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.max(Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length), 1);
}
function rcJudge(side, L, proj, sd, logs) {
  const over = side === 'over';
  const ok = x => (over ? x > L : x < L);
  const l10 = logs.slice(-10), l20 = logs;
  const h10 = l10.filter(ok).length, h20 = l20.filter(ok).length;
  const z = (over ? proj - L : L - proj) / sd;
  return { side, z, h10, n10: l10.length, h20, n20: l20.length };
}
function RcH2H({ p, N }) {
  const nx = p.next || {};
  if (!nx.opp) return null;
  const h = p.h2h || {};
  const dm = (N && N.defense) || {};
  const teams = Object.keys(dm);
  const d = dm[nx.opp] && dm[nx.opp][p.grp];
  const rank = st => {
    if (!d || d[st] == null) return null;
    const arr = teams.map(t => dm[t] && dm[t][p.grp] && dm[t][p.grp][st]).filter(x => x != null).sort((a, b) => b - a);
    return { r: arr.indexOf(d[st]) + 1, n: arr.length };
  };
  const sa = p.avg60 || {}, pj = p.proj || {};
  const STS = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3', 'Threes'], ['pra', 'Pts+Reb+Ast']];
  const f1 = x => (x == null ? '—' : Number(x).toFixed(1));
  return (
    <div className="h2h">
      <style>{`.h2h{margin-top:16px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--sunk)}
.h2h .h2hT{font-size:13px;font-weight:800;letter-spacing:.3px;margin-bottom:8px}
.h2h table{width:100%;border-collapse:collapse;font-size:12px}
.h2h th{position:static;text-align:right;font-size:10px;font-weight:600;color:var(--ink3);padding:4px 6px;border-bottom:1px solid var(--line);background:none;cursor:default}
.h2h td{text-align:right;padding:6px;border-bottom:1px solid var(--line2);color:var(--ink2);font-family:var(--num)}
.h2h th:first-child,.h2h td:first-child{text-align:left;color:var(--ink);font-family:var(--ui);font-weight:600}
.h2h .up{color:var(--pos);font-weight:700}.h2h .dn{color:var(--neg);font-weight:700}
.h2h .h2hN{font-size:11.5px;color:var(--ink2);margin-top:8px;line-height:1.5}`}</style>
      <div className="h2hT">HEAD TO HEAD vs {nx.opp}{nx.home ? ' (home)' : ' (away)'}</div>
      <table>
        <thead><tr><th>Stat</th><th>Season avg</th><th>vs {nx.opp}{h.n ? ' (' + h.n + ' g)' : ''}</th><th>Diff</th><th>Model</th><th>{nx.opp} defense vs {p.grp}</th></tr></thead>
        <tbody>
          {STS.map(([k, l]) => {
            const v = h.n ? h[k] : null, a = sa[k];
            const df = v != null && a != null ? v - a : null;
            const rk = rank(k);
            const f = d && d[k];
            return (
              <tr key={k}>
                <td>{l}</td><td>{f1(a)}</td><td>{f1(v)}</td>
                <td className={df == null ? '' : df > 0.4 ? 'up' : df < -0.4 ? 'dn' : ''}>{df == null ? '—' : (df > 0 ? '+' : '') + df.toFixed(1)}</td>
                <td>{f1(pj[k])}</td>
                <td>{f == null ? '—' : (f >= 1.03 ? 'Soft' : f <= 0.97 ? 'Tough' : 'Average') + ' ' + (f >= 1 ? '+' : '') + Math.round((f - 1) * 100) + '%' + (rk ? ' · #' + rk.r + '/' + rk.n : '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="h2hN">
        {h.n ? 'Last meetings: ' + (h.last || []).map(g => g.date + ' ' + g.pts + '/' + g.reb + '/' + g.ast).join('  ·  ') + ' (pts/reb/ast).' : 'No logged games against ' + nx.opp + '.'}
        {' '}Defense is how many more (+) or fewer (-) the team allows to {p.grp}s than the league average; #1 is the softest.
      </div>
    </div>
  );
}
function ResearchCenter({ DATA }) {
  const N = DATA.nba;
  const [today, setToday] = useState(true);
  const [q, setQ] = useState('');
  const [pid, setPid] = useState(null);
  const [stat, setStat] = useState('pts');
  const [line, setLine] = useState('');
  const players = (N && N.players) || [];
  const todayDate = (DATA.nba_picks && DATA.nba_picks.today) || rcEt(new Date().toISOString());
  const list = useMemo(() => {
    let l = players.filter(p => p.next && p.logs);
    if (today) l = l.filter(p => rcEt(p.next.date) === todayDate);
    if (q) { const ql = q.toLowerCase(); l = l.filter(p => (p.name + ' ' + p.team).toLowerCase().includes(ql)); }
    return l.sort((a, b) => a.name.localeCompare(b.name));
  }, [players, today, q, todayDate]);
  const p = players.find(x => x.id === pid);
  const L = parseFloat(line);
  const has = !isNaN(L);
  let body = <div className="rcEmpty">Pick a player on the left, choose a prop, then type the line you see on FanDuel.</div>;
  if (p) {
    const logs = (p.logs && p.logs[stat]) || [];
    const proj = p.proj && p.proj[stat];
    const sd = Math.max((p.sd10 && p.sd10[stat]) || 0, rcSd(logs));
    const nx = p.next || {};
    const tipped = nx.date && new Date(nx.date) <= new Date();
    const f = (p.factors && p.factors[stat]) || {};
    let v = null;
    if (has && proj != null && logs.length >= 10) {
      const o = rcJudge('over', L, proj, sd, logs), u = rcJudge('under', L, proj, sd, logs);
      const best = o.z >= u.z ? o : u;
      let play = best.z >= 0.5 && best.h10 >= 7;
      let lean = !play && best.z >= 0.3 && best.h10 >= 6;
      const notes = [];
      // Blowout risk: a big spread means starters can sit the fourth quarter. Overs get capped, unders are left alone.
      const sp = nx.spread, starter = (p.min_l10 || 0) >= 26;
      if (sp != null && sp >= 10 && starter) {
        if (best.side === 'over') {
          if (sp >= 15) { play = false; lean = false; notes.push('Blowout risk: spread is ' + sp + '. Starters often sit late, so this over is a pass.'); }
          else if (play) { play = false; lean = true; notes.push('Blowout risk: spread is ' + sp + '. Starters can sit the fourth quarter, so a Play is cut to a Lean.'); }
          else notes.push('Blowout risk: spread is ' + sp + '. Minutes could get cut late.');
        } else notes.push('Spread is ' + sp + '. A blowout helps this under.');
      }
      if (p.avail < 0.9) notes.push('Injury status is not clean (' + (p.injury ? (p.injury.status || p.injury) : 'questionable') + '). Confirm he plays before betting.');
      if (p.min_l10 && p.min_l10 < 22) notes.push('Only ' + p.min_l10 + ' minutes a game lately, so the volume is shaky.');
      if (nx.b2b) notes.push('Back to back. Minutes can drop.');
      if (p.teammates_out && p.teammates_out.length) notes.push('Teammates out: ' + p.teammates_out.join(', ') + '.');
      if (tipped) notes.push('This game has already started. Do not bet it pregame.');
      if (L === Math.floor(L)) notes.push('Whole number line, so an exact hit is a push.');
      const blocked = p.avail < 0.7 || tipped;
      const cls = blocked ? 'x' : play ? 'p' : lean ? 'l' : 'x';
      const word = blocked ? 'Pass' : play ? 'Play' : lean ? 'Lean' : 'Pass';
      const sideTxt = best.side === 'over' ? 'Over' : 'Under';
      let why;
      if (blocked) why = tipped ? 'The game already started.' : 'He is likely out. No bet.';
      else if (word === 'Pass') why = best.z < 0.3 ? 'The book has him right where the model does. No edge either way.' : sideTxt + ' ' + L + ' is only ' + best.h10 + ' of his last ' + best.n10 + '. Not enough to trust.';
      else why = sideTxt + ' ' + L + ': ' + best.h10 + ' of his last ' + best.n10 + ', ' + best.h20 + ' of ' + best.n20 + ' over 20. Model has him at ' + proj.toFixed(1) + ', ' + best.z.toFixed(2) + ' typical swings from the line.' + (word === 'Lean' ? ' Smaller edge, so size it small.' : '');
      v = { cls, word, sideTxt, why, notes, o, u, best, blocked };
    }
    body = (
      <>
        <div className="rcHead">
          <img src={p.headshot || ('https://a.espncdn.com/i/headshots/nba/players/full/' + p.id + '.png')} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
          <div>
            <div className="rcName">{p.name}</div>
            <div className="rcSub">{p.team} · {p.pos} · {nx.opp ? (nx.home ? 'vs ' : '@ ') + nx.opp : 'no game listed'}{nx.date ? ' · ' + new Date(nx.date).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : ''}</div>
          </div>
        </div>
        <div className="rcStats">{RC_STATS.map(([k, l]) => <button key={k} className={stat === k ? 'on' : ''} onClick={() => setStat(k)}>{l}</button>)}</div>
        <div className="rcLine">
          <input type="number" step="0.5" inputMode="decimal" placeholder="FanDuel line" value={line} onChange={e => setLine(e.target.value)} />
          <label>Type the number FanDuel shows for {RC_STATS.find(s => s[0] === stat)[1].toLowerCase()}.</label>
        </div>
        {v && (
          <>
            <div className={'rcVerdict ' + v.cls}>
              <div className="rcV">{v.word}{v.word !== 'Pass' ? ' · ' + v.sideTxt + ' ' + L : ''}</div>
              <div className="rcWhy">{v.why}</div>
              {v.notes.map((n, i) => <div className="rcWhy" key={i}>{n}</div>)}
            </div>
            <div className="rcSides">
              {[v.o, v.u].map(s => (
                <div key={s.side} className={'rcSide' + (s.side === v.best.side ? ' best' : '')}>
                  <b>{s.side === 'over' ? 'Over' : 'Under'} {L}</b>
                  Last 10: {s.h10}/{s.n10} · Last 20: {s.h20}/{s.n20}<br />
                  Model gap: {s.z.toFixed(2)} swings
                </div>
              ))}
            </div>
          </>
        )}
        {has && logs.length > 0 && (
          <>
            <div className="rcSub">Last {logs.length} games, oldest to newest. Green cleared {L}, red stayed under.</div>
            <div className="rcGames">{logs.map((x, i) => <span key={i} className={'rcG ' + (x > L ? 'o' : x < L ? 'u' : '')}>{x}</span>)}</div>
          </>
        )}
        {!has && logs.length > 0 && <><div className="rcSub">Last {logs.length} games, oldest to newest.</div><div className="rcGames">{logs.map((x, i) => <span key={i} className="rcG">{x}</span>)}</div></>}
        <div className="rcFacts">
          <div className="rcF">Model tonight<b>{proj != null ? proj.toFixed(1) : '—'}</b></div>
          <div className="rcF">Season avg<b>{p.avg60 && p.avg60[stat] != null ? p.avg60[stat].toFixed(1) : '—'}</b></div>
          <div className="rcF">L5 / L10 avg<b>{p.windows && p.windows['5'] ? Number(p.windows['5'][stat]).toFixed(1) : '—'} / {p.windows && p.windows['10'] ? Number(p.windows['10'][stat]).toFixed(1) : '—'}</b></div>
          <div className="rcF">Typical swing<b>±{sd.toFixed(1)}</b></div>
          <div className="rcF">Rest<b>{nx.b2b ? 'Back to back' : (nx.rest_days != null ? nx.rest_days + (nx.rest_days === 1 ? ' day' : ' days') : '—')}</b></div>
          <div className="rcF">Opp defense<b>{f.def ? (f.def >= 1.03 ? 'Soft' : f.def <= 0.97 ? 'Tough' : 'Average') + ' (' + f.def.toFixed(2) + ')' : '—'}</b></div>
          <div className="rcF">Minutes L10<b>{p.min_l10 != null ? Number(p.min_l10).toFixed(1) : '—'}</b></div>
          <div className="rcF">Minutes trend<b>{(() => { const w = p.windows || {}, a = w['5'] && w['5'].min, c = w['10'] && w['10'].min, d = w['20'] && w['20'].min; if (a == null || c == null) return '—'; const pm = d != null ? 0.5 * a + 0.3 * c + 0.2 * d : 0.6 * a + 0.4 * c; return 'L5 ' + Number(a).toFixed(1) + ' · expect ' + pm.toFixed(0); })()}</b></div>
          <div className="rcF">Game line<b>{nx.spread != null ? (nx.fav ? nx.fav + ' -' : 'Spread ') + nx.spread + (nx.total != null ? ' · total ' + nx.total : '') : 'No line posted yet'}</b></div>
          <div className="rcF">Status<b>{p.avail >= 0.9 ? 'Healthy' : 'Check injury'}</b></div>
        </div>
        <RcH2H p={p} N={N} />
      </>
    );
  }
  return (
    <section className="view on rc">
      <style>{RC_CSS}</style>
      <h2 className="tsH">Player Research Center<span className="pill">{players.length ? 'top ' + players.length + ' players' : ''}</span></h2>
      <div className="rcTop">
        <div className="rcList">
          <input placeholder="Search player or team" value={q} onChange={e => setQ(e.target.value)} />
          <div className="rcTog">
            <button className={today ? 'on' : ''} onClick={() => setToday(true)}>Playing today</button>
            <button className={!today ? 'on' : ''} onClick={() => setToday(false)}>All players</button>
          </div>
          <div className="rcScroll">
            {list.map(x => <div key={x.id} className={'rcP' + (x.id === pid ? ' on' : '')} onClick={() => setPid(x.id)}><b>{x.name}</b><span>{x.team} {x.next && x.next.opp ? (x.next.home ? 'vs ' : '@ ') + x.next.opp : ''}</span></div>)}
            {!list.length && <div className="rcEmpty">No players match.</div>}
          </div>
        </div>
        <div className="rcMain">{body}</div>
      </div>
      <div className="rcSub" style={{ marginTop: 10 }}>Verdict rule: the model has to sit at least half a typical swing from the line, and he has to have gone that way in 7 of his last 10 (Play) or 6 (Lean). Model estimates, not guarantees.</div>
    </section>
  );
}
