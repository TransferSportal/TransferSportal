// ============ Defense vs Position (NFL) ============
//
// Yards allowed per game to each kind of player, one row per defense, built by
// nfl_dvp.py from nflverse player game logs. Rank 1 is the softest defense.
// Green is soft, red is tough, scaled by rank so every column reads the same way.
// Each row also shows the defense's opponent for the upcoming week, or a bye.

const DVP_CSS = `
.dvp .dvpHead{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.dvp .dvpWk{font-size:13px;font-weight:700;letter-spacing:.8px;color:var(--pos);text-transform:uppercase}
.dvp .dvpKey{display:flex;flex-direction:column;gap:3px;width:170px}
.dvp .dvpBar{height:6px;border-radius:4px;background:linear-gradient(90deg,#ef4444,rgba(255,255,255,.18) 50%,#22c55e)}
.dvp .dvpKeyL{display:flex;justify-content:space-between;font-size:9.5px;font-weight:700;letter-spacing:.7px}
.dvp .dvpKeyL i{font-style:normal}.dvp .dvpKeyL i:first-child{color:var(--neg)}.dvp .dvpKeyL i:last-child{color:var(--pos)}
.dvp .dvpScroll{overflow-x:auto;padding-bottom:4px}
.dvp .dvpGrid{min-width:660px;display:flex;flex-direction:column;gap:7px}
.dvp .dvpRow{display:grid;grid-template-columns:minmax(150px,1.5fr) repeat(6,minmax(70px,1fr));gap:6px;align-items:stretch}
.dvp .dvpHd{font-size:10.5px;font-weight:700;letter-spacing:.6px;color:var(--ink2);text-align:center;cursor:pointer;user-select:none;padding:4px 0;white-space:nowrap}
.dvp .dvpHd:hover,.dvp .dvpHd.on{color:var(--ink)}
.dvp .dvpHd.l{text-align:left;padding-left:12px}
.dvp .dvpTeam{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;background:var(--glass);border:1px solid var(--glassLine);min-width:0}
.dvp .dvpTeam b{display:block;font-size:13.5px;font-weight:800;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap}
.dvp .dvpTeam span.o{display:block;font-size:10.5px;color:var(--ink2);margin-top:1px}
.dvp .dvpTeam span.o.bye{color:var(--warn);font-weight:600}
.dvp .dvpCell{border-radius:10px;text-align:center;padding:7px 4px;border:1px solid rgba(255,255,255,.06)}
.dvp .dvpCell b{display:block;font-family:var(--num);font-size:15px;font-weight:600;color:var(--ink)}
.dvp .dvpCell i{display:block;font-style:normal;font-family:var(--num);font-size:9.5px;color:var(--ink2);margin-top:1px}
.dvp .dvpFoot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:var(--ink3)}
`;

function dvpColor(rank, n) {
  const mid = (n + 1) / 2;
  const t = (mid - rank) / ((n - 1) / 2); // +1 softest, -1 toughest
  const a = Math.min(1, Math.abs(t));
  return t >= 0
    ? 'rgba(34,197,94,' + (0.07 + 0.5 * a).toFixed(3) + ')'
    : 'rgba(239,68,68,' + (0.07 + 0.5 * a).toFixed(3) + ')';
}

function DvpTab({ DATA }) {
  const D = DATA.dvp;
  const [sk, setSk] = useState('team');
  const [desc, setDesc] = useState(false);
  if (!D || !D.rows || !D.rows.length) {
    return (
      <section className="view on">
        <h2 className="tsH">Defense vs Position</h2>
        <div className="empty">Waiting for the first yards-allowed build. It fills in on the next daily run.</div>
      </section>
    );
  }
  const nick = t => (((window.TEAM || {})[t] || {}).nick || t);
  const rows = D.rows.slice().sort((a, b) => {
    let r;
    if (sk === 'team') r = nick(a.team).localeCompare(nick(b.team));
    else r = a.v[sk] - b.v[sk];
    return desc ? -r : r;
  });
  const pick = k => { if (k === sk) setDesc(!desc); else { setSk(k); setDesc(k !== 'team'); } };
  const n = D.rows.length;
  const wk = D.week ? 'Week ' + D.week : '';
  return (
    <section className="view on dvp">
      <style>{DVP_CSS}</style>
      <div className="dvpHead">
        <div>
          <h2 className="tsH" style={{ margin: 0 }}>Defense vs Position</h2>
          {wk ? <div className="dvpWk">{wk}</div> : null}
        </div>
        <div className="dvpKey">
          <div className="dvpBar" />
          <div className="dvpKeyL"><i>TOUGH</i><i>SOFT</i></div>
        </div>
      </div>
      <div className="dvpScroll">
        <div className="dvpGrid">
          <div className="dvpRow">
            <div className={'dvpHd l' + (sk === 'team' ? ' on' : '')} onClick={() => pick('team')}>TEAM{sk === 'team' ? (desc ? ' ▼' : ' ▲') : ''}</div>
            {D.cols.map(([k, lab]) => (
              <div key={k} className={'dvpHd' + (sk === k ? ' on' : '')} onClick={() => pick(k)}>{lab}{sk === k ? (desc ? ' ▼' : ' ▲') : ''}</div>
            ))}
          </div>
          {rows.map(r => (
            <div className="dvpRow" key={r.team}>
              <div className="dvpTeam">
                <NfLogo t={r.team} size={30} />
                <div style={{ minWidth: 0 }}>
                  <b>{nick(r.team)}</b>
                  {r.bye ? <span className="o bye">BYE</span> : r.opp ? <span className="o">{r.ha === '@' ? '@' : 'vs'} {r.opp}</span> : <span className="o">&nbsp;</span>}
                </div>
              </div>
              {D.cols.map(([k]) => (
                <div key={k} className="dvpCell" style={{ background: dvpColor(r.r[k], n) }}>
                  <b>{r.v[k].toFixed(1)}</b>
                  <i>#{r.r[k]}</i>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="dvpFoot">
        <span>Yards allowed per game, {D.season}. Source: nflverse player game logs. Rank 1 is the softest defense. Tap a column to sort.</span>
        <span>{wk ? wk + ' opponent under each team' : ''}</span>
      </div>
    </section>
  );
}
