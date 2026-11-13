// ============ Played bets ============
// Singles and parlays are kept apart. Everything lives in the page's private database (collection "bets").
//   type "single": one prop.     type "parlay": legs[] graded by the runs; the page works out win/loss from the legs.
//   type "game": your own spread pick for an NFL game.
// A leg: {key, sport, name, team, opp, gameDate, stat, line, side, verdict, proj, season?, week?}
const STAT_NAME = { pts: 'pts', reb: 'reb', ast: 'ast', fg3: '3PM', pra: 'PRA', ry: 'rec yds', rc: 'rec', ruy: 'rush yds', py: 'pass yds', td: 'anytime TD' };
const SLIP = { legs: [], subs: new Set() };
function slipSet(legs) { SLIP.legs = legs; SLIP.subs.forEach(f => f()); }
function useSlip() {
  const [, f] = useState(0);
  useEffect(() => { const fn = () => f(x => x + 1); SLIP.subs.add(fn); return () => { SLIP.subs.delete(fn); }; }, []);
  return SLIP.legs;
}
// Two bettors share the site: RK (the owner) and DM. Every bet carries an owner tag; a bet with no tag is RK's.
// The owner is signed in as RK, anyone else as DM. Each has a separate bankroll (config doc: "config" for RK, "config_DM" for DM).
const OWN = { me: 'RK', view: 'RK', ready: false, chosen: false, subs: new Set() };
function ownSet(p) { Object.assign(OWN, p); OWN.subs.forEach(f => f()); }
function useOwn() {
  const [, f] = useState(0);
  useEffect(() => { const fn = () => f(x => x + 1); OWN.subs.add(fn); return () => { OWN.subs.delete(fn); }; }, []);
  return OWN;
}
const isCfg = b => b.type === 'config' || String(b.id).startsWith('config');
const ownOf = b => b.owner || (/^config_/.test(String(b.id)) ? String(b.id).slice(7) : 'RK');
const ownSfx = o => (o === 'RK' ? '' : o + '_');
function OwnerSwitch() {
  const o = useOwn();
  const bt = on => ({ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line2)'), background: on ? 'var(--ink)' : 'transparent', color: on ? '#0d0f12' : 'var(--ink2)' });
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' }}>
      {['RK', 'DM'].map(k => <button key={k} style={bt(o.view === k)} onClick={() => ownSet({ view: k })}>{k}{o.me === k ? ' (you)' : ''}</button>)}
      {o.view !== o.me && <span className="rcSub">Viewing {o.view}'s picks and bankroll (read only)</span>}
    </div>
  );
}
// Who is saving bets on this browser. Chosen once by tapping RK or DM, remembered on this device.
function SaveAs() {
  const o = useOwn();
  const pick = k => { try { localStorage.setItem('tsOwner', k); } catch (e) { /* no storage */ } ownSet({ me: k, view: k, chosen: true }); };
  const bt = on => ({ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, border: '1px solid ' + (on ? 'var(--pos)' : 'var(--line2)'), background: on ? 'var(--posBg)' : 'transparent', color: on ? 'var(--pos)' : 'var(--ink2)' });
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexBasis: '100%', margin: '2px 0 4px' }}>
      <span className="rcSub">Saving as:</span>
      {['RK', 'DM'].map(k => <button key={k} style={bt(o.me === k)} onClick={() => pick(k)}>{k}</button>)}
      {!o.chosen && <span className="rcSub" style={{ color: 'var(--warn)' }}>Tap yours once. This device remembers it.</span>}
    </div>
  );
}
function useBets() {
  const [st, setSt] = useState({ db: null, all: [], ok: null });
  const o = useOwn();
  useEffect(() => {
    let off = () => {}, dead = false;
    (async () => {
      try {
        if (!window.claude || !window.claude.use) { setSt(s => ({ ...s, ok: false })); return; }
        const db = await window.claude.use('db');
        if (dead) return;
        if (!db) { setSt(s => ({ ...s, ok: false })); return; }
        try {
          const u = await window.claude.use('user');
          if (!OWN.ready) { OWN.ready = true; let me = u && u.isOwner && !u.isOwner() ? 'DM' : 'RK', chosen = false; try { const sv = localStorage.getItem('tsOwner'); if (sv === 'RK' || sv === 'DM') { me = sv; chosen = true; } } catch (e2) { /* no storage */ } ownSet({ me, view: me, chosen }); }
        } catch (e) { /* stays RK */ }
        off = db.collection('bets').onSnapshot(
          q => setSt({ db, ok: true, all: q.docs.map(d => ({ id: d.id, ...d.data() })) }),
          () => setSt(s => ({ ...s, ok: false })));
      } catch (e) { setSt(s => ({ ...s, ok: false })); }
    })();
    return () => { dead = true; off(); };
  }, []);
  return { db: st.db, ok: st.ok, all: st.all, me: o.me, view: o.view,
    bets: st.all.filter(b => ownOf(b) === o.view), mine: st.all.filter(b => ownOf(b) === o.me) };
}
function legText(l) {
  if (l.stat === 'td') return l.name + ' anytime TD' + (l.line ? ' (' + l.line + ')' : '');
  return l.name + ' ' + (l.side === 'over' ? 'O' : 'U') + ' ' + l.line + ' ' + (STAT_NAME[l.stat] || l.stat);
}
function mkLeg(o) {
  const slug = String(o.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const key = [o.sport, o.gameDate, o.pid || slug, o.stat, o.side, o.line].join('_').replace(/[^A-Za-z0-9_.+-]/g, '');
  return { key, ...o };
}
function parlayStatus(b) {
  const s = (b.legs || []).map(l => l.status || 'pending');
  if (s.includes('loss')) return 'loss';
  if (s.includes('pending')) return 'pending';
  if (s.every(x => x === 'push' || x === 'void')) return 'push';
  return 'win';
}

// ---- money ----
function amDec(o) { o = Number(o); if (!o || Math.abs(o) < 100) return null; return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o); }
function betState(b) { return b.type === 'parlay' ? parlayStatus(b) : b.status; }
// profit in dollars for a graded bet; null when it cannot be worked out yet
function betPL(b) {
  const st = Number(b.stake) || 0, s = betState(b);
  if (!st) return null;
  if (s === 'loss') return -st;
  if (s === 'push' || s === 'void') return 0;
  // stake is the total charged (wager plus any 3% injury insurance fee). The odds price only the wager, so a
  // ticket with a separate wager field pays wager x odds, and the fee is part of what was lost.
  if (s === 'win') { const d = amDec(b.odds), w = Number(b.wager) > 0 ? Number(b.wager) : st; return d ? w * d - st : null; }
  return null;
}
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const bkPct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
function BetEdit({ b }) {
  const { db, me } = useBets();
  const mineB = true;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ stake: b.stake || '', odds: b.odds || '', book: b.book || '', alt: !!b.alt, owner: ownOf(b) });
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!open) setF({ stake: b.stake || '', odds: b.odds || '', book: b.book || '', alt: !!b.alt, owner: ownOf(b) }); }, [b.stake, b.odds, b.book, b.alt, b.owner, open]);
  const inp = { background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 8px', color: 'var(--ink)', fontSize: 13, width: 84 };
  const sum = b.stake ? '$' + b.stake + (b.odds ? ' at ' + (Number(b.odds) > 0 ? '+' : '') + b.odds : ' (no odds yet)') + (b.book ? ' · ' + b.book : '') + (b.alt ? ' · alt line' : '') : 'Add stake and odds';
  const save = async () => {
    if (!db) return;
    try {
      await db.collection('bets').doc(b.id).update({ stake: Number(f.stake) || 0, odds: Number(f.odds) || 0, book: f.book.trim(), alt: !!f.alt, owner: f.owner });
      setMsg('Saved'); setOpen(false);
    } catch (e) { setMsg('Could not save'); }
  };
  return (
    <div style={{ marginTop: 4 }}>
      <span className="rcSub" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => mineB && setOpen(!open)}>{sum}{mineB ? ' · edit' : ''}</span>
      {open && mineB && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <input style={inp} inputMode="decimal" placeholder="Stake $" value={f.stake} onChange={e => setF({ ...f, stake: e.target.value })} />
          <input style={inp} inputMode="numeric" placeholder="Odds +450" value={f.odds} onChange={e => setF({ ...f, odds: e.target.value })} />
          <input style={{ ...inp, width: 110 }} list="bookList" placeholder="Book" value={f.book} onChange={e => setF({ ...f, book: e.target.value })} />
          <datalist id="bookList"><option value="FanDuel" /><option value="DraftKings" /><option value="BetMGM" /><option value="Caesars" /><option value="Fanatics" /><option value="Other" /></datalist>
          <label className="rcSub" style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.alt} onChange={e => setF({ ...f, alt: e.target.checked })} />Alt line</label>
          <select value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} style={{ ...inp, width: 70 }}><option value="RK">RK</option><option value="DM">DM</option></select>
          <button onClick={save} style={{ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid var(--ink)', background: 'var(--ink)', color: '#0d0f12' }}>Save</button>
          {msg && <span className="rcSub">{msg}</span>}
        </div>
      )}
    </div>
  );
}
// ---- Bankroll dashboard: weekly tiles, profit by day, goal ring, open and settled bets ----
const BK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function bkDay(s) { return new Date(s + 'T12:00:00'); }
function bkIso(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function bkMon(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function bkWhen(b) {
  if (b.type === 'parlay') { const ds = (b.legs || []).map(l => l.gameDate).filter(Boolean).sort(); if (ds.length) return ds[ds.length - 1]; }
  return b.gameDate || (b.placedAt || '').slice(0, 10);
}
function bkShort(n) { const a = Math.abs(n); return (n < 0 ? '-$' : '+$') + (a >= 100 ? Math.round(a) : a.toFixed(a % 1 ? 1 : 0)); }
function BkChart({ vals }) {
  const W = 440, H = 190, L = 40, B = 24, T = 18, R = 8;
  const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals);
  const span = (mx - mn) || 1;
  const y = v => T + (H - T - B) * (mx - v) / span;
  const bw = (W - L - R) / 7;
  const any = vals.some(v => v !== 0);
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs><filter id="bkGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,.28)" strokeDasharray="3 4" />
      <text x={L - 6} y={y(0) + 3} textAnchor="end" fontSize="9" fill="var(--ink3)">$0</text>
      {mx > 0 && <text x={L - 6} y={y(mx) + 3} textAnchor="end" fontSize="9" fill="var(--ink3)">{bkShort(mx).replace('+', '')}</text>}
      {mn < 0 && <text x={L - 6} y={y(mn) + 3} textAnchor="end" fontSize="9" fill="var(--ink3)">{bkShort(mn)}</text>}
      {vals.map((v, i) => {
        const x = L + i * bw + bw * 0.2, w = bw * 0.6;
        const top = Math.min(y(v), y(0)), h = Math.max(Math.abs(y(v) - y(0)), v !== 0 ? 2 : 0);
        return (
          <g key={i}>
            {v !== 0 && <rect x={x} y={top} width={w} height={h} rx="3" fill={v > 0 ? '#34f5a1' : '#ff5d6c'} filter="url(#bkGlow)" />}
            {v !== 0 && <text x={x + w / 2} y={v > 0 ? top - 4 : top + h + 11} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={v > 0 ? '#22c55e' : '#ef4444'}>{bkShort(v)}</text>}
            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink3)">{BK_DAYS[i]}</text>
          </g>
        );
      })}
      {!any && <text x={(W + L) / 2} y={H / 2 - 4} textAnchor="middle" fontSize="12" fill="var(--ink3)">No graded bets this week</text>}
    </svg>
  );
}
function BkRing({ pct }) {
  const r = 54, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return (
    <svg viewBox="0 0 140 140" style={{ width: 150, height: 150 }}>
      <defs><filter id="bkGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={pct >= 1 ? '#34f5a1' : '#5eead4'} strokeWidth="10" strokeLinecap="round" filter="url(#bkGlow)" strokeDasharray={c * p + ' ' + c} transform="rotate(-90 70 70)" />
      <text x="70" y="77" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--ink)">{Math.round(pct * 100)}%</text>
    </svg>
  );
}
const BK_CSS = `
.bk .bkHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.bk .bkKick{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink3);font-weight:700}
.bk .bkTitle{margin:2px 0 0;font-size:26px;font-weight:800;letter-spacing:-.4px}
.bk .bkNav{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink2)}
.bk .bkNav button{appearance:none;cursor:pointer;background:transparent;border:1px solid var(--line);border-radius:8px;color:var(--ink2);padding:5px 10px;font-size:12px}
.bk .bkNav button:hover{color:var(--ink)}
.bk .bkNav b{color:var(--ink);padding:0 6px}
.bk .bkGrid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.bk .bkT{padding:14px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:0}
.bk .bkT:nth-child(4n){border-right:none}.bk .bkT:nth-last-child(-n+4){border-bottom:none}
.bk .bkL{font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--ink3);font-weight:700}
.bk .bkV{font-size:25px;font-weight:800;letter-spacing:-.5px;margin-top:5px;line-height:1.1}
.bk .bkS{font-size:11px;color:var(--ink3);margin-top:4px}
.bk .bkTwo{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:12px}
.bk .bkCard{border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0}
.bk .bkCardH{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:14px;font-weight:700}
.bk .bkLink{appearance:none;cursor:pointer;background:none;border:none;color:var(--ink2);font-size:11.5px;font-weight:700;padding:0}
.bk .bkLink:hover{color:var(--ink)}
.bk .bkRing{display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:4px}
.bk .bkRingT{font-size:12px;color:var(--ink2);text-align:center}
.bk .bkRow{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 0;border-top:1px solid var(--line2);font-size:13px}
.bk .bkRow:first-of-type{border-top:none}
.bk .bkRow .sub{font-size:11px;color:var(--ink3);margin-top:2px}
.bk .bkIn{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:8px;padding:6px 8px;color:var(--ink);font-size:13px;width:110px}
.bk .bkBtn{appearance:none;cursor:pointer;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:700;border:1px solid var(--ink);background:transparent;color:var(--ink)}
.bk details summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--ink2);list-style:none}
.bk details summary::-webkit-details-marker{display:none}
.bk details summary:before{content:'+ ';color:var(--ink3)}.bk details[open] summary:before{content:'- '}
@media(max-width:760px){.bk .bkGrid{grid-template-columns:repeat(2,1fr)}.bk .bkT:nth-child(4n){border-right:1px solid var(--line)}.bk .bkT:nth-child(2n){border-right:none}.bk .bkT:nth-last-child(-n+4){border-bottom:1px solid var(--line)}.bk .bkT:nth-last-child(-n+2){border-bottom:none}.bk .bkTwo{grid-template-columns:1fr}.bk .bkV{font-size:21px}}
`;
const BK_FX = `
.bk{position:relative;isolation:isolate}
.bk:before{content:'';position:absolute;inset:-8px;z-index:-1;border-radius:24px;pointer-events:none;background:radial-gradient(620px 240px at 12% 0%,rgba(0,255,200,.12),transparent 70%),radial-gradient(520px 260px at 92% 8%,rgba(120,90,255,.14),transparent 70%)}
.bk .bkKick{color:#5eead4;letter-spacing:3.2px;font-family:var(--num);text-shadow:0 0 10px rgba(94,234,212,.7)}
.bk .bkKick:before{content:'';display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;background:#5eead4;box-shadow:0 0 10px #5eead4;animation:bkPulse 1.8s ease-in-out infinite}
.bk .bkTitle{font-family:var(--num);text-transform:uppercase;letter-spacing:5px;font-size:28px;font-weight:700;background:linear-gradient(90deg,#f0fffd,#5eead4 55%,#93a4ff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(94,234,212,.35))}
.bk .bkGrid,.bk .bkCard{background:linear-gradient(160deg,rgba(94,234,212,.08),rgba(8,14,22,.6));border:1px solid rgba(94,234,212,.30);border-radius:10px;box-shadow:0 0 26px rgba(94,234,212,.08),inset 0 1px 0 rgba(255,255,255,.08);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.bk .bkGrid{position:relative}
.bk .bkGrid:after{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,rgba(94,234,212,.85),transparent);animation:bkScan 5s linear infinite;pointer-events:none}
.bk .bkT{border-color:rgba(94,234,212,.16);transition:background .2s,box-shadow .2s}
.bk .bkT:hover{background:rgba(94,234,212,.08);box-shadow:inset 0 0 24px rgba(94,234,212,.12)}
.bk .bkL{color:#7dd3c8;font-family:var(--num);letter-spacing:2.2px}
.bk .bkV{font-family:var(--num);font-weight:600;font-size:27px;text-shadow:0 0 18px currentColor}
.bk .bkS{font-family:var(--num);color:#6f8f93}
.bk .bkCardH{font-family:var(--num);text-transform:uppercase;letter-spacing:2.2px;font-size:11.5px;color:#9ae6dc}
.bk .bkRow{border-top-color:rgba(94,234,212,.13);font-family:var(--num);font-size:12.5px}
.bk .bkNav b{font-family:var(--num);color:#d6fffa}
.bk .bkNav button,.bk .bkBtn{border-color:rgba(94,234,212,.5);color:#5eead4;border-radius:6px;font-family:var(--num);background:rgba(94,234,212,.05);transition:box-shadow .2s,color .2s}
.bk .bkNav button:hover,.bk .bkBtn:hover{box-shadow:0 0 16px rgba(94,234,212,.5);color:#f0fffd}
.bk .bkIn{border-color:rgba(94,234,212,.38);font-family:var(--num);border-radius:6px}
.bk .bkLink{color:#5eead4}
.bk details summary{color:#9ae6dc;font-family:var(--num)}
.bk circle{transition:stroke-dasharray 1.4s ease}
.bk svg rect{transition:all .7s ease}
@keyframes bkScan{0%{top:0;opacity:0}8%{opacity:1}92%{opacity:1}100%{top:calc(100% - 2px);opacity:0}}
@keyframes bkPulse{50%{opacity:.35;transform:scale(.75)}}
@media (prefers-reduced-motion:reduce){.bk .bkGrid:after,.bk .bkKick:before{animation:none}}
`;
function Bankroll() {
  const { db, bets, ok, me, view } = useBets();
  const cfg = bets.find(b => b.type === 'config' || String(b.id).startsWith('config')) || {};
  const [off, setOff] = useState(0);
  const [sb, setSb] = useState('');
  const [gv, setGv] = useState('');
  const [editGoal, setEditGoal] = useState(false);
  if (ok === false) return <div className="rcMain"><div className="rcSub">Bankroll saves on your private link when you are signed in.</div></div>;
  const real = bets.filter(b => b.type === 'single' || b.type === 'parlay' || (!b.type && !isCfg(b)));
  const staked = real.filter(b => Number(b.stake) > 0);
  const isDone = b => ['win', 'loss', 'push', 'void'].includes(betState(b));
  const graded = staked.filter(isDone);
  const priced = graded.filter(b => betPL(b) !== null);
  const noOdds = graded.filter(b => betState(b) === 'win' && !amDec(b.odds));
  const open = staked.filter(b => betState(b) === 'pending').sort((a, b) => bkWhen(a).localeCompare(bkWhen(b)));
  const risk = open.reduce((a, b) => a + Number(b.stake), 0);
  const noStake = real.length - staked.length;
  const agg = rows => { const st = rows.reduce((a, b) => a + Number(b.stake), 0), pl = rows.reduce((a, b) => a + betPL(b), 0); return { n: rows.length, st, pl, roi: st ? pl / st * 100 : 0 }; };
  const tot = agg(priced);
  const start = Number(cfg.start) || 0, goal = Number(cfg.goal) || 0;
  const mon = bkMon(new Date()); mon.setDate(mon.getDate() + off * 7);
  const days = BK_DAYS.map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return bkIso(d); });
  const sun = bkDay(days[6]);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const wk = priced.filter(b => days.includes(bkWhen(b)));
  const wkAll = graded.filter(b => days.includes(bkWhen(b)));
  const w = agg(wk);
  const byDay = days.map(d => wk.filter(b => bkWhen(b) === d).reduce((a, b) => a + betPL(b), 0));
  const cw = wkAll.filter(b => betState(b) === 'win').length, cl = wkAll.filter(b => betState(b) === 'loss').length, cp = wkAll.length - cw - cl;
  const hit = cw + cl ? Math.round(cw / (cw + cl) * 100) : null;
  const avgStake = wkAll.length ? wkAll.reduce((a, b) => a + Number(b.stake), 0) / wkAll.length : null;
  const col = n => n > 0 ? 'var(--pos)' : n < 0 ? 'var(--neg)' : 'var(--ink)';
  const save = async patch => { if (!db || view !== me) return; try { await db.collection('bets').doc(view === 'RK' ? 'config' : 'config_' + view).set({ type: 'config', owner: view, start, goal, ...patch }); } catch (e) { /* refused */ } };
  const tile = (label, val, sub, color) => <div className="bkT"><div className="bkL">{label}</div><div className="bkV" style={{ color: color || 'var(--ink)' }}>{val}</div><div className="bkS">{sub}</div></div>;
  const rowsDef = [
    ['Singles', priced.filter(b => b.type === 'single' || !b.type)],
    ['Parlays', priced.filter(b => b.type === 'parlay')],
    ['NBA singles', priced.filter(b => (b.type === 'single' || !b.type) && (b.sport || 'nba') === 'nba')],
    ['NFL singles', priced.filter(b => (b.type === 'single' || !b.type) && b.sport === 'nfl')],
    ['Alt lines', priced.filter(b => b.alt)]
  ];
  const books = {};
  priced.forEach(b => { const k = b.book || 'No book'; (books[k] = books[k] || []).push(b); });
  const cell = { padding: '6px 8px', fontSize: 13, textAlign: 'right' };
  const line = (label, a) => <tr key={label}><td style={{ ...cell, textAlign: 'left' }}>{label}</td><td style={cell}>{a.n}</td><td style={cell}>{money(a.st)}</td><td style={{ ...cell, color: col(a.pl), fontWeight: 700 }}>{money(a.pl)}</td><td style={{ ...cell, color: col(a.roi) }}>{a.n ? bkPct(a.roi) : '-'}</td></tr>;
  const label = b => (b.type === 'parlay' ? (b.legs || []).length + '-leg parlay' : legText(b)) + ' (' + ownOf(b) + ')';
  const oddsTxt = b => b.odds ? (Number(b.odds) > 0 ? '+' : '') + b.odds : 'no odds';
  const pct = goal ? w.pl / goal : 0;
  return (
    <section className="bk">
      <style>{BK_CSS + BK_FX}</style>
      <div className="bkHead">
        <div><div className="bkKick">Week of {fmt(bkDay(days[0]))}</div><h2 className="bkTitle">Bankroll ({view})</h2><OwnerSwitch /></div>
        <div className="bkNav"><button onClick={() => setOff(off - 1)}>Prev</button><b>{fmt(bkDay(days[0]))} - {fmt(sun)}</b><button onClick={() => setOff(off + 1)} disabled={off >= 0} style={{ opacity: off >= 0 ? 0.4 : 1 }}>Next</button></div>
      </div>
      <div className="bkGrid">
        {tile('Profit', money(w.pl), w.n + ' graded bet' + (w.n === 1 ? '' : 's') + ' this week', w.n ? col(w.pl) : null)}
        {tile('ROI', w.n ? bkPct(w.roi) : '-', money(w.st) + ' staked', w.n ? col(w.roi) : null)}
        {tile('Record', cw + '-' + cl + (cp ? '-' + cp : ''), hit == null ? 'no results yet' : hit + '% hit rate')}
        {tile('At risk now', money(risk), open.length + ' open bet' + (open.length === 1 ? '' : 's'))}
        {tile('All-time profit', money(tot.pl), tot.n + ' graded bets', tot.n ? col(tot.pl) : null)}
        {tile('All-time ROI', tot.n ? bkPct(tot.roi) : '-', money(tot.st) + ' staked', tot.n ? col(tot.roi) : null)}
        {tile('Avg stake', avgStake == null ? '-' : money(avgStake), 'this week')}
        {tile(start ? 'Balance' : 'Starting bankroll', start ? money(start + tot.pl) : 'Not set', start ? 'start ' + money(start) : 'set it below')}
      </div>
      <div className="bkTwo">
        <div className="bkCard">
          <div className="bkCardH"><span>Profit by day</span><span className="bkS" style={{ margin: 0 }}>settled bets, by game date</span></div>
          <BkChart vals={byDay} />
        </div>
        <div className="bkCard">
          <div className="bkCardH"><span>Goal progress</span>{view === me && <button className="bkLink" onClick={() => { setEditGoal(!editGoal); setGv(''); }}>{goal ? 'Edit goal' : 'Set goal'}</button>}</div>
          {editGoal && <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="bkIn" inputMode="decimal" placeholder={goal ? 'Weekly $' + goal : 'Weekly profit $'} value={gv} onChange={e => setGv(e.target.value)} />
            <button className="bkBtn" onClick={async () => { await save({ goal: Number(gv) || 0 }); setEditGoal(false); setGv(''); }}>Save</button>
          </div>}
          {goal ? (
            <div className="bkRing"><BkRing pct={pct} /><div className="bkRingT"><b style={{ color: 'var(--ink)' }}>Weekly profit</b><br />{money(w.pl)} / {money(goal)}</div></div>
          ) : <div className="bkS" style={{ padding: '30px 0', textAlign: 'center' }}>Set a weekly profit goal to track it here.</div>}
        </div>
      </div>
      <div className="bkTwo">
        <div className="bkCard">
          <div className="bkCardH"><span>Settled this week</span><span className="bkS" style={{ margin: 0 }}>{wkAll.length} bet{wkAll.length === 1 ? '' : 's'}</span></div>
          {!wkAll.length && <div className="bkS">Nothing graded yet this week.</div>}
          {wkAll.sort((a, b) => bkWhen(b).localeCompare(bkWhen(a))).map(b => { const pl = betPL(b), s = betState(b); return (
            <div className="bkRow" key={b.id}><div><div>{label(b)}</div><div className="sub">{bkWhen(b)} · {money(Number(b.stake))}{Number(b.wager) > 0 && Number(b.wager) < Number(b.stake) ? ' (' + money(Number(b.wager)) + ' priced)' : ''} at {oddsTxt(b)}{b.book ? ' · ' + b.book : ''}</div></div>
              <b style={{ color: pl == null ? 'var(--ink2)' : s === 'win' ? 'var(--pos)' : s === 'loss' ? 'var(--neg)' : 'var(--ink2)', whiteSpace: 'nowrap' }}>{pl == null ? 'needs odds' : money(pl)}</b></div>); })}
        </div>
        <div className="bkCard">
          <div className="bkCardH"><span>Open bets</span><span className="bkS" style={{ margin: 0 }}>{money(risk)} at risk</span></div>
          {!open.length && <div className="bkS">No open bets with a stake.</div>}
          {open.map(b => <div className="bkRow" key={b.id}><div><div>{label(b)}</div><div className="sub">{bkWhen(b)} · {oddsTxt(b)}{b.book ? ' · ' + b.book : ''}</div></div><b style={{ whiteSpace: 'nowrap' }}>{money(Number(b.stake))}</b></div>)}
        </div>
      </div>
      <div className="bkCard" style={{ marginTop: 12 }}>
        {view === me ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="bkIn" inputMode="decimal" placeholder={start ? 'Start: $' + start : 'Starting bankroll $'} value={sb} onChange={e => setSb(e.target.value)} />
          <button className="bkBtn" onClick={async () => { await save({ start: Number(sb) || 0 }); setSb(''); }}>Set</button>
          <span className="bkS" style={{ margin: 0 }}>Balance = starting bankroll plus profit on graded bets.</span>
        </div>
        ) : <div className="bkS" style={{ margin: 0 }}>Read only: this is {view}'s bankroll.</div>}
        {!!(noStake || noOdds.length) && <div className="bkS" style={{ marginTop: 10 }}>{noStake ? noStake + ' saved bet' + (noStake === 1 ? ' has' : 's have') + ' no stake yet, so ' + (noStake === 1 ? 'it is' : 'they are') + ' left out. Add a stake and odds on the bet in the Player Research Center. ' : ''}{noOdds.length ? noOdds.length + ' won bet' + (noOdds.length === 1 ? ' needs' : 's need') + ' odds before profit counts.' : ''}</div>}
      </div>
      <div className="bkCard" style={{ marginTop: 12, overflowX: 'auto' }}>
        <details>
          <summary>Breakdown by type and book</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr>{['', 'Bets', 'Staked', 'Profit', 'ROI'].map((h, i) => <th key={i} className="rcSub" style={{ ...cell, textAlign: i ? 'right' : 'left', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {line('All graded', tot)}
              {rowsDef.map(([l, r]) => r.length ? line(l, agg(r)) : null)}
              {Object.keys(books).sort().map(k => line(k, agg(books[k])))}
            </tbody>
          </table>
          <div className="bkS" style={{ marginTop: 10 }}>Win profit = the wager times the payout from the odds you typed, minus the stake. With no separate wager that is the stake times the profit on the odds. When a ticket has an injury insurance fee, the stake is the total charged and the wager is the amount the odds price. A loss is minus the stake. A push or void is zero. Pending bets count as money at risk.</div>
        </details>
      </div>
    </section>
  );
}
function PlayControls({ leg: baseLeg }) {
  const [ov, setOv] = useState({ k: null, s: null });
  const canFlip = baseLeg.side === 'over' || baseLeg.side === 'under';
  const side = canFlip && ov.k === baseLeg.key && ov.s ? ov.s : baseLeg.side;
  const leg = side === baseLeg.side ? baseLeg : (() => { const { key: _k, ...rest } = baseLeg; return mkLeg({ ...rest, side, verdict: 'Fade' }); })();
  const { db, mine: bets, ok, me } = useBets();
  const slip = useSlip();
  const [busy, setBusy] = useState(false);
  const sid = 'single_' + ownSfx(me) + leg.key;
  const have = bets.find(b => b.id === sid);
  const onSlip = slip.some(l => l.key === leg.key);
  if (ok === false) return <div className="rcSub" style={{ marginBottom: 12 }}>Played buttons save on your private link when you are signed in.</div>;
  const single = async () => {
    if (!db || busy) return;
    setBusy(true);
    try {
      const ref = db.collection('bets').doc(sid);
      if (have) { if (have.status === 'pending') await ref.delete(); }
      else await ref.set({ type: 'single', owner: me, ...leg, status: 'pending', placedAt: new Date().toISOString() });
    } catch (e) { /* refused: stays unsaved */ }
    setBusy(false);
  };
  const toggleSlip = () => slipSet(onSlip ? slip.filter(l => l.key !== leg.key) : slip.concat([leg]));
  const b = (on, ac) => ({ appearance: 'none', cursor: 'pointer', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, border: '1px solid ' + (on ? 'var(--pos)' : 'var(--ink)'), background: on ? 'var(--posBg)' : ac ? 'var(--ink)' : 'transparent', color: on ? 'var(--pos)' : ac ? '#0d0f12' : 'var(--ink)' });
  const sideBtn = x => ({ appearance: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid ' + (side === x ? 'var(--ink)' : 'var(--line2)'), background: side === x ? 'var(--ink)' : 'transparent', color: side === x ? '#0d0f12' : 'var(--ink2)' });
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <SaveAs />
      {canFlip && !have && <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="rcSub">Your side{side !== baseLeg.side ? ' (against the model)' : ''}:</span>
        <button style={sideBtn('over')} onClick={() => setOv({ k: baseLeg.key, s: 'over' })}>Over {leg.line}</button>
        <button style={sideBtn('under')} onClick={() => setOv({ k: baseLeg.key, s: 'under' })}>Under {leg.line}</button>
      </div>}
      <button style={b(!!have, true)} disabled={!db || busy} onClick={single}>{have ? 'Single saved' + (have.status === 'pending' ? ' (tap to undo)' : '') : 'Play as single'}</button>
      <button style={b(onSlip, false)} onClick={toggleSlip}>{onSlip ? 'On parlay slip (tap to remove)' : 'Add to parlay slip'}</button>
      {have && <div style={{ flexBasis: '100%' }}><BetEdit b={have} /></div>}
    </div>
  );
}
// Called from the NBA verdict. Pass verdicts can be played too: you may be fading the model.
function PlayedBtn({ p, stat, L, v, nx, proj }) {
  if (!v || v.blocked) return null;
  const leg = mkLeg({ sport: 'nba', pid: p.id, name: p.name, team: p.team, opp: nx.opp || '', gameDate: rcEt(nx.date), stat, line: L, side: v.best.side, verdict: v.word, proj: Math.round(proj * 100) / 100 });
  return <PlayControls leg={leg} />;
}
function SlipBar() {
  const slip = useSlip();
  const { db, ok, me } = useBets();
  const [busy, setBusy] = useState(false);
  const [pf, setPf] = useState({ stake: '', odds: '', book: '', alt: false });
  if (!slip.length || ok === false) return null;
  const place = async () => {
    if (!db || busy || slip.length < 2) return;
    setBusy(true);
    try {
      await db.collection('bets').doc('parlay_' + ownSfx(me) + Date.now()).set({ type: 'parlay', owner: me, legs: slip.map(l => ({ ...l, status: 'pending' })), status: 'pending', placedAt: new Date().toISOString(), stake: Number(pf.stake) || 0, odds: Number(pf.odds) || 0, book: pf.book.trim(), alt: !!pf.alt });
      slipSet([]); setPf({ stake: '', odds: '', book: '', alt: false });
    } catch (e) { /* refused */ }
    setBusy(false);
  };
  return (
    <div className="rcMain" style={{ marginBottom: 14, borderColor: 'var(--ink)' }}>
      <div className="rcName" style={{ fontSize: 16 }}>Parlay slip · {slip.length} leg{slip.length === 1 ? '' : 's'}</div>
      <SaveAs />
      {slip.map(l => (
        <div key={l.key} className="rcP" style={{ cursor: 'default' }}>
          <span><b>{legText(l)}</b> <span style={{ color: 'var(--ink2)' }}>({l.sport.toUpperCase()}, {l.verdict}, {l.gameDate})</span></span>
          <span style={{ cursor: 'pointer', color: 'var(--neg)' }} onClick={() => slipSet(slip.filter(x => x.key !== l.key))}>remove</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['stake', 'Stake $', 84], ['odds', 'Odds +450', 92], ['book', 'Book', 100]].map(([k, ph, w]) => <input key={k} placeholder={ph} value={pf[k]} onChange={e => setPf({ ...pf, [k]: e.target.value })} style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px', color: 'var(--ink)', fontSize: 13, width: w }} />)}
        <label className="rcSub" style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={pf.alt} onChange={e => setPf({ ...pf, alt: e.target.checked })} />Alt line</label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={slip.length < 2 || busy} onClick={place} style={{ appearance: 'none', cursor: slip.length < 2 ? 'default' : 'pointer', opacity: slip.length < 2 ? 0.5 : 1, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, border: '1px solid var(--ink)', background: 'var(--ink)', color: '#0d0f12' }}>Place parlay</button>
        <button onClick={() => slipSet([])} style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--ink2)', fontSize: 13 }}>Clear slip</button>
        <span className="rcSub">{slip.length < 2 ? 'Add at least 2 legs.' : 'Hits only if every leg hits. A push drops that leg.'}</span>
      </div>
    </div>
  );
}
function resCol(s) { return s === 'win' ? 'var(--pos)' : s === 'loss' ? 'var(--neg)' : 'var(--ink2)'; }
function tally(rows, f) {
  const c = { w: 0, l: 0, p: 0, n: 0 };
  rows.forEach(b => { const s = f(b); if (s === 'win') c.w++; else if (s === 'loss') c.l++; else if (s === 'push') c.p++; else if (s === 'pending') c.n++; });
  return c;
}
const tstr = c => c.w + '-' + c.l + (c.p ? '-' + c.p : '') + (c.n ? ' · ' + c.n + ' pending' : '');
function BetsPanel({ only }) {
  const { bets, ok } = useBets();
  if (ok === false) return null;
  const all = bets.slice().sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''));
  const singles = all.filter(b => !isCfg(b) && (b.type || 'single') === 'single');
  const parlays = all.filter(b => b.type === 'parlay');
  const games = all.filter(b => b.type === 'game');
  const box = { marginTop: 14 };
  if (only === 'games') {
    const sg = s => s.status;
    const dis = games.filter(b => b.modelTeam && b.modelTeam !== b.pickTeam);
    if (!games.length) return <div style={box}><OwnerSwitch /><div className="rcSub">Game picks record starts when a game picked is graded.</div></div>;
    return (
      <div className="rcMain" style={box}>
        <OwnerSwitch />
        <div className="rcName" style={{ fontSize: 17 }}>Game picks <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(tally(games, sg))}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>When you disagreed with the model: {tstr(tally(dis, sg))}</div>
        {games.slice(0, 40).map(b => (
          <div key={b.id} className="rcP" style={{ cursor: 'default' }}>
            <span><b>{b.pickTeam} {b.line > 0 ? '+' : ''}{b.line}</b> <span style={{ color: 'var(--ink2)' }}>({b.away} @ {b.home}, wk {b.week}; model {b.modelPick})</span></span>
            <span style={{ color: resCol(b.status), fontWeight: 700 }}>{b.status === 'pending' ? 'Pending' : String(b.status).toUpperCase() + (b.final ? ' · ' + b.final : '')}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!singles.length && !parlays.length) return <div style={box}><OwnerSwitch /><div className="rcSub">Record: nothing saved yet for this bettor. Use Play as single or build a parlay slip.</div></div>;
  const by = {};
  singles.forEach(b => { if (b.status === 'win' || b.status === 'loss') { const k = (b.sport || 'nba').toUpperCase() + ' ' + (STAT_NAME[b.stat] || b.stat); by[k] = by[k] || [0, 0]; by[k][b.status === 'win' ? 0 : 1]++; } });
  const pst = parlays.map(parlayStatus);
  const pc = tally(parlays, b => parlayStatus(b));
  const missed = parlays.filter(b => parlayStatus(b) === 'loss');
  const legsHit = missed.reduce((s, b) => s + b.legs.filter(l => l.status === 'win').length, 0), legsAll = missed.reduce((s, b) => s + b.legs.length, 0);
  return (
    <>
      <div className="rcMain" style={box}>
        <OwnerSwitch />
        <div className="rcName" style={{ fontSize: 17 }}>Singles record <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(tally(singles, b => b.status))}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>{Object.keys(by).map(k => k + ' ' + by[k][0] + '-' + by[k][1]).join(' · ') || 'Graded by the 9 a.m. and 4 p.m. runs after the game.'}</div>
        {singles.slice(0, 30).map(b => (
          <div key={b.id}>
          <div className="rcP" style={{ cursor: 'default' }}>
            <span><b>{legText(b)}</b> <span style={{ color: 'var(--ink2)' }}>({ownOf(b)}, {(b.sport || 'nba').toUpperCase()}, {b.verdict}, {b.gameDate})</span></span>
            <span style={{ color: resCol(b.status), fontWeight: 700 }}>{b.status === 'pending' ? 'Pending' : String(b.status).toUpperCase() + (b.actual != null ? ' · ' + b.actual : '')}{betPL(b) !== null && <span style={{ marginLeft: 6 }}>{money(betPL(b))}</span>}</span>
          </div>
          <BetEdit b={b} />
          </div>
        ))}
      </div>
      <div className="rcMain" style={box}>
        <div className="rcName" style={{ fontSize: 17 }}>Parlays record <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>{tstr(pc)}</span></div>
        <div className="rcSub" style={{ margin: '4px 0 10px' }}>{missed.length ? 'On missed parlays, ' + legsHit + ' of ' + legsAll + ' legs hit.' : 'Win only if every leg hits.'}</div>
        {parlays.slice(0, 20).map((b, i) => (
          <div key={b.id} style={{ borderTop: '1px solid var(--line2)', padding: '9px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <b>{b.legs.length}-leg parlay ({ownOf(b)})</b>
              <span style={{ color: resCol(pst[parlays.indexOf(b)]), fontWeight: 700 }}>{pst[parlays.indexOf(b)] === 'pending' ? 'Pending' : pst[parlays.indexOf(b)].toUpperCase()}{betPL(b) !== null && <span style={{ marginLeft: 6 }}>{money(betPL(b))}</span>}</span>
            </div>
            <BetEdit b={b} />
            {b.legs.map(l => <div key={l.key} className="rcSub">{legText(l)} <span style={{ color: resCol(l.status) }}>{l.status && l.status !== 'pending' ? l.status + (l.actual != null ? ' · ' + l.actual : '') : 'pending'}</span></div>)}
          </div>
        ))}
      </div>
    </>
  );
}
