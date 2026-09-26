/*
 * TransferSportal — the tabs and the root component.
 *
 * Second half of the dashboard; App.jsx is the first. build.py concatenates
 * them in order into one script block, so everything here can call the helpers
 * defined there.
 */
// ============ Predictions tab ============
// Every chip below is derived from fields the model already computes -- nothing
// invented for display. Tone drives color: good=favorable, warn=caution, bad=against.
function reasons(p, m) {
  const out = [];
  if (p.rostered === false) { out.push({ label: p.out_reason || 'Unavailable', tone: 'bad', detail: 'Not on the active roster right now.' }); return out; }
  if (p.gl_pg >= 0.8) out.push({ label: 'Goal-line role', tone: 'good', detail: `Averaging ${p.gl_pg.toFixed(1)} touches inside the 5 per game.` });
  if (p.rz_pg >= 1.5) out.push({ label: 'Red-zone volume', tone: 'good', detail: `${p.rz_pg.toFixed(1)} touches inside the 10 per game.` });
  if (p.games >= 3 && p.td_games / p.games >= 0.5) out.push({ label: 'Proven scorer', tone: 'good', detail: `Scored in ${p.td_games} of ${p.games} games this season.` });
  if (m && m.mu != null) {
    if (m.mu >= 1.15) out.push({ label: 'Soft matchup', tone: 'good', detail: `${p.next_opp} allows ${m.defY.toFixed(0)} ${m.label} yds/g to ${p.pos}s${m.soft?` (${ord(m.soft)} most in the league)`:''}.` });
    else if (m.mu <= 0.85) out.push({ label: 'Tough matchup', tone: 'bad', detail: `${p.next_opp} allows just ${m.defY.toFixed(0)} ${m.label} yds/g to ${p.pos}s.` });
  }
  if (p.itt != null) {
    if (p.itt >= 25) out.push({ label: 'High-scoring game', tone: 'good', detail: `Implied team total ${p.itt.toFixed(1)} points.` });
    else if (p.itt <= 19) out.push({ label: 'Low-scoring game', tone: 'bad', detail: `Implied team total just ${p.itt.toFixed(1)} points.` });
  }
  if (p.moved) out.push({ label: 'New team', tone: 'warn', detail: `Changed teams since last season${p.team_prev?` (was ${p.team_prev})`:''}; usage pulled toward a positional baseline.` });
  if (p.projected) out.push({ label: 'Role projection', tone: 'warn', detail: 'No 2026 snaps yet -- estimated from his depth-chart role.' });
  if (p.games && p.games <= 2 && !p.projected) out.push({ label: 'Small sample', tone: 'warn', detail: `Only ${p.games} game${p.games===1?'':'s'} tracked this season.` });
  if (!out.length) out.push({ label: 'Limited signal', tone: 'warn', detail: 'Not enough data yet to flag anything specific -- check the season profile below.' });
  return out;
}
function Chip({ r }) {
  return <span className={'rchip ' + r.tone} title={r.detail}>{r.label}</span>;
}
function DetailPanel({ p, DATA, reasonList }) {
  const a = Math.min((p.eff_rz10!=null?p.eff_rz10:p.rz_pg||0)/2.5, 1);
  const b = Math.min((p.eff_rz5!=null?p.eff_rz5:p.gl_pg||0)/1.2, 1);
  const itt = p.itt!=null ? Math.min(Math.max((p.itt-15)/13,0),1) : 0.5;
  const m = matchupOf(p, DATA);
  const Bar = ({label, v, val}) => (
    <div className="brk"><span>{label}</span><span className="t"><i style={{width:`${Math.round(v*100)}%`}}/></span><span className="v">{val}</span></div>
  );
  return (
    <div className="det">
      <div>
        <div className="dk">Why this pick, in full</div>
        <div className="reasonList">
          {reasonList.map((r,i) => (
            <div className={'reasonRow ' + r.tone} key={i}><b>{r.label}</b><span>{r.detail}</span></div>
          ))}
        </div>
        {p.gw && p.gw.length ? (
          <>
            <div className="dk" style={{marginTop:12}}>{DATA.meta.season} week by week. Filled means he scored.</div>
            <div className="log">
              {p.gw.map((w,i) => (
                <span key={i} className={'g'+(p.gt[i]>0?' hit':'')} title={`Week ${w} vs ${p.go[i]}: ${p.gt[i]} TD`}>{w}</span>
              ))}
            </div>
          </>
        ) : (
          <div className="dk" style={{marginTop:12}}>No prior season. Estimated from the role he inherits -- the team's vacated red-zone work and his depth-chart spot. Treat it as a name to research.</div>
        )}
      </div>
      <div>
        <div className="dk">What builds the number</div>
        <Bar label="Hit rate" v={p.eff_hit!=null?p.eff_hit:p.season_hit} val={`${Math.round((p.eff_hit!=null?p.eff_hit:p.season_hit)*100)}%`} />
        <Bar label="Red zone" v={a} val={`${(p.rz_pg||0).toFixed(1)}/g`} />
        <Bar label="Goal line" v={b} val={`${(p.gl_pg||0).toFixed(1)}/g`} />
        <Bar label="Team total" v={itt} val={p.itt!=null?p.itt.toFixed(1):'—'} />
        <div className="tagrow">
          <span className="tag">first TD {Math.round((p.prob_first||0)*100)}%</span>
          <span className="tag">2+ TDs {Math.round((p.prob_two||0)*100)}%</span>
          {p.role && <span className="tag">{p.role}</span>}
        </div>
        {m && m.defY!=null && (
          <div className="dk" style={{marginTop:10}}>
            {DATA.meta.season}, from the Team Stats tab: <b style={{color:'var(--ink2)'}}>{p.team}</b> produced {m.offY.toFixed(1)} {m.label} yds/g to {p.pos}s &middot;{' '}
            <b style={{color:'var(--ink2)'}}>{p.next_opp}</b> allowed {m.defY.toFixed(1)}/g
            {m.soft ? ` — ${ord(m.soft)} softest to ${p.pos} in the league` : ''}.
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Reusable checkbox multi-select (Teams / Tags filters) ============
function MultiSelect({ label, options, selected, onToggle, onAll, onNone, allLabel }) {
  const [open, setOpen] = useState(false);
  const n = selected.size;
  const total = options.length;
  const buttonText = n === total ? (allLabel || `All ${label.toLowerCase()}`) : `${n} selected`;
  return (
    <div className="msWrap">
      <button className="msBtn" onClick={()=>setOpen(o=>!o)}>{buttonText}<span className="msChevron">{open?'▴':'▾'}</span></button>
      {open && (
        <>
          <div className="msScrim" onClick={()=>setOpen(false)} />
          <div className="msPanel">
            <div className="msHead">
              <span>{label.toUpperCase()}</span>
              <span className="msHeadLinks">
                <button onClick={onAll}>All</button>&middot;<button onClick={onNone}>None</button>
              </span>
            </div>
            <div className="msList">
              {options.map(o => (
                <label className="msRow" key={o.value}>
                  <input type="checkbox" checked={selected.has(o.value)} onChange={()=>onToggle(o.value)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
const TAG_OPTIONS = [
  { value: 'Goal-line role', label: 'Goal-line role' },
  { value: 'Red-zone volume', label: 'Red-zone volume' },
  { value: 'Proven scorer', label: 'Proven scorer' },
  { value: 'Soft matchup', label: 'Soft matchup' },
  { value: 'Tough matchup', label: 'Tough matchup' },
  { value: 'High-scoring game', label: 'High-scoring game' },
  { value: 'Low-scoring game', label: 'Low-scoring game' },
  { value: 'New team', label: 'New team' },
  { value: 'Role projection', label: 'Role projection' },
  { value: 'Small sample', label: 'Small sample' },
];

function PredictionsTab({ DATA, CURVE, CALP, CAL, CALPP, CALP2 }) {
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('ALL');
  const [rankBy, setRankBy] = useState('model');
  const [hideUnavail, setHideUnavail] = useState(true);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const [odds, setOdds] = useState(() => {
    const o = {};
    DATA.players.forEach(p => { if (p.dk_odds != null) o[p.name] = String(p.dk_odds); });
    return o;
  });
  const [openRow, setOpenRow] = useState(null);
  const [W, setW] = useState({ wSea: 32, wRZ: 32, wYD: 20, wTT: 16 });
  const allTeams = useMemo(() => [...new Set(DATA.players.map(p=>p.team))].sort().map(t=>({value:t,label:t})), [DATA]);
  const [teamSel, setTeamSel] = useState(() => new Set(allTeams.map(t=>t.value)));
  const [tagSel, setTagSel] = useState(() => new Set(TAG_OPTIONS.map(t=>t.value)));
  const toggleSet = (setter) => (v) => setter(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });

  const hidden = DATA.players.filter(p => p.rostered === false).length;

  const rows = useMemo(() => {
    let list = DATA.players.filter(p => {
      if (hideUnavail && p.rostered === false) return false;
      if (pos !== 'ALL' && p.pos !== pos) return false;
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (!teamSel.has(p.team)) return false;
      if (tagSel.size < TAG_OPTIONS.length) {
        const rlabels = reasons(p, matchupOf(p, DATA)).map(r=>r.label);
        if (!rlabels.some(l => tagSel.has(l))) return false;
      }
      return true;
    }).map(p => ({ p, ...scoreOf(p, W, CALP, CAL, CALPP, CALP2), mpct: matchupPct(p) }));
    // Order by the ranking track, not the price. The two now come from
    // different amounts of shrinkage, and the ranking is the one with a graded
    // record behind it, so it decides who is on the board. The probability is
    // what that player is worth, not where he sits.
    if (rankBy === 'matchup') list.sort((a,b) => b.mpct - a.mpct || b.score - a.score);
    else list.sort((a,b) => b.score - a.score || b.prob - a.prob);
    return list;
  }, [DATA, q, pos, rankBy, hideUnavail, W, teamSel, tagSel]);

  function applyOdds() {
    const r = parseOdds(pasteText, DATA.players);
    setOdds(prev => ({ ...prev, ...r.applied.anytime }));
    const n = Object.keys(r.applied.anytime).length;
    let msg = n ? `Priced ${n}.` : 'Nothing recognized as a price.';
    if (r.unmatched.length) msg += ` No match: ${r.unmatched.slice(0,4).join(', ')}${r.unmatched.length>4?' +'+(r.unmatched.length-4):''}.`;
    setPasteMsg(msg);
  }

  return (
    <section className="view on">
      <div className="bar">
        <input className="find" placeholder="Search player or team" value={q} onChange={e=>setQ(e.target.value)} />
        <select value={pos} onChange={e=>setPos(e.target.value)}>
          <option value="ALL">All positions</option><option value="RB">RB</option>
          <option value="WR">WR</option><option value="TE">TE</option><option value="QB">QB</option>
        </select>
        <MultiSelect label="Teams" options={allTeams} selected={teamSel} onToggle={toggleSet(setTeamSel)}
          onAll={()=>setTeamSel(new Set(allTeams.map(t=>t.value)))} onNone={()=>setTeamSel(new Set())} allLabel="All teams" />
        <MultiSelect label="Tags" options={TAG_OPTIONS} selected={tagSel} onToggle={toggleSet(setTagSel)}
          onAll={()=>setTagSel(new Set(TAG_OPTIONS.map(t=>t.value)))} onNone={()=>setTagSel(new Set())} allLabel="All tags" />
        <select value={rankBy} onChange={e=>setRankBy(e.target.value)}>
          <option value="model">Sort: Model %</option><option value="matchup">Sort: Matchup %</option>
        </select>
        <span className="grow" />
        <button className="link" onClick={()=>{setShowPaste(false);setShowAdjust(v=>!v);}}>Adjust weights</button>
        <button className="link" onClick={()=>{setShowAdjust(false);setShowPaste(v=>!v);}}>Paste odds</button>
      </div>
      {showAdjust && (
        <div className="adjust on">
          {[['Season hit rate','wSea'],['Red-zone volume','wRZ'],['Yardage volume','wYD'],['Team total','wTT']].map(([label,key]) => (
            <div className="adj" key={key}>
              <div className="adjtop">{label} <b>{W[key]}</b></div>
              <input type="range" min="0" max="100" value={W[key]} onChange={e=>setW(w=>({...w,[key]:+e.target.value}))} />
            </div>
          ))}
        </div>
      )}
      {showPaste && (
        <div className="adjust on">
          <div style={{width:'100%'}}>
            <textarea style={{width:'100%',minHeight:96,resize:'vertical',fontFamily:'var(--num)',fontSize:12,lineHeight:1.5,padding:'9px 11px',border:'1px solid var(--line)',borderRadius:6,background:'var(--sunk)',color:'var(--ink)'}}
              placeholder="Paste the touchdown scorer board from DraftKings."
              value={pasteText} onChange={e=>setPasteText(e.target.value)} />
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:9}}>
              <button className="primary" onClick={applyOdds}>Apply</button>
              <button className="link" onClick={()=>{setPasteText('');setOdds({});setPasteMsg('Cleared.');}}>Clear</button>
              <span className="meta">{pasteMsg}</span>
            </div>
          </div>
        </div>
      )}
      <div className="board">
        {rows.map((it,i) => {
          const p = it.p, m = matchupOf(p, DATA);
          const col = p.rostered===false ? '#9CA3AF' : (DATA._tc(p.team));
          const reasonList = reasons(p, m);
          const shown = reasonList.slice(0,2), extra = reasonList.slice(2);
          const isOpen = openRow === p.name;
          const oddsVal = odds[p.name];
          const b = betOf(p, it.prob, oddsVal, CURVE);
          const trueP = trueRate(it.prob*100, CURVE)/100;
          const fairOdds = probToAmerican(trueP);
          const goodCount = reasonList.filter(r=>r.tone==='good').length;
          // Left rail: green when the model is above the posted price, red when below,
          // neutral when the player has no price yet. Team color still drives the detail bars.
          return (
            <div className={'pcard'+(p.rostered===false?' dim':'')} key={p.name}
              style={{'--tc':col, '--eg': b ? (b.value>2?'var(--pos)':(b.value<-2?'var(--neg)':'var(--line)')) : 'var(--line)'}}>
              <div className="pcardTop" onClick={()=>setOpenRow(isOpen?null:p.name)}>
                <span className="rk">{i+1}</span>
                {DATA._crest(p.team)}
                <div className="pcardMid">
                  <div className="pcardName"><b>{p.name}</b><span className="posPill">{p.pos}</span></div>
                  <div className="pcardMeta">{p.team}{p.next_opp?` vs ${p.next_opp}`:''}{p.tds!=null?` · ${p.tds} TD${p.tds===1?'':'s'} in ${p.games}g`:''}</div>
                  <div className="chipRow">
                    {shown.map((r,idx)=><Chip r={r} key={idx} />)}
                    {extra.length>0 && <button className="moreChip" onClick={(e)=>{e.stopPropagation();setOpenRow(p.name);}}>+{extra.length} more</button>}
                  </div>
                </div>
                <div className="pcardScore">
                  <div className={'pv2'+(it.prob<0.3?' cold':'')}>{Math.round(it.prob*100)}%</div>
                  <div className="pv2sub">2+ {Math.round((p.prob_two||0)*100)}%</div>
                </div>
              </div>
              <div className="pcardFoot">
                <span>Score <b>{it.score}</b> <i>({goodCount}/{reasonList.length})</i></span>
                <span>Fair odds <b>{fairOdds!=null?(fairOdds>0?'+':'')+fairOdds:'—'}</b></span>
                <span className="priceCell" onClick={e=>e.stopPropagation()}>
                  Book <input className={'odds'+(b?(b.value>2?' p':(b.value<-2?' n':'')):'')}
                    placeholder="odds" value={oddsVal||''}
                    onChange={e=>setOdds(o=>({...o,[p.name]:e.target.value}))} />
                </span>
                <span className={b?(b.value>2?'edge p':(b.value<-2?'edge n':'edge')):'edge'}>
                  Edge{' '}
                  {b ? <>
                    {Math.abs(b.value)>2 && <span className="arrow">{b.value>0?'▲':'▼'}</span>}
                    {b.value>=0?'+':''}{b.value.toFixed(1)}%
                  </> : '—'}
                </span>
              </div>
              {isOpen && <DetailPanel p={p} DATA={DATA} reasonList={reasonList} />}
            </div>
          );
        })}
      </div>
      <button className="link" style={{marginTop:14}} onClick={()=>setHideUnavail(v=>!v)}>
        {hideUnavail ? `Show ${hidden} unavailable players` : 'Hide unavailable players'}
      </button>
    </section>
  );
}

// ============ Alerts banner (surfaces exactly the CAR/IND-style situations) ============
function Alerts({ DATA }) {
  const oppOf = {};
  (DATA.games||[]).forEach(g => { oppOf[g.home]=g.away; oppOf[g.away]=g.home; });
  const rows = [];
  Object.keys(DATA.teams).forEach(t => {
    const cd = DATA.teams[t].cur_def;
    if (!cd || !cd.G) return;
    const opp = oppOf[t];
    if (!opp) return;
    const G = cd.G, rb = cd.pos.RB || {};
    const wt_reY = (cd.pos.WR?.reY||0) + (cd.pos.TE?.reY||0);
    const wt_reT = (cd.pos.WR?.reT||0) + (cd.pos.TE?.reT||0);
    if ((rb.ruT||0)/G >= 1.5) rows.push({ opp, team: t, phase:'RB', stat: `allowed ${rb.ruT} rush TD on ${rb.ruY} yds in ${G} g` });
    if (wt_reT/G >= 1.5) rows.push({ opp, team: t, phase:'WR/TE', stat: `allowed ${wt_reT} rec TD on ${wt_reY} yds in ${G} g` });
  });
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const shown = rows.slice(0, 5);
  // Collapsed by default: this is context, and on a phone it otherwise fills
  // the screen before the first pick.
  return (
    <div className="alerts">
      <button className="noteHead" onClick={()=>setOpen(v=>!v)}>
        <span><b>{shown.length}</b> soft defensive matchup{shown.length===1?'':'s'}{' '}
          {(DATA.meta.weeks_played || 0) > 1 ? `through Week ${DATA.meta.weeks_played}` : 'from Week 1'}</span>
        <span className="noteChev">{open ? '−' : '+'}</span>
      </button>
      {open && <>
        <div className="dk" style={{margin:'9px 0 8px'}}>Defenses that got hit hard in a small sample -- not in the score, since one blowout can look like this from garbage time alone. Worth your own look before you bet the opponent.</div>
        {shown.map((r,i) => (
          <div className="alertrow" key={i}><b>{r.opp}</b>'s {r.phase} vs <b>{r.team}</b>, who {r.stat}</div>
        ))}
      </>}
    </div>
  );
}

// ============ Matchups tab ============
function MatchupsTab({ DATA, CALP, CAL, CALPP, CALP2 }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('td');
  const W = { wSea:32, wRZ:32, wYD:20, wTT:16 };
  function tdEnv(t) { const o=DATA.teams[t]?.cur_off; return o&&o.G ? o.total.aTD/o.G : null; }
  function tdAllowed(t) { const d=DATA.teams[t]?.cur_def; return d&&d.G ? d.total.aTD/d.G : null; }
  const games = useMemo(() => {
    let list = (DATA.games||[]).map(g => {
      const parts = [tdEnv(g.away), tdAllowed(g.home), tdEnv(g.home), tdAllowed(g.away)].filter(v=>v!=null);
      const env = parts.length ? parts.reduce((a,b)=>a+b,0)/parts.length : null;
      return { ...g, env };
    });
    if (q) list = list.filter(g => (g.home+g.away).toLowerCase().includes(q.toLowerCase()));
    list.sort((a,b) => {
      if (a.env==null && b.env==null) return 0;
      if (a.env==null) return 1; if (b.env==null) return -1;
      return sort==='tdlow' ? a.env-b.env : b.env-a.env;
    });
    return list;
  }, [DATA, q, sort]);
  function topFor(t) {
    return DATA.players.filter(p=>p.team===t && p.rostered!==false)
      .map(p=>({p, ...scoreOf(p,W,CALP,CAL,CALPP,CALP2)})).sort((a,b)=>b.prob-a.prob).slice(0,3);
  }
  return (
    <section className="view on">
      <div className="bar">
        <input className="find" placeholder="Filter matchup or team" value={q} onChange={e=>setQ(e.target.value)} />
        <select value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="td">Highest TD environment</option><option value="tdlow">Lowest TD environment</option>
        </select>
      </div>
      <div className="board">
        {games.map((g,i) => {
          const fav = g.spread_home!=null ? (g.spread_home<0 ? `${g.home} ${g.spread_home}` : `${g.away} ${-g.spread_home}`) : '';
          return (
            <div className="gm" key={i}>
              <div className="gmh">
                <div className="gmt">{g.away}<em>at</em>{g.home}</div>
                <div className="gml">{fav}{g.ou?`  o/u ${g.ou}`:''}</div>
              </div>
              <div className="dk" style={{padding:'9px 13px 0'}}>
                {g.env!=null ? <b style={{color:'var(--accent)'}}>TD environment {g.env.toFixed(2)}/g</b> : <span>pending Week 1 data</span>}
              </div>
              <div className="gmb">
                {[g.away, g.home].map(t => (
                  <div className="sd" key={t} style={{'--tc':DATA._tc(t)}}>
                    <div className="sdh">{DATA._crest(t)}<span>{t}</span></div>
                    {topFor(t).map(it => (
                      <div className="pr" key={it.p.name}><span>{it.p.name}</span><span>{Math.round(it.prob*100)}%</span></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============ Team Stats tab ============
// At team level a receiving TD and a passing TD are the same score counted from
// both ends, so the Pass TD column is dropped there rather than printing the
// identical number twice. Filtered by position the two differ (a QB's passing
// TDs against his receiving TDs), so it comes back.
const OCOLS_ALL = [['ruY','Rush yds'],['ruT','Rush TD'],['reY','Rec yds'],['reT','Rec TD']];
const DCOLS_ALL = [['ruY','Rush yds all.'],['ruT','Rush TD all.'],['reY','Rec yds all.'],['reT','Rec TD all.']];
const OCOLS = [...OCOLS_ALL, ['paT','Pass TD']];
const DCOLS = [...DCOLS_ALL, ['paT','Pass TD all.']];
function TeamStatsTab({ DATA }) {
  const [q, setQ] = useState('');
  const [side, setSide] = useState('both');
  const [posf, setPosf] = useState('ALL');
  const src = 'cur'; // pinned: see the note in the control bar below
  const [pg, setPg] = useState(false);

  const rows = useMemo(() => {
    const oKey = src==='cur' ? 'cur_off' : 'off', dKey = src==='cur' ? 'cur_def' : 'def';
    let list = Object.keys(DATA.teams).map(t => {
      const on = DATA.teams[t][oKey], dn = DATA.teams[t][dKey];
      const row = { team: t, oG: on&&on.G, dG: dn&&dn.G };
      const osrc = on ? (posf==='ALL'?on.total:on.pos[posf]) : null;
      const dsrc = dn ? (posf==='ALL'?dn.total:dn.pos[posf]) : null;
      OCOLS.forEach(([k]) => row['o_'+k] = osrc ? (pg&&on.G ? +(osrc[k]/on.G).toFixed(2) : osrc[k]) : null);
      DCOLS.forEach(([k]) => row['d_'+k] = dsrc ? (pg&&dn.G ? +(dsrc[k]/dn.G).toFixed(2) : dsrc[k]) : null);
      return row;
    }).filter(r => r.oG || r.dG);
    // Per-column heat, ranked across the whole league before any search filter
    // so the colours don't shift when you type. Convention is the plain one:
    // green means the team is doing well, red means it isn't. Producing a lot
    // is good; allowing a lot is not.
    const heat = {};
    const rank = (key, goodIsHigh) => {
      const vals = list.map(r => r[key]).filter(v => v != null).sort((a,b) => b-a);
      if (vals.length < 10) return;
      const hi = vals[4], lo = vals[vals.length-5], mid = vals[Math.floor(vals.length/2)];
      // One week in, whole columns are ties -- the fifth-best rush TD total can
      // be the median. Requiring a value to beat the median as well as make the
      // top five keeps the colour on teams that actually stand out.
      list.forEach(r => {
        const v = r[key];
        if (v == null) return;
        if (v >= hi && v > mid) heat[r.team+key] = goodIsHigh ? 'up' : 'down';
        else if (v <= lo && v < mid) heat[r.team+key] = goodIsHigh ? 'down' : 'up';
      });
    };
    OCOLS.forEach(([k]) => rank('o_'+k, true));
    DCOLS.forEach(([k]) => rank('d_'+k, false));
    list.forEach(r => { r._heat = heat; });

    if (q) list = list.filter(r => r.team.includes(q.toUpperCase()));
    const sortCol = side==='pd' ? 'd_ruT' : 'o_ruT';
    list.sort((a,b) => (b[sortCol]||0) - (a[sortCol]||0));
    return list;
  }, [DATA, q, side, posf, src, pg]);

  const showO = side==='po' || side==='both', showD = side==='pd' || side==='both';
  const ocols = posf === 'ALL' ? OCOLS_ALL : OCOLS, dcols = posf === 'ALL' ? DCOLS_ALL : DCOLS;
  return (
    <section className="view on">
      <div className="bar">
        <input className="find" placeholder="Search team" value={q} onChange={e=>setQ(e.target.value)} />
        <select value={side} onChange={e=>setSide(e.target.value)}>
          <option value="both">Produced + Allowed</option><option value="po">Produced</option><option value="pd">Allowed</option>
        </select>
        <select value={posf} onChange={e=>setPosf(e.target.value)}>
          <option value="ALL">Team total</option><option value="RB">RB</option>
          <option value="WR">WR</option><option value="TE">TE</option><option value="QB">QB</option>
        </select>
        {/* The prior-season source was dropped at the 2026-only cutover -- it now
            carries the same numbers as the current table, so a toggle between the
            two only offered a misleading label. Pinned to the current season. */}
        <span className="grow" />
        <button className={'link'+(pg?' on':'')} onClick={()=>setPg(v=>!v)}>Per game</button>
      </div>
      <div className="heatKey">
        Top and bottom five in each column. <span className="up">Green</span> is good for that team,{' '}
        <span className="down">red</span> is bad — so the red in the <i>allowed</i> columns is the soft matchup you're hunting.
      </div>
      <div className="tbl">
        <table>
          <thead><tr>
            <th className="l">Team</th>
            {showO && ocols.map(([k,l])=><th key={k}>{l}</th>)}
            {showD && dcols.map(([k,l])=><th key={k}>{l}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.team}>
                <td className="l"><div className="tc">{DATA._crest(r.team)}<span style={{color:DATA._tc(r.team)}}>{r.team}</span></div></td>
                {showO && ocols.map(([k])=><td key={k} className={r._heat[r.team+'o_'+k]||''}>{r['o_'+k]!=null?r['o_'+k]:'—'}</td>)}
                {showD && dcols.map(([k])=><td key={k} className={r._heat[r.team+'d_'+k]||''}>{r['d_'+k]!=null?r['d_'+k]:'—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============ Player Stats tab (real Week 1 box scores, full pool) ============
const PSCOLS = {
  QB: [['pass_yds','Pass Yds'],['att','Att'],['cmp','Cmp'],['pass_td','Pass TD'],['ints','INT'],['rush_yds','Rush Yds'],['rush_td','Rush TD']],
  RB: [['rush_yds','Rush Yds'],['carries','Att'],['rush_td','Rush TD'],['tgt','Tgt'],['rec','Rec'],['rec_yds','Rec Yds'],['rec_td','Rec TD']],
  WR: [['tgt','Tgt'],['rec','Rec'],['rec_yds','Rec Yds'],['rec_td','Rec TD']],
  TE: [['tgt','Tgt'],['rec','Rec'],['rec_yds','Rec Yds'],['rec_td','Rec TD']],
};
const PSPRIMARY = { QB:'pass_yds', RB:'rush_yds', WR:'rec_yds', TE:'rec_yds' };
function PlayerStatsTab({ DATA }) {
  const [pos, setPos] = useState('RB');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('primary');
  const [dir, setDir] = useState(-1);
  const box = DATA.player_box || [];
  const rows = useMemo(() => {
    let list = box.filter(p => p.pos === pos);
    if (q) { const ql=q.toLowerCase(); list = list.filter(p => (p.name+' '+p.team).toLowerCase().includes(ql)); }
    const key = sort==='primary' ? PSPRIMARY[pos] : (sort==='td' ? (pos==='QB'?'pass_td':pos==='RB'?'rush_td':'rec_td') : sort);
    list = list.slice().sort((a,b) => {
      if (sort==='name') return dir * a.name.localeCompare(b.name);
      return dir===-1 ? (b[key]||0)-(a[key]||0) : (a[key]||0)-(b[key]||0);
    });
    return list;
  }, [box, pos, q, sort, dir]);
  const cols = PSCOLS[pos];
  return (
    <section className="view on">
      <div className="bar">
        <div className="seg">
          {['RB','QB','WR','TE'].map(p => <button key={p} className={pos===p?'on':''} onClick={()=>setPos(p)}>{p}</button>)}
        </div>
        <select value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="primary">Primary yards</option><option value="td">TDs</option><option value="name">Player (A-Z)</option>
        </select>
        <button className="link" onClick={()=>setDir(d=>-d)}>{dir===-1?'Highest → lowest':'Lowest → highest'}</button>
        <span className="grow" />
        <input className="find" placeholder="Search player or team" value={q} onChange={e=>setQ(e.target.value)} />
      </div>
      <div className="dk" style={{marginBottom:10}}>Week 1 2026, full player pool -- every {pos} with a stat line, not a hand-picked sample.</div>
      <div className="tbl">
        <table>
          <thead><tr>
            <th className="l">#</th><th className="l">Player</th><th className="l">Team</th><th className="l">Opp</th>
            {cols.map(([k,l])=><th key={k}>{l}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((p,i) => (
              <tr key={p.name+p.team}>
                <td className="l">{i+1}</td>
                <td className="l"><b>{p.name}</b></td>
                <td className="l">{p.team}</td>
                <td className="l">{p.opp||'—'}</td>
                {cols.map(([k])=><td key={k}>{p[k]||0}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4+cols.length} className="empty">No stats match.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Each category as a head-to-head edge: this side's offence percentile minus the
// other side's defence percentile. Bars point toward whoever holds the edge.
// Anything inside the even band is called even rather than dressed up as a lean,
// because a 3-point gap on a three-week sample is not a real advantage.
function MatchupEdges({ g, DATA, band }) {
  if (!g || !g.matchup) return null;
  const m = g.matchup, MAX = 100;
  const bar = e => {
    const w = Math.min(Math.abs(e), MAX) / MAX * 50;
    const pos = e > 0;   // positive favours the away team, drawn to the left
    return (
      <div className="mxTrack">
        <div className="mxZero" />
        <div className={'mxFill ' + (Math.abs(e) <= band ? 'mxEven' : (pos ? 'mxA' : 'mxH'))}
             style={pos ? { right: '50%', width: w + '%' } : { left: '50%', width: w + '%' }} />
      </div>
    );
  };
  return (
    <div className="mxBox">
      <div className="mxHead">
        <span><b>{m.away_areas}</b> areas favour {g.away}</span>
        <span><b>{m.even_areas}</b> closely matched · {band}-point threshold</span>
        <span><b>{m.home_areas}</b> favour {g.home}</span>
      </div>
      <div className="mxSub">
        <span>&larr; {g.away}</span>
        <span>Edge · percentile points</span>
        <span>{g.home} &rarr;</span>
      </div>
      {m.rows.map(r => (
        <div className="mxRow" key={r.cat}>
          <div className="mxCat">{r.label}</div>
          {bar(r.edge)}
          <div className="mxVal">
            <div className={r.favors === g.away ? 'edge p' : (r.favors === g.home ? 'edge n' : '')}>
              {r.favors || 'Even'}
            </div>
            <div className="gml">{Math.abs(r.edge).toFixed(1)} pts</div>
          </div>
        </div>
      ))}
      <div className="sub" style={{ marginTop: 8 }}>
        Offence percentile against the opposing defence percentile, both scaled across all 32
        teams. These are statistical comparisons, not scoring margins or win probabilities.
      </div>
    </div>
  );
}

// nflverse states a spread from the home team's side, positive when the home
// team is favoured. Bettors read it as a team and a number, so it is rendered
// that way: whoever is laying the points, followed by what they are laying.
function lineStr(g, sp) {
  if (sp == null) return '—';
  if (Math.abs(sp) < 0.05) return 'PK';
  return sp > 0 ? `${g.home} -${sp.toFixed(1)}` : `${g.away} -${Math.abs(sp).toFixed(1)}`;
}

// ============ Games tab ============
// Opponent-adjusted team ratings, a projected score, and a side for every game
// on the slate. The model spread is rescaled to the market's own spread of
// numbers before a pick comes off it -- without that, a three-week fit produces
// the market shrunk by about a third, which lands inside the line and takes the
// underdog nearly every time for no reason but arithmetic. Graded walking
// forward over 416 games the picks go 206-206-4, dead even, still under the
// 52.38% break-even. Saying so on the page is the difference between an
// analytics product and a tout.
function GamesTab({ GAMES, DATA }) {
  const [sort, setSort] = useState('net');
  const [open, setOpen] = useState(0);
  if (!GAMES || !GAMES.games || !GAMES.games.length) {
    return <div className="empty">No game projections in this build. Run <code>games.py</code>.</div>;
  }
  const m = GAMES.meta || {}, bt = m.backtest || {};
  const ratings = (GAMES.ratings || []).slice().sort(
    (a, b) => sort === 'off' ? b.off - a.off : (sort === 'def' ? a.def - b.def : b.net - a.net));
  const sgn = v => (v > 0 ? '+' : '') + v.toFixed(1);
  const withPick = GAMES.games.filter(x => x.ats_pick).length;
  const dogs = withPick ? GAMES.games.filter(x => x.pick_is_dog).length : null;

  return (
    <>
      <div className="calNote" style={{ marginBottom: 12 }}>
        <div className="noteHead"><b>Read the picks with the record next to them</b></div>
        <div className="noteBody" style={{ display: 'block' }}>
          Ratings solve offence, defence and home edge together by ridge least squares over every
          completed game, so a soft schedule cannot flatter a team. Projected scores land within
          about {bt.score_mae ? bt.score_mae.toFixed(1) : '7.4'} points a team. The model
          line is put on the same scale as the market's before a side comes off it, so a pick
          is a real disagreement rather than a smaller version of the same number.
          {' '}<b>Against the spread the model is {bt.ats || '206-206-4 (50.0%)'} over {bt.games || 416} games</b>,
          graded walking forward, where break-even is {bt.ats_breakeven || '52.38% at -110'}.
          {' '}That is above break-even, by about one and a half standard errors on a sample
          this size, and it held at {bt.by_season || '56.1% and 56.0%'} in the two seasons
          separately. Promising is not proven. These are posted as the model's opinion, not
          as advice, and the live record above is the one that counts.
          {dogs != null && (
            <> This week it takes the underdog in <b>{dogs} of {withPick}</b> games and the
            favourite in the other {withPick - dogs}. A roughly even split is what a working
            model looks like. If you ever see it on the dog in nearly every game, something has
            gone wrong with the scale and the picks are not opinions.</>
          )}
        </div>
      </div>

      <div className="slate">
        {GAMES.games.map((g, i) => (
          <div className={'gm' + (open === i ? ' gmOn' : '')} key={i}
               onClick={() => setOpen(i)} style={{ cursor: 'pointer' }}>
            <div className="gmh">
              <span className="gmt">{g.away}<em>@</em>{g.home}</span>
              <span className="gml">
                {g.spread_line != null ? `line ${sgn(g.spread_line)}` : 'no line'}
                {g.total_line != null ? ` · o/u ${g.total_line}` : ''}
              </span>
            </div>
            <div className="gmb">
              {[[g.away, g.proj_away], [g.home, g.proj_home]].map(([t, pts], k) => (
                <div className="sd" key={k}>
                  <div className="sdh">{DATA._crest(t)}<b>{t}</b></div>
                  <div className="pcardScore" style={{ fontSize: 22 }}>{pts.toFixed(1)}</div>
                </div>
              ))}
            </div>
            <div className="gmGrid">
              <div><span className="gmk">Market line</span>
                <b>{g.spread_line != null ? lineStr(g, g.spread_line) : '—'}</b></div>
              <div><span className="gmk">Model line</span>
                <b>{lineStr(g, g.proj_spread)}</b></div>
              <div><span className="gmk">Market total</span><b>{g.total_line ?? '—'}</b></div>
              <div><span className="gmk">Model total</span><b>{g.proj_total.toFixed(1)}</b></div>
            </div>
            {g.ats_pick && (
              <div className="gmPick">
                <span className="gmk">Model pick</span>
                <b>{g.ats_pick}</b>
                {g.ou_pick && <span className="gml"> · {g.ou_pick} {g.total_line}</span>}
              </div>
            )}
            <div className="gmWin">
              <span className="gml">Projected winner</span>
              <b>{g.projected_winner || '—'}</b>
            </div>
          </div>
        ))}
      </div>

      <MatchupEdges g={GAMES.games[open]} DATA={DATA} band={GAMES.even_band || 5} />

      <div className="seg" style={{ margin: '18px 0 8px' }}>
        {[['net', 'Net'], ['off', 'Offence'], ['def', 'Defence']].map(([k, l]) => (
          <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>
        ))}
      </div>
      <div className="sub" style={{ marginBottom: 8 }}>
        Points per game better than league average ({m.league_avg_points} per team).
        Defence is negative when a team concedes fewer than average. Home edge {sgn(m.home_edge || 0)}.
        Shrunk toward average by games played, so after {m.weeks_played} weeks every number is
        deliberately conservative.
      </div>
      <table className="tbl">
        <thead><tr><th>Team</th><th>Off</th><th>Def</th><th>Net</th><th>GP</th></tr></thead>
        <tbody>
          {ratings.map(r => (
            <tr key={r.team}>
              <td><div className="sdh" style={{ margin: 0 }}>{DATA._crest(r.team)}<b>{r.team}</b></div></td>
              <td className={r.off > 0 ? 'edge p' : 'edge n'}>{sgn(r.off)}</td>
              <td className={r.def < 0 ? 'edge p' : 'edge n'}>{sgn(r.def)}</td>
              <td className={r.net > 0 ? 'edge p' : 'edge n'}>{sgn(r.net)}</td>
              <td>{r.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ============ Root App ============
function App({ initialData }) {
  const [DATA, setData] = useState(initialData);
  const [tab, setTab] = useState('picks');

  useEffect(() => {
    try {
      fetch('./data.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setData(withHelpers(d)); })
        .catch(()=>{});
    } catch (e) { /* no fetch available -- keep the embedded data */ }
  }, []);

  const meta = DATA.meta || {};
  const CURVE = meta.calibration_curve || [[10.3,9.7],[19.2,22.3],[29.4,33.5],[39.6,38.0],[49.8,43.2],[62.1,58.3]];
  const CALP = meta.calib_pos || {};
  const CAL = meta.calib || { b0:-2.816, b1:4.229 };
  // Present only on files built after the ranking/pricing split; absent on an
  // older data.json, in which case scoreOf falls back to the single track.
  const CALPP = meta.calib_pos_prob || null;
  const CALP2 = meta.calib_prob || null;

  return (
    <>
      <Header meta={meta} />
      <Ticker DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
      <div className="wrap">
        <Tabs tab={tab} setTab={setTab} />
        {tab === 'picks' && (<>
          <CalibrationNote DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
          <Alerts DATA={DATA} />
          <PredictionsTab DATA={DATA} CURVE={CURVE} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />
        </>)}
        {tab === 'card' && <CardTab DATA={DATA} />}
        {tab === 'games' && <GamesTab GAMES={DATA.games_model} DATA={DATA} />}
        {tab === 'matchups' && <MatchupsTab DATA={DATA} CALP={CALP} CAL={CAL} CALPP={CALPP} CALP2={CALP2} />}
        {tab === 'team' && <TeamStatsTab DATA={DATA} />}
        {tab === 'pstats' && <PlayerStatsTab DATA={DATA} />}
        <Notes meta={meta} />
      </div>
    </>
  );
}
function Notes({ meta }) {
  const bt = meta.backtest || {};
  const lr = meta.live_record;
  return (
    <div className="foot">
      {lr && lr.weeks && lr.weeks.length > 0 && (
        <p><b>Live record, graded week by week.</b>{' '}
          {lr.weeks.map(w =>
            `Week ${w.week}: ${w.top12}/${w.top12_of} on the top 12` +
            (w.base_rate ? ` against a ${Math.round(w.base_rate*100)}% base rate` : '')
          ).join('. ')}
          . Season to date <b>{lr.totals.top12}/{lr.totals.top12_of}</b>{' '}
          ({Math.round(lr.totals.top12 / lr.totals.top12_of * 100)}%) against a backtest of{' '}
          {Math.round((bt.top12_hit||0)*100)}%. Graded off the board as it stood that week, with
          players who did not take a snap dropped rather than counted as misses.</p>
      )}
      <p><b>What this is.</b> Season hit rate, red-zone and goal-line volume, total yards per game and the Vegas implied team total. Fitted on a full prior season, graded on the next -- top-12 weekly picks hit {Math.round((bt.top12_hit||0)*100)}% against {Math.round((bt.baseline_top12||0)*100)}% for a naive baseline, out of sample. This is <b>Model %</b>, the number priced against.</p>
      <p><b>Matchup % is different.</b> Your own production this season multiplied by how much your Week 2 opponent has allowed -- transparent, not backtested. Sort by whichever you trust more.</p>
      <p><b>What a player's numbers are counted from.</b> The production itself is 2026 only: touches, red-zone work and yards all come from games played this season. Two or three games is a tiny sample, so each rate is pulled toward a baseline, more heavily the fewer games played. That baseline is <b>that player's own 2025 rate</b>, not the average of everyone at his position. The difference is not cosmetic: with the position average, a starter who has not scored yet in September is indistinguishable from any other player at his position, and a backup who vultured one score outranks him. Graded walking forward on 2024 and 2025, anchoring on the player's own prior season is worth <b>17.7 points of top-12 hit rate across weeks 1 to 4</b> and nothing at all from week 5 on, by which point the season speaks for itself. A player with no prior season, a rookie, still falls back to the position average. The <b>TD counter</b> is a plain running total, no shrinkage.</p>
      <p><b>Two things it tempers.</b> Movers get pulled toward a positional baseline; rookies are estimated from the role they inherit. Availability is live.</p>
      <p><b>Reading the color.</b> Green is the model above the posted price, red is below. The rail down the left of each card and the ticker up top both run on that one number: model probability minus the book's implied probability.</p>
      <p className="footBrand">TransferSportal &middot; not financial advice</p>
    </div>
  );
}
