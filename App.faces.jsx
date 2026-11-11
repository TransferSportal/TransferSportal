// One headshot for any player, NBA or NFL, from the images embedded in the page.
// No hotlinks: the published page blocks outside image hosts. With no image it
// falls back to a plain initials disc, so a missing shot never leaves a hole.
function Face({ nba, id, name, team, size, round }) {
  const sz = size || 28;
  const heads = nba ? (window.NBAIMG && window.NBAIMG.heads) : (window.NFLIMG && window.NFLIMG.heads);
  const src = heads && heads[nba ? id : (name + '|' + team)];
  const r = round === false ? 8 : '50%';
  const box = { width: sz, height: sz, borderRadius: r, flex: 'none', background: 'rgba(255,255,255,.08)', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle' };
  if (src) return <span style={box}><img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} onError={e => { e.currentTarget.style.display = 'none'; }} /></span>;
  const ini = (name || '').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
  return <span style={Object.assign({}, box, { fontSize: Math.max(9, Math.round(sz / 3)), fontWeight: 700, color: 'var(--ink2)' })}>{ini}</span>;
}
