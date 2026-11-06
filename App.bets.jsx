// ============ Played bets: saved to the page's private database, graded by the morning and afternoon runs ============
function useBets() {
  const [st, setSt] = useState({ db: null, bets: [], ok: null });
  useEffect(() => {
    let off = () => {}, dead = false;
    (async () => {
      try {
        if (!window.claude || !window.claude.use) { setSt(s => ({ ...s, ok: false })); return; }
        const db = await window.claude.use('db');
        if (dead) return;
        if (!db) { setSt(s => ({ ...s, ok: false })); return; }
        off = db.collection('bets').onSnapshot(
          q => setSt({ db, ok: true, bets: q.docs.map(d => ({ id: d.id, ...d.data() })) }),
          () => setSt(s => ({ ...s, ok: false })));
      } catch (e) { setSt(s => ({ ...s, ok: false })); }
    })();
    return () => { dead = true; off(); };
  }, []);
  return st;
}
function PlayedBtn({ p, stat, L, v, nx, proj }) {
  const { db, bets, ok } = useBets();
  const [busy, setBusy] = useState(false);
  if (!v || v.blocked || v.word === 'Pass') return null;
  const gd = rcEt(nx.date);
  const id = [gd, p.id, stat, v.best.side, L].join('_').replace(/[^A-Za-z0-9_.-]/g, '');
  const have = bets.find(b => b.id === id);
  const click = async () => {
    if (!db || busy) return;
    setBusy(true);
    try {
      const ref = db.collection('bets').doc(id);
      if (have) { if (have.status === 'pending') await ref.delete(); }
      else await ref.set({ pid: p.id, name: p.name, team: p.team, opp: nx.opp || '', home: !!nx.home, gameDate: gd, gameTime: nx.date || '', stat, line: L, side: v.best.side, verdict: v.word, proj: Math.round(proj * 100) / 100, h10: v.best.h10, n10: v.best.n10, z: Math.round(v.best.z * 100) / 100, status: 'pending', placedAt: new Date().toISOString() });
    } catch (e) { /* write refused: stays unsaved */ }
    setBusy(false);
  };
  if (ok === false) return <div className="rcSub" style={{ marginBottom: 12 }}>Played button saves on your private link when you are signed in.</div>;
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={click} disabled={!db || busy} style={{ appearance: 'none', cursor: 'pointer', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, border: '1px solid var(--ink)', background: have ? 'var(--posBg)' : 'var(--ink)', color: have ? 'var(--pos)' : '#0d0f12' }}>
        {have ? 'Played · saved' + (have.status === 'pending' ? ' (tap to undo)' : '') : 'Played this bet'}
      </button>
    </div>
  );
}
function BetsPanel() {
  const { bets, ok } = useBets();
  if (ok === false || !bets.length) return ok === false ? null : <div className="rcSub" style={{ marginTop: 14 }}>Your record: no bets saved yet. Tap Played on a verdict after you place it.</div>;
  const rows = bets.slice().sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''));
  const w = rows.filter(b => b.status === 'win').length, l = rows.filter(b => b.status === 'loss').length, ps = rows.filter(b => b.status === 'push').length, pend = rows.filter(b => b.status === 'pending').length;
  const names = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3PM', pra: 'PRA' };
  const by = {};
  rows.forEach(b => { if (b.status === 'win' || b.status === 'loss') { const k = names[b.stat] || b.stat; by[k] = by[k] || [0, 0]; by[k][b.status === 'win' ? 0 : 1]++; } });
  const col = s => (s === 'win' ? 'var(--pos)' : s === 'loss' ? 'var(--neg)' : 'var(--ink2)');
  return (
    <div className="rcMain" style={{ marginTop: 14 }}>
      <div className="rcName" style={{ fontSize: 17 }}>Your record <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{w}-{l}{ps ? '-' + ps : ''}{pend ? ' · ' + pend + ' pending' : ''}</span></div>
      <div className="rcSub" style={{ margin: '4px 0 10px' }}>{Object.keys(by).map(k => k + ' ' + by[k][0] + '-' + by[k][1]).join(' · ') || 'Graded by the 9 a.m. and 4 p.m. runs after the game.'}</div>
      {rows.slice(0, 30).map(b => (
        <div key={b.id} className="rcP" style={{ cursor: 'default' }}>
          <span><b>{b.name}</b> {b.side === 'over' ? 'O' : 'U'} {b.line} {names[b.stat] || b.stat} <span style={{ color: 'var(--ink2)' }}>({b.verdict}, {b.gameDate})</span></span>
          <span style={{ color: col(b.status), fontWeight: 700 }}>{b.status === 'pending' ? 'Pending' : b.status.toUpperCase() + (b.actual != null ? ' · ' + b.actual : '')}</span>
        </div>
      ))}
    </div>
  );
}
