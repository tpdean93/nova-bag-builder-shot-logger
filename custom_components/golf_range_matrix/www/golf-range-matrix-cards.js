const novaEsc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const novaState = (hass, entity) => hass?.states?.[entity];
const novaAttrs = (hass, entity) => novaState(hass, entity)?.attributes || {};
const novaValue = (hass, entity) => novaState(hass, entity)?.state;
const novaCall = (hass, service, data = {}) => hass.callService('golf_range_matrix', service, data);
const novaDefine = (name, klass) => { if (!customElements.get(name)) customElements.define(name, klass); };
const novaConfiguredEntity = (config, key, fallback) => (config?.entities?.[key] || config?.[`${key}_entity`] || fallback);
const novaFormatValue = (value, decimals = 1) => {
  if (value === undefined || value === null || value === '' || value === 'unknown' || value === 'unavailable') return '--';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : novaEsc(value);
};
const novaClubOrder = ['Driver','Mini Driver','2 Wood','3 Wood','4 Wood','5 Wood','7 Wood','9 Wood','2 Hybrid','3 Hybrid','4 Hybrid','5 Hybrid','6 Hybrid','2 Iron','3 Iron','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron','PW','AW','GW','SW','LW','46 Wedge','48 Wedge','50 Wedge','52 Wedge','54 Wedge','56 Wedge','58 Wedge','60 Wedge','62 Wedge','64 Wedge','Putter'];
const novaClubRank = (club) => {
  const text = String((club && typeof club === 'object' ? club.club : club) || '').trim();
  const lower = text.toLowerCase();
  const exact = novaClubOrder.findIndex(item => item.toLowerCase() === lower);
  if (exact >= 0) return exact;
  const degree = Number((lower.match(/^(\d{2})\s*(?:deg|degree|wedge)?$/) || [])[1]);
  if (Number.isFinite(degree)) return 23 + (degree - 46) / 2;
  return 1000;
};
const novaSortClubs = (clubs) => [...(clubs || [])].sort((a, b) => {
  const rank = novaClubRank(a) - novaClubRank(b);
  const aName = String((a && typeof a === 'object' ? a.club : a) || '');
  const bName = String((b && typeof b === 'object' ? b.club : b) || '');
  return rank || aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
});
/** True when the user is typing in an input inside this card (skip full re-render). */
const novaIsEditing = (root) => {
  if (!root) return false;
  const active = root.getRootNode()?.activeElement;
  const activeInside = !!(active && root.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
  // Clear a stale flag: if innerHTML was rebuilt while an input had focus the
  // focusout never fired, which would otherwise wedge the card blank forever.
  if (root._editing && !activeInside) root._editing = false;
  return root._editing || activeInside;
};
/**
 * Track focus on a card host so we never re-render (and blow away an input)
 * while the user is typing. focusin/focusout bubble and survive innerHTML
 * rebuilds, unlike the activeElement check which is unreliable across HA's
 * nested shadow DOM. Only INPUT/TEXTAREA focus counts as "editing" so that
 * clicking a button (Set/Save/Add) still allows the follow-up re-render.
 */
const novaTrackEditing = (host) => {
  if (host._editingTracked) return;
  host._editingTracked = true;
  host.addEventListener('focusin', (ev) => {
    host._editing = ['INPUT', 'TEXTAREA'].includes(ev.target?.tagName);
  });
  host.addEventListener('focusout', () => { host._editing = false; });
};
/** Brief visible "pressed" flash so clicks feel responsive on desktop + TV. */
const novaPulse = (el) => {
  if (!el) return;
  el.classList.remove('nova-pulse');
  // Force reflow so the animation restarts on rapid repeat clicks.
  void el.offsetWidth;
  el.classList.add('nova-pulse');
  window.setTimeout(() => el.classList.remove('nova-pulse'), 320);
};

// Lean-back / TV layout: touch remotes and 16:9-ish screens (excludes 21:9 ultrawide).
const NOVA_TV_MEDIA = '@media (hover:none) and (pointer:coarse),(min-width:1200px) and (max-aspect-ratio:18/10) and (min-height:650px)';
const novaTvStyles = `
${NOVA_TV_MEDIA}{
  -webkit-text-size-adjust:100%;
  ha-card{font-size:18px}
  .kicker,.sectionLabel,.nova-title{font-size:14px!important;letter-spacing:.14em!important}
  .title,.nova-hero,h2{font-size:clamp(28px,3.2vw,42px)!important}
  .nova-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px}
  .nova-tile{padding:18px}
  .nova-label{font-size:13px!important}
  .nova-value{font-size:clamp(28px,3.5vw,36px)!important}
  .shell{min-height:auto!important;padding:20px 22px 22px}
  h1{font-size:clamp(40px,5vw,56px)!important}
  .eyebrow{font-size:15px!important}
  .heroStrip{grid-template-columns:1fr 1fr!important;gap:16px;margin-top:18px}
  .resultWrap{grid-column:1/-1;justify-content:flex-start!important;margin-top:4px}
  .gradeBig{font-size:clamp(44px,5vw,56px)!important}
  .resultText{font-size:14px!important;padding:11px 16px}
  .statLabel{font-size:13px!important}
  .statValue{font-size:clamp(48px,8vw,72px)!important}
  .statValue.small{font-size:clamp(36px,5vw,52px)!important}
  .stage{min-height:0!important;aspect-ratio:390/252;max-height:min(52vh,540px);margin-top:18px}
  .stage svg{position:absolute;inset:0;width:100%;height:100%}
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:14px;margin-top:16px}
  .metric{padding:18px}
  .metric .label{font-size:13px!important}
  .metric .value{font-size:clamp(26px,3.2vw,34px)!important}
  .rangeLabels text{font-size:12px!important}
  .sideLabels text{font-size:10px!important}
  .flightLabel,.impactLabel{font-size:15px!important}
  .charts{grid-template-columns:1fr!important;gap:16px}
  .chartHead{font-size:17px!important}
  .chartHead small{font-size:12px!important}
  .legend{font-size:15px!important}
  svg.chart,.chart svg{height:200px}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .stat b{font-size:18px!important}
  .stat span{font-size:12px!important}
  .actions{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px}
  .action{padding:16px 12px;font-size:14px}
  .simbar{grid-template-columns:1fr!important}
  .simactions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .chip,.toggle,.mtool,.save,.pill{min-height:48px;font-size:15px}
  .toggle ha-icon,.mtool ha-icon,.action ha-icon{--mdc-icon-size:24px}
  .grid{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))!important}
  .club{font-size:clamp(24px,2.4vw,34px)!important}
  .clubBar .clubpick{font-size:14px!important;padding:6px 13px!important;line-height:1.4!important}
  .clubBar .clubNow{font-size:16px!important}.clubBar .clubTitle,.clubBar .clubLast{font-size:11px!important}
  .numbers b,.details b{font-size:clamp(22px,2.8vw,28px)!important}
  .numbers span,.details span{font-size:12px!important}
  .video{min-height:0!important;max-height:min(56vh,640px)}
  .empty{min-height:min(40vh,360px)!important;font-size:18px}
  .coach,.coach-card{padding:18px 20px}
  .coach h3{font-size:clamp(24px,3vw,32px)!important}
  .coach p,.coach-row p,.coachBlock ul{font-size:clamp(16px,1.8vw,20px)!important;line-height:1.5!important}
  .coachBlock b,.coach-row b{font-size:13px!important}
  .coach-titlebar img{width:56px;height:56px}
  .markbar{gap:10px;margin-bottom:14px}
  .meta,.note{font-size:15px!important}
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .clubGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .club span{font-size:17px!important}
  th,td{font-size:14px!important;padding:10px!important}
  .cell{min-height:52px!important;font-size:16px!important}
  .body{grid-template-columns:1fr!important}
  .photo{height:min(28vh,220px)!important}
  p{font-size:16px!important}
}
`;

const novaStyles = `
  <style>
    .nova-card{position:relative;overflow:hidden;border-radius:28px;padding:22px;background:linear-gradient(145deg,rgba(8,15,30,.82),rgba(18,34,62,.66));border:1px solid rgba(148,214,255,.22);box-shadow:0 24px 70px rgba(0,0,0,.36);color:#eef8ff;font-family:Inter,Roboto,Arial,sans-serif}
    .nova-card:before{content:"";position:absolute;inset:-40%;background:radial-gradient(circle at 10% 10%,rgba(65,220,255,.18),transparent 28%),radial-gradient(circle at 85% 10%,rgba(137,90,255,.18),transparent 32%);pointer-events:none}
    .nova-card>*{position:relative}.nova-title{font-size:13px;text-transform:uppercase;letter-spacing:.16em;color:#8fdcff;margin:0 0 8px}.nova-hero{font-size:30px;font-weight:900;line-height:1.05;margin:0}.nova-muted{color:#9bb7c9}.nova-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.nova-tile{border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:14px;background:rgba(255,255,255,.07);backdrop-filter:blur(14px)}.nova-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#8faec0}.nova-value{font-size:24px;font-weight:800;margin-top:4px}.nova-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.nova-btn{border:0;border-radius:999px;padding:10px 14px;background:linear-gradient(135deg,#2ee6a6,#3bb7ff);color:#04101f;font-weight:850;cursor:pointer}.nova-btn.secondary{background:rgba(255,255,255,.12);color:#eaf7ff;border:1px solid rgba(255,255,255,.16)}.nova-input,.nova-select{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.24);color:#fff;padding:10px;margin-top:6px}.nova-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nova-club{display:grid;grid-template-columns:120px 1fr;gap:18px;align-items:start}.nova-img{width:120px;height:120px;border-radius:22px;object-fit:cover;background:linear-gradient(135deg,rgba(255,255,255,.18),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.12)}.nova-fallback{display:grid;place-items:center;font-size:46px;color:#9ee7ff}    .nova-divider{height:1px;background:rgba(255,255,255,.11);margin:14px 0}@media(max-width:700px){.nova-club,.nova-row{grid-template-columns:1fr}.nova-img{width:100%;height:180px}}
  ${novaTvStyles}
  </style>
`;

class NovaShotTracerCard extends HTMLElement {
  setConfig(config) { this.config = config || {}; }
  set hass(hass) {
    this._hass = hass;
    const watched = ['ball_speed','carry','total','offline','launch_angle','launch_direction','total_spin','spin_axis','shot_shape','shot_grade','latest_shot']
      .map(key => this.entity(key));
    watched.push(this.config.connection_entity || 'binary_sensor.nova_connection');
    watched.push(this.clubSelectEntity());
    const signature = watched.map(entity => `${entity}:${hass.states?.[entity]?.state ?? ''}:${hass.states?.[entity]?.last_changed ?? ''}`).join('|');
    if (this._signature === signature && this._rendered) return;
    this._signature = signature;
    this._evalWedge(hass);
    this.render();
  }
  _lsGet(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; } }
  _lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  get _wedge() { return Object.assign({ on: false, dist: 100, radius: 8 }, this._lsGet('nova_wedge_target', {})); }
  set _wedge(v) { this._lsSet('nova_wedge_target', v); }
  get _score() { return Object.assign({ hits: 0, total: 0 }, this._lsGet('nova_wedge_score', {})); }
  set _score(v) { this._lsSet('nova_wedge_score', v); }
  _evalWedge(hass) {
    const w = this._wedge;
    if (!w.on) return;
    const st = hass.states?.[this.entity('latest_shot')];
    const key = st ? `${st.state}:${st.last_changed || st.last_updated || ''}` : '';
    if (!key || key === this._scoredKey) return;
    // First shot we observe on load is the one already on screen; don't count it.
    if (this._scoredKey === undefined) { this._scoredKey = key; return; }
    this._scoredKey = key;
    const carry = Number(this.value(this.entity('carry')) || 0);
    const offline = Number(this.value(this.entity('offline')) || 0);
    if (!carry) return;
    const hit = Math.abs(carry - w.dist) <= w.radius && Math.abs(offline) <= w.radius;
    const s = this._score;
    s.total += 1;
    if (hit) s.hits += 1;
    this._score = s;
  }
  clubSelectEntity() { return this.config.active_club_entity || 'select.golf_range_matrix_range_matrix_active_club'; }
  _selectClub(option) {
    if (!this._hass || !option) return;
    this._hass.callService('select', 'select_option', { entity_id: this.clubSelectEntity(), option });
  }
  _wedgeAction(action) {
    const w = this._wedge;
    if (action === 'toggle') w.on = !w.on;
    else if (action === 'dist+') w.dist = this.clamp(w.dist + 5, 10, 320);
    else if (action === 'dist-') w.dist = this.clamp(w.dist - 5, 10, 320);
    else if (action.startsWith('preset-')) { w.dist = this.clamp(Number(action.slice(7)) || w.dist, 10, 320); if (!w.on) w.on = true; }
    else if (action === 'rad+') w.radius = this.clamp(w.radius + 1, 2, 30);
    else if (action === 'rad-') w.radius = this.clamp(w.radius - 1, 2, 30);
    else if (action === 'reset') { this._score = { hits: 0, total: 0 }; this.render(); return; }
    this._wedge = w;
    this.render();
  }
  entity(key) {
    const fallback = key === 'latest_shot'
      ? 'sensor.golf_range_matrix_range_matrix_latest_shot'
      : `sensor.golf_range_matrix_range_matrix_${key}`;
    return novaConfiguredEntity(this.config, key, fallback);
  }
  state(entity) { return novaState(this._hass, entity); }
  value(entity) {
    const state = this.state(entity);
    if (!state || state.state === 'unknown' || state.state === 'unavailable') return null;
    const number = Number(state.state);
    return Number.isFinite(number) ? number : state.state;
  }
  unit(entity) {
    const unit = this.state(entity)?.attributes?.unit_of_measurement || '';
    return unit === 'yds' ? 'yd' : unit;
  }
  clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  fmt(entity, decimals = 1) {
    const value = this.value(entity);
    if (value === null) return '--';
    return typeof value === 'number' ? `${value.toFixed(decimals)}${this.unit(entity) ? ` ${this.unit(entity)}` : ''}` : novaEsc(value);
  }
  metric(label, value, tone = '') { return `<div class="metric ${tone}"><div class="label">${label}</div><div class="value">${value}</div></div>`; }
  ago(entity) {
    const shot = this.state(entity);
    const raw = shot?.attributes?.received_at || shot?.last_changed || shot?.last_updated;
    if (!raw) return '--';
    const then = new Date(raw);
    if (Number.isNaN(then.getTime())) return novaEsc(raw);
    const minutes = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
    return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
  }
  fresh(entity, minutes = 10) {
    const state = this.state(entity);
    const raw = state?.attributes?.received_at || state?.last_changed || state?.last_updated;
    if (!raw) return false;
    const then = new Date(raw);
    return !Number.isNaN(then.getTime()) && Date.now() - then.getTime() <= minutes * 60000;
  }
  connected(latestEntity, metricEntities) {
    const connection = this.state(this.config.connection_entity || 'binary_sensor.nova_connection');
    if (connection?.state === 'on') return true;
    const staleMinutes = Number(this.config.connection_stale_minutes || 10);
    if (this.fresh(latestEntity, staleMinutes)) return true;
    return metricEntities.some(entity => this.value(entity) !== null && this.fresh(entity, staleMinutes));
  }
  render() {
    if (!this._hass || !this.config) return;
    this._rendered = true;
    this._renderId = (this._renderId || 0) + 1;
    const pathId = `flightPath-${this._renderId}`;
    const tracerId = `range-tracer-${this._renderId}`;
    const glowId = `glow-${this._renderId}`;
    const speedEntity = this.entity('ball_speed');
    const carryEntity = this.entity('carry');
    const totalEntity = this.entity('total');
    const offlineEntity = this.entity('offline');
    const launchEntity = this.entity('launch_angle');
    const directionEntity = this.entity('launch_direction');
    const spinEntity = this.entity('total_spin');
    const axisEntity = this.entity('spin_axis');
    const shapeEntity = this.entity('shot_shape');
    const gradeEntity = this.entity('shot_grade');
    const latestEntity = this.entity('latest_shot');
    const speed = Number(this.value(speedEntity) || 0);
    const carry = Number(this.value(carryEntity) || 0);
    const launch = Number(this.value(launchEntity) || 0);
    const side = Number(this.value(directionEntity) || 0);
    const axis = Number(this.value(axisEntity) || 0);
    const offline = Number(this.value(offlineEntity) || 0);
    const shotName = this.value(shapeEntity) || '';
    const shotRank = this.value(gradeEntity) || '';
    const connected = this.connected(latestEntity, [speedEntity, carryEntity, totalEntity, offlineEntity]);
    const startX = 195, startY = 222;
    const distanceLift = carry ? this.clamp((carry - 110) * 0.18, -12, 34) : 0;
    const direction = side + axis * 0.22 + offline * 0.08;
    const endX = this.clamp(startX + direction * 9.4, 24, 366);
    const apexX = this.clamp(startX + direction * 4.8, 40, 350);
    const apexY = this.clamp(176 - launch * 3.25 - speed * 0.29 - distanceLift, 24, 150);
    const landY = this.clamp(156 - speed * 0.08 - distanceLift * 0.45, 100, 166);
    const curve = `M ${startX} ${startY} C ${startX} ${startY - 64}, ${apexX} ${apexY}, ${endX} ${landY}`;
    const shadow = `M ${startX} ${startY + 5} C ${startX} ${startY - 24}, ${apexX} ${apexY + 38}, ${this.clamp(endX * .86 + startX * .14, 48, 342)} ${this.clamp(landY + 36, 152, 204)}`;
    const directionText = offline < -1 ? 'Left' : offline > 1 ? 'Right' : side < -0.75 ? 'Started Left' : side > 0.75 ? 'Started Right' : 'Center Cut';
    const offlineLabel = Math.abs(offline) >= 1 ? `${directionText} ${Math.abs(offline).toFixed(1)} yd` : 'Center Cut';
    const resultRest = [shotName, offlineLabel].filter(Boolean).join(' | ');
    // --- Driving range geometry: wide perspective trapezoid (not a pyramid) ---
    const TOP_Y = 36, BOT_Y = 242, SPAN = BOT_Y - TOP_Y;
    const BL = 52, BR = 338, TL = 156, TR = 234;
    const fxL = (y) => BL + (TL - BL) * (BOT_Y - y) / SPAN;
    const fxR = (y) => BR + (TR - BR) * (BOT_Y - y) / SPAN;
    const distToY = (d) => this.clamp(214 - (d - 50) * 0.712, TOP_Y + 2, 244);
    const bandYs = [242, 214, 178, 142, 106, 70, 36];
    let stripes = '';
    for (let i = 0; i < bandYs.length - 1; i++) {
      const y0 = bandYs[i], y1 = bandYs[i + 1];
      const cls = i % 2 === 0 ? 'stripeA' : 'stripeB';
      stripes += `<path class="${cls}" d="M${fxL(y0).toFixed(1)} ${y0} L${fxR(y0).toFixed(1)} ${y0} L${fxR(y1).toFixed(1)} ${y1} L${fxL(y1).toFixed(1)} ${y1} Z"/>`;
    }
    const dists = [['50', 214], ['100', 178], ['150', 142], ['200', 106], ['250', 70], ['300', 36]];
    let gridLines = '', ydLabels = '';
    dists.forEach(([lab, y]) => {
      gridLines += `<line x1="${fxL(y).toFixed(1)}" y1="${y}" x2="${fxR(y).toFixed(1)}" y2="${y}"/>`;
      ydLabels += `<text class="ydL" x="${(fxL(y) - 7).toFixed(1)}" y="${y + 3}">${lab} YD</text><text class="ydR" x="${(fxR(y) + 7).toFixed(1)}" y="${y + 3}">${lab}</text>`;
    });
    // Scenery: rough-side trees, a distant tree line, and a couple of clouds.
    const tree = (x, y, s) => `<g class="tree" transform="translate(${x} ${y}) scale(${s})"><rect class="trunk" x="-1.4" y="0" width="2.8" height="7"/><ellipse class="leaf" cx="0" cy="-3" rx="7" ry="8"/><ellipse class="leaf" cx="-4.5" cy="1" rx="5" ry="6"/><ellipse class="leaf" cx="4.5" cy="1" rx="5" ry="6"/></g>`;
    const scenery = `${tree(18, 250, 1.8)}${tree(374, 250, 1.8)}${tree(36, 206, 1.1)}${tree(358, 208, 1.05)}${tree(126, 39, 0.42)}${tree(150, 40, 0.5)}${tree(244, 40, 0.5)}${tree(268, 39, 0.42)}`
      + `<g class="cloud"><ellipse cx="82" cy="14" rx="20" ry="5"/><ellipse cx="98" cy="11" rx="13" ry="5"/></g><g class="cloud"><ellipse cx="300" cy="13" rx="17" ry="4.5"/><ellipse cx="314" cy="16" rx="11" ry="4"/></g>`;
    // --- Wedge target trainer ---
    const w = this._wedge;
    const score = this._score;
    const liveHit = (w.on && carry) ? (Math.abs(carry - w.dist) <= w.radius && Math.abs(offline) <= w.radius) : null;
    let greenSvg = '';
    if (w.on) {
      const gy = distToY(w.dist);
      const rx = this.clamp(w.radius * 1.5, 7, 60);
      const ry = this.clamp(w.radius * 0.7, 3, 26);
      greenSvg = `<g class="targetGreen"><ellipse class="ring" cx="195" cy="${gy.toFixed(1)}" rx="${(rx + 3).toFixed(1)}" ry="${(ry + 1.6).toFixed(1)}"/><ellipse class="grn" cx="195" cy="${gy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/><line class="pin" x1="195" y1="${gy.toFixed(1)}" x2="195" y2="${(gy - 14).toFixed(1)}"/><path class="pinflag" d="M195 ${(gy - 14).toFixed(1)} l9 3 l-9 3 Z"/>${liveHit !== null ? `<text class="hitTag ${liveHit ? 'hit' : 'miss'}" x="195" y="${(gy + ry + 12).toFixed(1)}">${liveHit ? 'HIT' : 'MISS'}</text>` : ''}</g>`;
    }
    const presets = [50, 75, 100, 125, 150, 175];
    const presetBtns = presets.map(d => `<button class="preset ${w.dist === d ? 'on' : ''}" data-wedge="preset-${d}">${d}</button>`).join('');
    const wedgeBar = `<div class="wedgeBar">
      <button class="wbtn ${w.on ? 'on' : ''}" data-wedge="toggle"><ha-icon icon="mdi:target"></ha-icon><span>Wedge Target ${w.on ? 'On' : 'Off'}</span></button>
      <div class="wstep"><span class="wlab">Distance</span><button data-wedge="dist-">&minus;</button><b>${w.dist} yd</b><button data-wedge="dist+">+</button></div>
      <div class="presets"><span class="wlab">Presets</span>${presetBtns}</div>
      <div class="wstep"><span class="wlab">Green &plusmn;</span><button data-wedge="rad-">&minus;</button><b>${w.radius} yd</b><button data-wedge="rad+">+</button></div>
      ${w.on ? `<div class="wscore"><b>${score.hits}/${score.total}</b><span>${score.total ? Math.round(score.hits / score.total * 100) + '% landed' : 'awaiting shots'}</span></div><button class="wbtn ghost" data-wedge="reset">Reset</button>` : ''}
    </div>`;
    // --- Quick club select (sets the active club for the next logged shot) ---
    const clubSel = this.clubSelectEntity();
    const clubState = this.state(clubSel);
    const clubOpts = clubState?.attributes?.options || [];
    const curClub = clubState?.state && !['unknown', 'unavailable'].includes(clubState.state) ? clubState.state : '';
    const clubBtns = clubOpts.map(o => `<button class="clubpick ${o === curClub ? 'on' : ''}" data-club="${novaEsc(o)}">${novaEsc(o)}</button>`).join('');
    const clubBar = `<div class="clubBar">
      <div class="clubHead"><span class="clubTitle">Club In Play</span><span class="clubNow">${novaEsc(curClub || '--')}</span><span class="clubLast">Last shot &middot; ${this.ago(latestEntity)}</span></div>
      <div class="clubBtns">${clubBtns || '<span class="clubEmpty">No clubs in this bag yet</span>'}</div>
    </div>`;
    this.innerHTML = `<ha-card><div class="shell">
      <div class="wash"></div>
      <div class="topline"><div><div class="eyebrow">LIVE OPEN GOLF COACH</div><h1>${novaEsc(this.config.title || 'Range Matrix Shot Lab')}</h1></div><div class="status ${connected ? 'on' : 'off'}"><span></span>${connected ? 'Connected' : 'Offline'}</div></div>
      <div class="heroStrip"><div class="primaryStat carryStat"><div class="statLabel">Carry</div><div class="statValue">${this.fmt(carryEntity, 1)}</div></div><div class="primaryStat"><div class="statLabel">Ball Speed</div><div class="statValue small">${this.fmt(speedEntity, 1)}</div></div><div class="resultWrap">${shotRank ? `<div class="gradeBig">${novaEsc(shotRank)}</div>` : ''}<div class="resultText">${novaEsc(resultRest)}</div></div></div>
      ${wedgeBar}
      <div class="stage"><svg viewBox="0 0 390 252" preserveAspectRatio="xMidYMid meet" aria-label="Animated shot tracer driving range grid"><defs><linearGradient id="${tracerId}" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stop-color="#f7ff5c"/><stop offset="0.44" stop-color="#38f8ff"/><stop offset="1" stop-color="#b36bff"/></linearGradient><linearGradient id="sky-${this._renderId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1a3a"/><stop offset="1" stop-color="#274a78"/></linearGradient><linearGradient id="rough-${this._renderId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b3d24"/><stop offset="1" stop-color="#0a1c11"/></linearGradient><radialGradient id="haze-${this._renderId}" cx="0.5" cy="0.16" r="0.6"><stop offset="0" stop-color="rgba(150,210,255,.32)"/><stop offset="1" stop-color="rgba(150,210,255,0)"/></radialGradient><filter id="${glowId}"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <rect class="rough" x="0" y="0" width="390" height="252" fill="url(#rough-${this._renderId})"/><rect class="sky" x="0" y="0" width="390" height="38" fill="url(#sky-${this._renderId})"/><rect class="haze" x="0" y="6" width="390" height="60" fill="url(#haze-${this._renderId})"/><path class="treeline" d="M0 37 q20 -7 40 -2 t40 0 t40 -3 t40 2 t40 -3 t40 1 t40 -2 t40 2 t40 -1 t30 1 V40 H0 Z"/><line class="horizon" x1="0" y1="36.5" x2="390" y2="36.5"/>${stripes}<path class="fairwayEdge" d="M${BL} ${BOT_Y} L${TL} ${TOP_Y} L${TR} ${TOP_Y} L${BR} ${BOT_Y} Z"/>${scenery}<g class="grid">${gridLines}</g><path class="target" d="M195 ${TOP_Y} V236"/>${greenSvg}
        <g class="rangeLabels">${ydLabels}</g>
        <g class="sideLabels"><text x="58" y="247">LEFT ROUGH</text><text x="258" y="247">RIGHT ROUGH</text></g>
        <path class="ghost" d="${shadow}"/><path id="${pathId}" class="pathTemplate" d="${curve}"/><path class="curve halo" d="${curve}"/><path class="curve animated" d="${curve}"/><circle class="tee" cx="${startX}" cy="${startY}" r="5"/><circle class="movingBall" r="5"><animateMotion dur="3s" repeatCount="indefinite" rotate="auto" calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines=".2 0 .2 1"><mpath href="#${pathId}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.86;1" dur="3s" repeatCount="indefinite"/></circle><circle class="landPulse" cx="${endX}" cy="${landY}" r="5"/><text class="impactLabel" x="151" y="248">IMPACT</text><text class="flightLabel" x="${this.clamp(endX - 54, 18, 292)}" y="${this.clamp(landY - 12, 24, 168)}">${novaEsc(offlineLabel)}</text>
      </svg></div>
      ${clubBar}
    </div></ha-card><style>
      ha-card{overflow:hidden;border:0;border-radius:28px;background:#050814;color:white;box-shadow:0 24px 70px rgba(0,0,0,.42)}.shell{position:relative;min-height:840px;padding:26px;isolation:isolate}.wash{position:absolute;inset:0;background:radial-gradient(circle at 70% 15%,rgba(56,248,255,.25),transparent 34%),radial-gradient(circle at 12% 88%,rgba(168,85,247,.28),transparent 42%),linear-gradient(135deg,rgba(4,7,19,.98),rgba(7,15,36,.86));z-index:-2}.topline{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.eyebrow{color:#8ffcff;font-weight:900;letter-spacing:.2em;font-size:13px;text-shadow:0 0 14px rgba(56,248,255,.45)}h1{margin:7px 0 0;font-size:clamp(36px,6vw,64px);line-height:.92;letter-spacing:-.06em}.status{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.11);font-weight:800;white-space:nowrap}.status span{width:10px;height:10px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 18px #ff4d6d}.status.on span{background:#72ff7d;box-shadow:0 0 18px #72ff7d}.heroStrip{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,.72fr) minmax(240px,1fr);align-items:center;gap:14px;margin-top:24px;padding:16px 18px;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:rgba(255,255,255,.08);backdrop-filter:blur(16px)}.statLabel{color:rgba(255,255,255,.68);text-transform:uppercase;letter-spacing:.17em;font-size:12px;font-weight:900}.statValue{margin-top:3px;font-size:clamp(44px,7vw,72px);line-height:.95;font-weight:950;letter-spacing:-.07em;text-shadow:0 0 28px rgba(56,248,255,.35)}.statValue.small{font-size:clamp(30px,4.5vw,50px)}.carryStat .statValue{color:#f7ff8a}.resultWrap{display:flex;align-items:center;justify-content:flex-end;gap:10px}.gradeBig{font-size:38px;line-height:1;font-weight:950;color:#f7ff8a;text-shadow:0 0 20px rgba(247,255,92,.35)}.resultText{padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(247,255,92,.32);color:#f7ff8a;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.stage{position:relative;margin-top:16px;min-height:490px;border:1px solid rgba(255,255,255,.15);border-radius:25px;background:#0a1c11;overflow:hidden}svg{position:absolute;inset:0;width:100%;height:100%}.stripeA{fill:#3a7a39}.stripeB{fill:#2f6831}.fairwayEdge{fill:none;stroke:rgba(255,255,255,.16);stroke-width:1}.horizon{stroke:rgba(180,225,255,.4);stroke-width:1}.treeline{fill:#14331f;opacity:.9}.tree .trunk{fill:#3a2415}.tree .leaf{fill:#2c6b34;opacity:.95}.cloud ellipse{fill:rgba(220,235,255,.18)}.targetGreen .grn{fill:rgba(86,210,110,.85);stroke:rgba(255,255,255,.45);stroke-width:.6}.targetGreen .ring{fill:none;stroke:rgba(247,255,140,.7);stroke-width:1.2;stroke-dasharray:3 3}.targetGreen .pin{stroke:rgba(255,255,255,.9);stroke-width:1}.targetGreen .pinflag{fill:#ff4d6d}.targetGreen .hitTag{font-size:11px;font-weight:950;text-anchor:middle;letter-spacing:.08em}.targetGreen .hitTag.hit{fill:#72ff7d;text-shadow:0 0 10px rgba(114,255,125,.6)}.targetGreen .hitTag.miss{fill:#ff6f8b;text-shadow:0 0 10px rgba(255,77,109,.5)}.grid{stroke:rgba(255,255,255,.12);stroke-width:1;fill:none}.target{stroke:rgba(247,255,92,.5);stroke-width:1.8;fill:none;stroke-dasharray:5 8}.ydL{text-anchor:end}.ydR{text-anchor:start}.ghost{stroke:rgba(255,255,255,.16);stroke-width:5;fill:none;stroke-linecap:round;stroke-dasharray:2 13}.pathTemplate{fill:none;stroke:none}.curve{stroke:url(#${tracerId});stroke-width:7;fill:none;stroke-linecap:round;filter:url(#${glowId})}.curve.halo{stroke:rgba(56,248,255,.25);stroke-width:18;opacity:.45}.curve.animated{stroke-dasharray:520;stroke-dashoffset:520;animation:draw-flight 3s ease-out infinite}.movingBall{fill:white;stroke:rgba(255,255,255,.85);stroke-width:1}.landPulse{fill:white;filter:url(#${glowId});opacity:0;animation:land-pulse 3s ease-out infinite}.tee{fill:white}.impactLabel,.movingBall,.tee{filter:none}text{fill:rgba(255,255,255,.64);font-size:12px;text-transform:uppercase;letter-spacing:.16em}.rangeLabels text{fill:rgba(247,255,92,.86);font-size:10.5px;font-weight:950;letter-spacing:.12em;text-shadow:0 0 10px rgba(247,255,92,.35)}.sideLabels text{fill:rgba(255,255,255,.42);font-size:8.5px;font-weight:950;letter-spacing:.15em}.flightLabel,.impactLabel{font-size:13px;font-weight:950;fill:rgba(255,255,255,.78);text-shadow:0 0 12px rgba(255,255,255,.28)}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}.metric{padding:16px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(16px)}.metric .label{color:rgba(255,255,255,.66);text-transform:uppercase;font-size:11px;letter-spacing:.14em;font-weight:900}.metric .value{margin-top:8px;font-size:25px;font-weight:900;letter-spacing:-.03em}.cyan{box-shadow:inset 0 0 0 1px rgba(56,248,255,.12)}.violet{box-shadow:inset 0 0 0 1px rgba(168,85,247,.16)}.lime{box-shadow:inset 0 0 0 1px rgba(230,255,88,.14)}.amber{box-shadow:inset 0 0 0 1px rgba(255,184,77,.14)}.blue{box-shadow:inset 0 0 0 1px rgba(80,140,255,.16)}.pink{box-shadow:inset 0 0 0 1px rgba(255,77,190,.16)}      @keyframes draw-flight{0%{stroke-dashoffset:520;opacity:0}7%{opacity:1}78%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:.25}}@keyframes land-pulse{0%,79%{opacity:0;r:4}86%{opacity:1;r:7}100%{opacity:0;r:13}}@media(max-width:760px){.shell{min-height:980px;padding:18px}.topline{flex-direction:column}.heroStrip{grid-template-columns:1fr;align-items:flex-start}.resultWrap{justify-content:flex-start}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.stage{min-height:430px}}
      .wedgeBar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(255,255,255,.06)}.wedgeBar .wbtn{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:12px;border:1px solid rgba(247,255,92,.3);background:rgba(247,255,92,.08);color:#f7ff8a;font-weight:900;font-size:13px;letter-spacing:.04em;cursor:pointer;--mdc-icon-size:18px}.wedgeBar .wbtn.on{background:rgba(114,255,125,.16);border-color:rgba(114,255,125,.55);color:#9dffb0;box-shadow:0 0 16px rgba(114,255,125,.25)}.wedgeBar .wbtn.ghost{color:rgba(255,255,255,.7);border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.05)}.wedgeBar .wbtn:active{transform:scale(.95)}.wedgeBar .wstep{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}.wedgeBar .wstep .wlab{color:rgba(255,255,255,.6);text-transform:uppercase;font-size:10.5px;letter-spacing:.12em;font-weight:900}.wedgeBar .wstep b{min-width:46px;text-align:center;font-size:14px;font-weight:900;color:#fff}.wedgeBar .wstep button{width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;font-size:16px;font-weight:900;line-height:1;cursor:pointer}.wedgeBar .wstep button:active{transform:scale(.9);background:rgba(56,248,255,.25)}.wedgeBar .presets{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}.wedgeBar .presets .preset{min-width:34px;height:28px;padding:0 8px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:rgba(255,255,255,.82);font-size:12.5px;font-weight:900;cursor:pointer}.wedgeBar .presets .preset.on{background:rgba(247,255,92,.16);border-color:rgba(247,255,92,.5);color:#f7ff8a}.wedgeBar .presets .preset:active{transform:scale(.92)}.wedgeBar .wscore{display:flex;flex-direction:column;line-height:1.05;margin-left:auto;text-align:right}.wedgeBar .wscore b{font-size:20px;font-weight:950;color:#72ff7d}.wedgeBar .wscore span{font-size:10.5px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;font-weight:800}
      .clubBar{margin-top:12px;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.06)}.clubBar .clubHead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:8px}.clubBar .clubTitle{color:rgba(255,255,255,.6);text-transform:uppercase;font-size:10px;letter-spacing:.14em;font-weight:900}.clubBar .clubNow{font-size:14px;font-weight:950;color:#f7ff8a;letter-spacing:-.01em}.clubBar .clubLast{margin-left:auto;color:rgba(255,255,255,.45);font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.clubBar .clubBtns{display:flex;flex-wrap:wrap;gap:6px}.clubBar .clubpick{padding:4px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:rgba(255,255,255,.82);font-size:12px;font-weight:800;letter-spacing:.01em;line-height:1.55;cursor:pointer;transition:transform .08s ease}.clubBar .clubpick:hover{background:rgba(255,255,255,.12)}.clubBar .clubpick.on{background:rgba(247,255,92,.16);border-color:rgba(247,255,92,.6);color:#f7ff8a;box-shadow:0 0 12px rgba(247,255,92,.2)}.clubBar .clubpick:active{transform:scale(.94)}.clubBar .clubEmpty{color:rgba(255,255,255,.5);font-size:12px;font-weight:700}
      ${novaTvStyles}
    </style>`;
    this.querySelectorAll('[data-wedge]').forEach(btn => btn.addEventListener('click', () => this._wedgeAction(btn.dataset.wedge)));
    this.querySelectorAll('[data-club]').forEach(btn => btn.addEventListener('click', () => { novaPulse(btn); this._selectClub(btn.dataset.club); }));
  }
}

class GolfMetricPanelCard extends HTMLElement {
  setConfig(config) { this.config = config || {}; }
  set hass(hass) { this._hass = hass; this.render(); }
  render() {
    const metrics = this.config.metrics || [
      ['carry', 'Carry', 'yd'], ['total', 'Total', 'yd'], ['ball_speed', 'Ball Speed', 'mph'], ['club_speed', 'Club Speed', 'mph'], ['smash_factor', 'Smash', ''], ['total_spin', 'Spin', 'rpm']
    ];
    this.innerHTML = `${novaStyles}<div class="nova-card"><p class="nova-title">${novaEsc(this.config.title || 'Range Matrix Metrics')}</p><div class="nova-grid">${metrics.map((metric) => {
      const key = Array.isArray(metric) ? metric[0] : metric.key;
      const label = Array.isArray(metric) ? metric[1] : (metric.name || metric.label || key);
      const unit = Array.isArray(metric) ? metric[2] : (metric.unit || '');
      const entity = Array.isArray(metric) ? novaConfiguredEntity(this.config, key, `sensor.golf_range_matrix_range_matrix_${key}`) : metric.entity;
      const v = novaValue(this._hass, entity);
      return `<div class="nova-tile"><div class="nova-label">${novaEsc(label)}</div><div class="nova-value">${novaFormatValue(v)} <span class="nova-muted" style="font-size:13px">${novaEsc(unit)}</span></div></div>`;
    }).join('')}</div></div>`;
  }
}

class GolfShotHistoryCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.limit = this.config.limit || 50;
    this.entities = this.config.entities || [
      'sensor.golf_range_matrix_range_matrix_carry',
      'sensor.golf_range_matrix_range_matrix_total',
      'sensor.golf_range_matrix_range_matrix_offline',
      'sensor.golf_range_matrix_range_matrix_ball_speed',
    ];
    this.basis = this.config.basis_entity || this.entities[0];
    this.historyEntities = [
      this.config.history_entity,
      'sensor.golf_range_matrix_range_matrix_recent_shots',
      'sensor.golf_range_matrix_recent_shots',
    ].filter(Boolean);
    this._liveShots = [];
  }
  set hass(hass) {
    this._hass = hass;
    this.historyEntity = this.historyEntities.find(entity => hass.states?.[entity]) || this.historyEntities[0];
    const recent = hass.states?.[this.historyEntity];
    const signature = [
      ...this.entities.map(entity => `${entity}:${hass.states?.[entity]?.state ?? ''}:${hass.states?.[entity]?.last_changed ?? ''}`),
      `${this.historyEntity}:${recent?.state ?? ''}:${recent?.last_changed ?? ''}`,
    ].join('|');
    if (signature !== this._liveSignature) {
      this._liveSignature = signature;
      this.addLiveShot();
      this._lastFetch = 0;
    }
    if (!this._lastFetch || Date.now() - this._lastFetch > 45000) this.fetchData();
    this.render();
  }
  num(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  label(entity) {
    return entity.split('.').pop().replace('golf_range_matrix_range_matrix_', '').replaceAll('_', ' ');
  }
  field(entity) {
    return entity.split('.').pop().replace('golf_range_matrix_range_matrix_', '');
  }
  shotFromStored(row, idx) {
    const shot = { idx: idx + 1, t: new Date(row.received_at || row.timestamp || row.last_changed || Date.now()).getTime() };
    for (const entity of this.entities) shot[entity] = this.num(row[this.field(entity)]);
    return shot;
  }
  loadStoredShots() {
    const rows = novaAttrs(this._hass, this.historyEntity).shots;
    if (!Array.isArray(rows) || !rows.length) return false;
    const historyShots = rows.slice(-this.limit).map((row, idx) => this.shotFromStored(row, idx));
    this._historyShots = historyShots;
    this._shots = this.mergeShots(historyShots);
    this._error = '';
    return true;
  }
  currentShot() {
    if (!this._hass) return null;
    const shot = { idx: 0, t: Date.now() };
    let hasValue = false;
    for (const entity of this.entities) {
      const value = this.num(this._hass.states?.[entity]?.state);
      shot[entity] = value;
      if (value !== null) hasValue = true;
    }
    return hasValue ? shot : null;
  }
  addLiveShot() {
    const shot = this.currentShot();
    if (!shot || shot[this.basis] === null) return;
    const last = this._liveShots[this._liveShots.length - 1];
    if (last && Math.abs((last[this.basis] ?? 0) - shot[this.basis]) < 0.05 && Math.abs((last[this.entities[3]] ?? 0) - (shot[this.entities[3]] ?? 0)) < 0.05) return;
    this._liveShots.push(shot);
    this._liveShots = this._liveShots.slice(-this.limit);
  }
  mergeShots(historyShots) {
    const combined = [...(historyShots || [])];
    for (const live of this._liveShots || []) {
      const duplicate = combined.some(shot => Math.abs((shot[this.basis] ?? 99999) - (live[this.basis] ?? -99999)) < 0.05 && Math.abs((shot[this.entities[3]] ?? 99999) - (live[this.entities[3]] ?? -99999)) < 0.05);
      if (!duplicate) combined.push(live);
    }
    return combined.slice(-this.limit).map((shot, idx) => ({ ...shot, idx: idx + 1 }));
  }
  async fetchData() {
    if (!this._hass || this._fetching) return;
    this._fetching = true;
    this._lastFetch = Date.now();
    try {
      if (!this.loadStoredShots()) {
        const start = new Date(Date.now() - (this.config.hours_back || 168) * 3600000).toISOString();
        const rows = await this._hass.callApi('GET', `history/period/${start}?filter_entity_id=${encodeURIComponent(this.entities.join(','))}&minimal_response=1`);
        const byEntity = {};
        for (const list of rows || []) {
          for (const item of list || []) {
            byEntity[item.entity_id] = byEntity[item.entity_id] || [];
            const value = this.num(item.state);
            if (value !== null) byEntity[item.entity_id].push({ t: new Date(item.last_changed || item.last_updated).getTime(), v: value });
          }
        }
        const basisRows = byEntity[this.basis] || [];
        const historyShots = basisRows.slice(-this.limit).map((point, idx) => {
          const shot = { idx: idx + 1, t: point.t };
          for (const entity of this.entities) {
            const series = byEntity[entity] || [];
            let match = null;
            for (const item of series) {
              if (item.t <= point.t + 10000) match = item;
              else break;
            }
            shot[entity] = match?.v ?? null;
          }
          return shot;
        });
        this._historyShots = historyShots;
        this._shots = this.mergeShots(historyShots);
        this._error = '';
      }
    } catch (err) {
      this._error = err?.message || String(err);
      this._shots = this.mergeShots(this._historyShots || []);
    } finally {
      this._fetching = false;
      this.render();
    }
  }
  points(values, x0, y0, width, height) {
    const nums = values.filter(value => value !== null);
    if (!nums.length) return { path: '', dots: '' };
    let min = Math.min(...nums), max = Math.max(...nums);
    if (min === max) { min -= 1; max += 1; }
    const coords = values.map((value, index) => value === null ? null : {
      x: x0 + (values.length <= 1 ? width : index * width / (values.length - 1)),
      y: y0 + height - ((value - min) / (max - min)) * height,
    });
    const path = coords.filter(Boolean).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    const dots = coords.filter(Boolean).map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"/>`).join('');
    return { path, dots };
  }
  chart(title, series) {
    const shots = this._shots || this.mergeShots(this._historyShots || []);
    const w = 360, h = 172, x0 = 30, y0 = 28, cw = 302, ch = 92;
    const grid = [0, 1, 2, 3].map(i => `<line x1="${x0}" y1="${y0 + i * ch / 3}" x2="${x0 + cw}" y2="${y0 + i * ch / 3}"/>`).join('');
    const paths = series.map(item => {
      const data = this.points(shots.map(shot => shot[item.entity]), x0, y0, cw, ch);
      return `<g class="series" style="--c:${item.color}"><path class="line" d="${data.path}"/>${data.dots}</g>`;
    }).join('');
    const latest = series.map(item => {
      const vals = shots.map(shot => shot[item.entity]).filter(value => value !== null);
      const last = vals[vals.length - 1];
      return `<span style="--c:${item.color}"><b></b>${novaEsc(item.name)} ${last == null ? '--' : last.toFixed(item.decimals ?? 1)}</span>`;
    }).join('');
    return `<div class="chart"><div class="chartHead"><div>${novaEsc(title)}</div><small>Last ${shots.length || 0} shots</small></div><svg viewBox="0 0 ${w} ${h}"><g class="grid">${grid}</g>${paths}</svg><div class="legend">${latest}</div></div>`;
  }
  render() {
    const title = this.config.title || 'Last 50 Shots';
    const distance = [
      { entity: this.entities[0], name: 'Carry', color: '#f7ff5c' },
      { entity: this.entities[1], name: 'Total', color: '#38f8ff' },
    ].filter(item => item.entity);
    const flight = [
      { entity: this.entities[2], name: 'Offline', color: '#ff5d7a' },
      { entity: this.entities[3], name: 'Speed', color: '#72ff7d' },
    ].filter(item => item.entity);
    this.innerHTML = `<ha-card><div class="panel"><div class="head"><div><div class="kicker">Shot History</div><div class="title">${novaEsc(title)}</div></div><button>${this._fetching ? 'Loading' : 'Refresh'}</button></div>${this._error ? `<div class="error">${novaEsc(this._error)}</div>` : ''}<div class="charts">${this.chart('Distance', distance)}${this.chart('Direction + Speed', flight)}</div></div></ha-card><style>
      ha-card{border:0;border-radius:24px;background:linear-gradient(145deg,rgba(20,26,44,.92),rgba(8,12,24,.84));color:white;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.34)}.panel{padding:18px;position:relative;isolation:isolate}.panel:before{content:'';position:absolute;inset:-40% auto auto 35%;width:360px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(56,248,255,.18),transparent 64%);z-index:-1}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.kicker{color:#8ffcff;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.title{font-size:20px;font-weight:900;letter-spacing:-.04em}button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:rgba(255,255,255,.78);border-radius:999px;padding:7px 10px;font-weight:800;text-transform:uppercase;font-size:10px}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.chart{border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.055);padding:12px}.chartHead{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:14px;font-weight:850;text-transform:capitalize}.chartHead small{color:rgba(255,255,255,.48);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}svg{width:100%;height:160px}.grid line{stroke:rgba(255,255,255,.1);stroke-width:1}.line{fill:none;stroke:var(--c);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.series circle{fill:var(--c);filter:drop-shadow(0 0 8px var(--c))}.legend{display:flex;gap:10px;flex-wrap:wrap;color:rgba(255,255,255,.7);font-size:12px;font-weight:800;text-transform:capitalize}.legend span{display:flex;align-items:center;gap:5px}.legend b{display:block;width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c)}.error{color:#ff9aad;margin-bottom:10px}@media(max-width:760px){.charts{grid-template-columns:1fr}}
      ${novaTvStyles}
    </style>`;
    this.querySelector('button')?.addEventListener('click', () => { this._lastFetch = 0; this._historyShots = []; this.fetchData(); });
  }
}

class GolfSessionControlCard extends HTMLElement {
  setConfig(config) { this.config = config || {}; }
  set hass(hass) {
    this._hass = hass;
    const sig = this.renderSignature(hass);
    if (sig === this._signature && this._rendered) return;
    this._signature = sig;
    this._rendered = true;
    this.render();
  }
  renderSignature(hass) {
    const ids = [
      this.config.workflow_entity || 'sensor.golf_range_matrix_range_matrix_workflow',
      this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player',
      this.config.club_entity || 'select.golf_range_matrix_range_matrix_active_club',
      this.config.shots_per_club_entity || 'number.golf_range_matrix_range_matrix_shots_per_club',
      'switch.golf_range_matrix_range_matrix_recording',
      'sensor.golf_sim_control_status', 'sensor.golf_sim_control_sim_control_status',
      'sensor.golf_sim_control_obs_scene', 'sensor.golf_sim_control_sim_control_obs_scene',
      'sensor.golf_sim_control_scene_matches', 'sensor.golf_sim_control_sim_control_scene_matches',
    ];
    return ids.map((id) => {
      const st = hass.states?.[id];
      return `${id}:${st?.state ?? ''}:${JSON.stringify(st?.attributes ?? {})}`;
    }).join('|');
  }
  state(entity) { return novaState(this._hass, entity); }
  select(entity, option) { this._hass.callService('select', 'select_option', { entity_id: entity, option }); }
  setShots(entity, value) { this._hass.callService('number', 'set_value', { entity_id: entity, value }); }
  pressButton(entity) { this._hass.callService('button', 'press', { entity_id: entity }); }
  firstEntity(candidates) { return candidates.find(entity => novaState(this._hass, entity)) || candidates[0]; }
  pill(label, value, icon) {
    return `<div class="stat"><ha-icon icon="${icon}"></ha-icon><div><span>${novaEsc(label)}</span><b>${novaEsc(value ?? '--')}</b></div></div>`;
  }
  render() {
    const workflowEntity = this.config.workflow_entity || 'sensor.golf_range_matrix_range_matrix_workflow';
    const playerEntity = this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player';
    const clubEntity = this.config.club_entity || 'select.golf_range_matrix_range_matrix_active_club';
    const shotsEntity = this.config.shots_per_club_entity || 'number.golf_range_matrix_range_matrix_shots_per_club';
    const workflow = novaAttrs(this._hass, workflowEntity);
    const player = novaValue(this._hass, playerEntity);
    const club = novaValue(this._hass, clubEntity);
    const recording = novaValue(this._hass, 'switch.golf_range_matrix_range_matrix_recording') === 'on';
    const players = novaAttrs(this._hass, playerEntity).options || [player].filter(Boolean);
    const clubs = novaSortClubs(novaAttrs(this._hass, clubEntity).options || [club].filter(Boolean));
    const count = Number(workflow.bag_test_shot_count || 0);
    const target = Number(workflow.shots_per_club || novaValue(this._hass, shotsEntity) || 5);
    const simButtons = this.config.sim_buttons || [
      [['button.golf_sim_control_select_swing_analyzer_scene', 'button.golf_sim_control_sim_control_select_swing_analyzer_scene'], 'Scene', 'mdi:view-dashboard'],
      [['button.golf_sim_control_start_replay_buffer', 'button.golf_sim_control_sim_control_start_replay_buffer'], 'Replay', 'mdi:record-rec'],
      [['button.golf_sim_control_restart_swing_analyzer', 'button.golf_sim_control_sim_control_restart_swing_analyzer'], 'Analyzer', 'mdi:motion-play'],
      [['button.golf_sim_control_restart_obs_bridge', 'button.golf_sim_control_sim_control_restart_obs_bridge'], 'Restart OBS', 'mdi:restart'],
    ];
    const simStatus = novaValue(this._hass, this.firstEntity(['sensor.golf_sim_control_status', 'sensor.golf_sim_control_sim_control_status']));
    const obsScene = novaValue(this._hass, this.firstEntity(['sensor.golf_sim_control_obs_scene', 'sensor.golf_sim_control_sim_control_obs_scene']));
    const sceneMatches = String(novaValue(this._hass, this.firstEntity(['sensor.golf_sim_control_scene_matches', 'sensor.golf_sim_control_sim_control_scene_matches']))).toLowerCase() === 'true';
    const simOnline = simStatus && !['unknown', 'unavailable'].includes(String(simStatus).toLowerCase());
    this.innerHTML = `<ha-card><div class="panel">
      <div class="head"><div><div class="kicker">Practice Control</div><div class="title">Session Controls</div></div><div class="live ${recording ? 'on' : ''}"><span></span>${recording ? 'Recording' : 'Not Recording'}</div></div>
      <div class="stats">
        ${this.pill('Player', player, 'mdi:account')}
        ${this.pill('Club', club, 'mdi:golf-tee')}
        ${this.pill('Mode', novaValue(this._hass, workflowEntity) || 'Casual', 'mdi:golf')}
        ${this.pill('Bag Test', workflow.bag_test_active ? 'Active' : 'Off', 'mdi:format-list-numbered')}
        ${this.pill('Progress', `${Math.min(count, target)}/${target} valid`, 'mdi:counter')}
        ${this.pill('Session', workflow.session_id || 'none', 'mdi:identifier')}
      </div>
      <div class="sectionLabel">Player</div><div class="chips">${players.map(p => `<button class="chip ${p === player ? 'on' : ''}" data-player="${novaEsc(p)}">${novaEsc(p)}</button>`).join('')}</div>
      <div class="sectionLabel">Saved Bag Quick Select</div><div class="chips">${clubs.map(c => `<button class="chip ${c === club ? 'on' : ''}" data-club="${novaEsc(c)}">${novaEsc(c)}</button>`).join('')}</div>
      <div class="actions">
        <button class="action primary" data-action="map"><ha-icon icon="mdi:target"></ha-icon>Map Club</button>
        <button class="action primary" data-action="bag"><ha-icon icon="mdi:playlist-play"></ha-icon>Bag Test</button>
        <button class="action danger" data-action="discard"><ha-icon icon="mdi:delete-restore"></ha-icon>Discard</button>
        <button class="action" data-action="stop"><ha-icon icon="mdi:stop-circle"></ha-icon>Stop</button>
      </div>
      <div class="sectionLabel">SIM Control</div>
      <div class="simbar">
        <div class="simstatus ${sceneMatches ? 'ok' : ''}"><span></span>${simOnline ? `OBS: ${novaEsc(obsScene || 'unknown')}` : 'SIM agent offline'}</div>
        <div class="simactions">
          ${simButtons.map(([entities, label, icon]) => {
            const candidates = Array.isArray(entities) ? entities : [entities];
            const entity = this.firstEntity(candidates);
            // Only disable when the whole SIM agent is offline. Individual
            // button entities can briefly read unknown/unavailable (e.g. right
            // after an HA restart) yet still press fine, so don't grey them
            // out for that - it just makes the controls feel broken.
            const disabled = !simOnline;
            return `<button class="action sim ${disabled ? 'disabled' : ''}" data-button="${novaEsc(entity)}" data-button-candidates="${novaEsc(candidates.join(','))}" ${disabled ? 'disabled' : ''}><ha-icon icon="${novaEsc(icon)}"></ha-icon>${novaEsc(label)}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="stepper"><button data-step="-1">-</button><span>${target} shots per club</span><button data-step="1">+</button></div>
    </div></ha-card><style>
      ha-card{border:0;border-radius:26px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));color:white;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.34)}.panel{padding:18px;position:relative;isolation:isolate}.panel:before{content:'';position:absolute;inset:-30% auto auto 30%;width:360px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(56,248,255,.22),transparent 64%);z-index:-1}.head{display:flex;align-items:center;justify-content:space-between;gap:12px}.kicker,.sectionLabel{color:#8ffcff;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.title{font-size:24px;font-weight:950;letter-spacing:-.05em}.live{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.08);font-weight:900;color:rgba(255,255,255,.7)}.live span{width:9px;height:9px;border-radius:50%;background:#ff5d7a;box-shadow:0 0 12px #ff5d7a}.live.on span,.simstatus.ok span{background:#72ff7d;box-shadow:0 0 12px #72ff7d}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.stat{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;align-items:center;padding:12px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11)}.stat ha-icon{color:#8ffcff}.stat span{display:block;color:rgba(255,255,255,.55);font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:900}.stat b{display:block;margin-top:4px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}.chip,.action,.stepper button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:white;border-radius:999px;font-weight:900;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .07s ease,background .12s ease,box-shadow .12s ease,border-color .12s ease}.chip:hover,.action:hover,.stepper button:hover{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.28)}.chip:active,.action:active,.stepper button:active{transform:scale(.95)}.chip{padding:8px 11px}.chip.on{background:rgba(247,255,92,.16);border-color:rgba(247,255,92,.42);color:#f7ff8a}.actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:12px}.action{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border-radius:18px}.action ha-icon{color:#8ffcff}.action.primary{background:rgba(56,248,255,.12);border-color:rgba(56,248,255,.35)}.action.danger ha-icon{color:#ff8aa1}.simbar{display:grid;grid-template-columns:1fr 2fr;gap:10px;align-items:stretch;margin-top:8px}.simstatus{display:flex;align-items:center;gap:9px;padding:12px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:rgba(255,255,255,.76);font-weight:900;min-width:0}.simstatus span{width:9px;height:9px;border-radius:50%;background:#ff5d7a;box-shadow:0 0 12px #ff5d7a;flex:0 0 auto}.simactions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.action.sim{padding:10px 8px;background:rgba(56,248,255,.09);border-color:rgba(56,248,255,.25)}.action.disabled{opacity:.45;cursor:not-allowed}.action.disabled:hover{background:rgba(56,248,255,.09);border-color:rgba(56,248,255,.25);transform:none}.nova-pulse{animation:novaPress .32s ease}@keyframes novaPress{0%{transform:scale(.93);box-shadow:0 0 0 0 rgba(56,248,255,.55),inset 0 0 0 2px rgba(56,248,255,.6)}60%{box-shadow:0 0 0 8px rgba(56,248,255,0),inset 0 0 0 2px rgba(56,248,255,.35)}100%{transform:scale(1);box-shadow:0 0 0 0 rgba(56,248,255,0)}}.stepper{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding:10px 12px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);font-weight:900}.stepper button{width:34px;height:30px;color:#f7ff8a}@media(max-width:760px){.stats{grid-template-columns:1fr}.actions,.simactions{grid-template-columns:repeat(2,minmax(0,1fr))}.simbar{grid-template-columns:1fr}}
      ${novaTvStyles}
    </style>`;
    this.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => { novaPulse(b); this.select(playerEntity, b.dataset.player); }));
    this.querySelectorAll('[data-club]').forEach(b => b.addEventListener('click', () => { novaPulse(b); this.select(clubEntity, b.dataset.club); }));
    this.querySelector('[data-action="map"]')?.addEventListener('click', (ev) => { novaPulse(ev.currentTarget); novaCall(this._hass, 'start_mapping'); });
    this.querySelector('[data-action="bag"]')?.addEventListener('click', (ev) => { novaPulse(ev.currentTarget); novaCall(this._hass, 'start_bag_test'); });
    this.querySelector('[data-action="discard"]')?.addEventListener('click', (ev) => { novaPulse(ev.currentTarget); novaCall(this._hass, 'discard_last_shot'); });
    this.querySelector('[data-action="stop"]')?.addEventListener('click', (ev) => { novaPulse(ev.currentTarget); novaCall(this._hass, 'stop_session'); });
    this.querySelectorAll('[data-button]').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      novaPulse(b);
      const candidates = (b.dataset.buttonCandidates || b.dataset.button || '').split(',').filter(Boolean);
      const entity = this.firstEntity(candidates) || b.dataset.button;
      this.pressButton(entity);
    }));
    this.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { novaPulse(b); this.setShots(shotsEntity, Math.max(1, Math.min(20, target + Number(b.dataset.step)))); }));
  }
}

class NovaBagBuilderCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.catalog = this.config.catalog || ['Driver','3 Wood','5 Wood','7 Wood','3 Hybrid','4 Hybrid','5 Hybrid','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron','PW','GW','52 Wedge','54 Wedge','56 Wedge','60 Wedge','Putter'];
    this.maxClubs = this.config.max_clubs || 14;
    this._draft = null;
    this._draftPlayer = null;
  }
  connectedCallback() { novaTrackEditing(this); }
  set hass(hass) {
    this._hass = hass;
    novaTrackEditing(this);
    const sig = this.renderSignature(hass);
    if (novaIsEditing(this)) return;
    if (sig === this._signature && this._rendered) return;
    this._signature = sig;
    this._rendered = true;
    this.render();
  }
  renderSignature(hass) {
    const player = hass.states?.[this.playerEntity()];
    const club = hass.states?.[this.clubEntity()];
    return [
      player?.state,
      club?.state,
      JSON.stringify(player?.attributes?.options || []),
      JSON.stringify(club?.attributes?.options || []),
      this._draftPlayer,
      (this._draft || []).join('|'),
    ].join('::');
  }
  playerEntity() { return this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player'; }
  clubEntity() { return this.config.club_entity || 'select.golf_range_matrix_range_matrix_active_club'; }
  player() { return novaValue(this._hass, this.playerEntity()) || 'Tyler'; }
  savedBag() { return novaSortClubs(novaAttrs(this._hass, this.clubEntity()).options || []); }
  selected() {
    if (this._draftPlayer !== this.player() || !this._draft) {
      this._draftPlayer = this.player();
      this._draft = [...this.savedBag()];
    }
    return this._draft;
  }
  allClubs() {
    const clubs = [];
    [...this.catalog, ...this.savedBag(), ...this.selected()].forEach(club => {
      if (club && !clubs.some(c => c.toLowerCase() === club.toLowerCase())) clubs.push(club);
    });
    return novaSortClubs(clubs);
  }
  selectPlayer(player) { this._hass.callService('select', 'select_option', { entity_id: this.playerEntity(), option: player }); this._draft = null; }
  selectClub(club) { this._hass.callService('select', 'select_option', { entity_id: this.clubEntity(), option: club }); }
  players() { return novaAttrs(this._hass, this.playerEntity()).options || [this.player()].filter(Boolean); }
  saveProfiles(players) { return novaCall(this._hass, 'save_profile', { players: players.map(p => String(p).trim()).filter(Boolean) }); }
  addProfile(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const players = this.players();
    if (players.some(player => player.toLowerCase() === clean.toLowerCase())) return;
    this.saveProfiles([...players, clean]);
  }
  removeProfile(name) {
    const players = this.players();
    if (players.length <= 1) return;
    const next = players.filter(player => player !== name);
    this.saveProfiles(next);
    if (this.player() === name && next[0]) this.selectPlayer(next[0]);
  }
  addClub(club) {
    const clean = String(club || '').trim().replace(/\s+/g, ' ');
    if (!clean || this.selected().some(c => c.toLowerCase() === clean.toLowerCase()) || this.selected().length >= this.maxClubs) return;
    this._draft = [...this.selected(), clean];
    this.render();
  }
  toggleClub(club) {
    const selected = [...this.selected()];
    const idx = selected.findIndex(c => c.toLowerCase() === String(club).toLowerCase());
    if (idx >= 0) selected.splice(idx, 1);
    else if (selected.length < this.maxClubs) selected.push(club);
    this._draft = selected;
    this.render();
  }
  saveBag() {
    const clubs = novaSortClubs(this.selected()).slice(0, this.maxClubs);
    novaCall(this._hass, 'save_bag', { player: this.player(), clubs });
    this._draft = [...clubs];
    this._draftPlayer = this.player();
    this._signature = '';
    this.render();
  }
  changeLabel(selected, saved) {
    const added = selected.filter(c => !saved.some(s => s.toLowerCase() === c.toLowerCase())).length;
    const removed = saved.filter(c => !selected.some(s => s.toLowerCase() === c.toLowerCase())).length;
    return added || removed ? [`+${added}`, `-${removed}`].filter(p => !p.endsWith('0')).join(' / ') : 'Saved';
  }
  render() {
    const player = this.player();
    const players = this.players();
    const selected = this.selected();
    const saved = this.savedBag();
    const active = novaValue(this._hass, this.clubEntity());
    const dirty = selected.join('|') !== saved.join('|');
    this.innerHTML = `<ha-card><div class="panel">
      <div class="head"><div><div class="kicker">Player Bag</div><div class="title">Bag Builder</div></div><button class="save ${dirty ? 'dirty' : ''}">${dirty ? 'Save Changes' : 'Saved'}</button></div>
      <div class="note">Click clubs below to add or remove them from this player bag. Add a custom club if it is not in the list. Maximum ${this.maxClubs} clubs.</div>
      <div class="players">${players.map(p => `<span class="profileChip"><button class="pill ${p === player ? 'on' : ''}" data-player="${novaEsc(p)}">${novaEsc(p)}</button><button class="removeProfile" data-remove-profile="${novaEsc(p)}" ${players.length <= 1 ? 'disabled' : ''} title="Remove ${novaEsc(p)}">x</button></span>`).join('')}</div>
      <div class="profileTools"><input placeholder="Add player profile"><button class="addProfile">Add Profile</button></div>
      <div class="summary"><div><span>Player</span><b>${novaEsc(player)}</b></div><div><span>Saved Clubs</span><b>${saved.length}/${this.maxClubs}</b></div><div><span>Status</span><b>${dirty ? this.changeLabel(selected, saved) : 'Saved'}</b></div><div><span>Active</span><b>${novaEsc(active || '--')}</b></div></div>
      <div class="stripLabel">Saved bag. Click one to make it active.</div>
      <div class="bagStrip">${saved.map((club, idx) => `<button class="bagClub ${active === club ? 'active' : ''}" data-active-club="${novaEsc(club)}"><b>${idx + 1}</b>${novaEsc(club)}</button>`).join('') || '<div class="empty">Save clubs below to build this player bag.</div>'}</div>
      <div class="customClub"><input placeholder="Add custom club, ex. Mini Driver" ${selected.length >= this.maxClubs ? 'disabled' : ''}><button class="addCustom" ${selected.length >= this.maxClubs ? 'disabled' : ''}>Add Custom</button></div>
      <div class="clubGrid">${this.allClubs().map(club => {
        const inDraft = selected.some(c => c.toLowerCase() === club.toLowerCase());
        const inSaved = saved.some(c => c.toLowerCase() === club.toLowerCase());
        const disabled = selected.length >= this.maxClubs && !inDraft;
        const label = active === club ? 'Active' : inDraft && inSaved ? 'In bag' : inDraft ? 'Pending add' : inSaved ? 'Pending remove' : disabled ? 'Max 14' : 'Add';
        return `<button class="club ${inDraft ? 'inBag' : ''} ${inSaved ? 'savedClub' : ''} ${active === club ? 'active' : ''} ${disabled ? 'disabled' : ''}" data-club="${novaEsc(club)}" ${disabled ? 'disabled' : ''}><span>${novaEsc(club)}</span><small>${label}</small></button>`;
      }).join('')}</div>
    </div></ha-card><style>
      ha-card{border:0;border-radius:26px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));color:white;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.34)}.panel{padding:18px;position:relative;isolation:isolate}.panel:before{content:'';position:absolute;inset:-35% -20% auto auto;width:300px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(56,248,255,.22),transparent 64%);z-index:-1}.head{display:flex;justify-content:space-between;gap:12px;align-items:center}.kicker{color:#8ffcff;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.title{font-size:24px;font-weight:950;letter-spacing:-.05em}.note{margin-top:12px;color:rgba(255,255,255,.7);font-size:13px;font-weight:750;line-height:1.35}.save,.pill,.club,.bagClub,.addCustom,.addProfile,.removeProfile{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:white;border-radius:999px;font-weight:850}.save{padding:9px 12px;color:#b8ffbf}.save.dirty{color:#f7ff8a;border-color:rgba(247,255,92,.4);background:rgba(247,255,92,.12)}.players{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 10px}.profileChip{display:flex;align-items:center;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);overflow:hidden}.profileChip .pill{border:0;border-radius:0;background:transparent;padding:9px 10px}.profileChip .pill.on{background:rgba(247,255,92,.16);color:#f7ff8a}.removeProfile{border:0;border-left:1px solid rgba(255,255,255,.10);border-radius:0;padding:9px 10px;color:#ff9aad;background:rgba(255,93,122,.08);text-transform:uppercase}.removeProfile:disabled{opacity:.35}.profileTools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:0 0 14px}.profileTools input,.customClub input{min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(0,0,0,.22);color:white;padding:12px;font-weight:800;outline:none}.addProfile,.addCustom{border-radius:16px;padding:0 13px;color:#8ffcff}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.summary div{padding:12px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11)}.summary span,.stripLabel{display:block;color:rgba(255,255,255,.55);font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:900}.summary b{display:block;margin-top:5px;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stripLabel{margin:4px 0 8px}.bagStrip{display:flex;gap:8px;overflow:auto;padding:4px 0 12px}.bagClub{padding:8px 10px;white-space:nowrap;color:rgba(255,255,255,.78)}.bagClub b{color:#8ffcff;margin-right:6px}.bagClub.active{background:rgba(56,248,255,.16);border-color:rgba(56,248,255,.45);color:#8ffcff}.customClub{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:0 0 12px}.addCustom:disabled,.customClub input:disabled{opacity:.45}.clubGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.club{border-radius:16px;padding:12px;text-align:left;min-height:62px}.club span{display:block;font-size:15px;font-weight:900}.club small{display:block;margin-top:5px;color:rgba(255,255,255,.48);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.1em}.club.inBag{background:rgba(255,255,255,.115);border-color:rgba(255,255,255,.18)}.club.savedClub small{color:#b8ffbf}.club.active{box-shadow:inset 0 0 0 1px rgba(247,255,92,.48);color:#f7ff8a}.club.disabled{opacity:.42}.empty{color:rgba(255,255,255,.55);font-weight:800;padding:9px 0}@media(max-width:760px){.clubGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.profileTools{grid-template-columns:1fr}}
      ${novaTvStyles}
    </style>`;
    this.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => this.selectPlayer(b.dataset.player)));
    this.querySelectorAll('[data-remove-profile]').forEach(b => b.addEventListener('click', () => this.removeProfile(b.dataset.removeProfile)));
    this.querySelectorAll('[data-club]').forEach(b => b.addEventListener('click', () => this.toggleClub(b.dataset.club)));
    this.querySelectorAll('[data-active-club]').forEach(b => b.addEventListener('click', () => this.selectClub(b.dataset.activeClub)));
    this.querySelector('.save')?.addEventListener('click', () => this.saveBag());
    const profileInput = this.querySelector('.profileTools input');
    this.querySelector('.addProfile')?.addEventListener('click', () => this.addProfile(profileInput?.value));
    profileInput?.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.addProfile(profileInput.value); });
    const input = this.querySelector('.customClub input');
    this.querySelector('.addCustom')?.addEventListener('click', () => this.addClub(input?.value));
    input?.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.addClub(input.value); });
  }
}
novaDefine('range-bag-builder-card', NovaBagBuilderCard);

class NovaWedgeMatrixCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.defaultSwings = this.config.swings || ['Half', 'Waist', 'Shoulder', 'Full'];
    this.captureTarget = this.config.capture_shots || 5;
    this._draft = null;
    this._draftPlayer = null;
    this._selected = null;
    this._capture = null;
  }
  connectedCallback() { novaTrackEditing(this); }
  set hass(hass) {
    this._hass = hass;
    novaTrackEditing(this);
    this.captureShotIfNeeded(hass);
    const sig = this.renderSignature(hass);
    if (novaIsEditing(this)) return;
    if (sig === this._signature && this._rendered) return;
    this._signature = sig;
    this._rendered = true;
    this.render();
  }
  renderSignature(hass) {
    const summary = hass.states?.[this.summaryEntity()];
    const player = hass.states?.[this.playerEntity()];
    const club = hass.states?.[this.clubEntity()];
    const matrix = summary?.attributes?.wedge_matrix || {};
    return [
      player?.state,
      JSON.stringify(club?.attributes?.options || []),
      summary?.attributes?.updated_at,
      JSON.stringify(matrix),
      this._draftPlayer,
      this._selected ? `${this._selected.club}|${this._selected.swing}` : '',
      this._capture ? `${this._capture.club}|${this._capture.shots?.length}` : '',
      this._yardDraft ?? '',
    ].join('::');
  }
  playerEntity() { return this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player'; }
  clubEntity() { return this.config.club_entity || 'select.golf_range_matrix_range_matrix_active_club'; }
  summaryEntity() { return this.config.summary_entity || 'sensor.golf_range_matrix_range_matrix_player_bag_summary'; }
  carryEntity() { return this.config.carry_entity || 'sensor.golf_range_matrix_range_matrix_carry'; }
  player() { return novaValue(this._hass, this.playerEntity()) || 'Tyler'; }
  attrs() { return novaAttrs(this._hass, this.summaryEntity()); }
  savedBag() { return novaSortClubs(this.attrs().bag || novaAttrs(this._hass, this.clubEntity()).options || []); }
  swingTypes() { return this.config.swings || this.defaultSwings; }
  isWedge(club) {
    const normalized = String(club || '').trim().toLowerCase();
    if (!normalized) return false;
    if (['pw','gw','sw','lw','aw','uw'].includes(normalized)) return true;
    if (normalized.includes('wedge')) return true;
    return /^(4[6-9]|5[0-9]|6[0-4])(\s*(deg|degree|°))?\s*(wedge)?$/.test(normalized);
  }
  matrix() {
    const server = this.attrs().wedge_matrix || {};
    const serverKey = JSON.stringify(server);
    if (this._draftPlayer !== this.player() || !this._draft) {
      this._draftPlayer = this.player();
      this._draft = JSON.parse(JSON.stringify(server));
      this._matrixServerKey = serverKey;
    } else {
      // "User edited" = the draft diverged from the server snapshot we last
      // synced from. Compare against that snapshot directly (NOT dirty(),
      // which calls matrix() and would recurse infinitely). If the user has
      // no local edits and the server changed, adopt the fresh server data.
      const draftKey = JSON.stringify(this._draft);
      const userEdited = draftKey !== (this._matrixServerKey ?? draftKey);
      if (!userEdited && this._matrixServerKey !== serverKey) {
        this._draft = JSON.parse(JSON.stringify(server));
        this._matrixServerKey = serverKey;
      }
    }
    return this._draft;
  }
  wedges() { return this.savedBag().filter(club => this.isWedge(club)); }
  dirty() { return JSON.stringify(this.matrix()) !== JSON.stringify(this.attrs().wedge_matrix || {}); }
  selectCell(club, swing) {
    this._selected = { club, swing };
    this._yardDraft = undefined;
    this._signature = '';
    this.render();
  }
  updateSelected(value) {
    if (!this._selected) return;
    const matrix = this.matrix();
    matrix[this._selected.club] = matrix[this._selected.club] || {};
    const clean = String(value ?? this._yardDraft ?? '').trim();
    if (clean) matrix[this._selected.club][this._selected.swing] = clean;
    else delete matrix[this._selected.club][this._selected.swing];
    this._draft = matrix;
    this._yardDraft = undefined;
    this._signature = '';
    this.render();
  }
  save() {
    const matrix = this.matrix();
    novaCall(this._hass, 'save_wedge_matrix', { player: this.player(), matrix });
    this._matrixServerKey = JSON.stringify(matrix);
    this._yardDraft = undefined;
  }
  carryState(hass = this._hass) { return hass?.states?.[this.carryEntity()]; }
  carrySignature(hass = this._hass) { const state = this.carryState(hass); return state ? `${state.state}:${state.last_changed || state.last_updated || ''}` : ''; }
  carryValue(hass = this._hass) { const value = Number(this.carryState(hass)?.state); return Number.isFinite(value) && value > 0 ? value : null; }
  startCapture() {
    if (!this._selected) return;
    this._hass.callService('select', 'select_option', { entity_id: this.clubEntity(), option: this._selected.club });
    this._capture = { club: this._selected.club, swing: this._selected.swing, shots: [], signature: this.carrySignature() };
    this.render();
  }
  stopCapture() { this._capture = null; this.render(); }
  throwOutCaptureShot() { if (this._capture?.shots?.length) this._capture.shots.pop(); this.render(); }
  captureShotIfNeeded(hass) {
    if (!this._capture) return;
    const signature = this.carrySignature(hass);
    if (!signature || signature === this._capture.signature) return;
    this._capture.signature = signature;
    const carry = this.carryValue(hass);
    if (carry === null) return;
    this._capture.shots.push(carry);
    if (this._capture.shots.length >= this.captureTarget) {
      const avg = this._capture.shots.reduce((sum, value) => sum + value, 0) / this._capture.shots.length;
      this._selected = { club: this._capture.club, swing: this._capture.swing };
      this.updateSelected(avg.toFixed(1).replace(/\.0$/, ''));
      this._capture = null;
    }
  }
  renderTable() {
    const wedges = this.wedges();
    if (!wedges.length) return '<div class="empty">No wedges are saved in this player bag yet. Add wedges in the Bag Builder first.</div>';
    const matrix = this.matrix();
    return `<table><thead><tr><th>Swing</th>${wedges.map(club => `<th>${novaEsc(club)}</th>`).join('')}</tr></thead><tbody>${this.swingTypes().map(swing => `<tr><th>${novaEsc(swing)}</th>${wedges.map(club => {
      const value = matrix?.[club]?.[swing] || '';
      const selected = this._selected?.club === club && this._selected?.swing === swing;
      return `<td><button class="cell ${selected ? 'selected' : ''} ${value ? 'filled' : ''}" data-club="${novaEsc(club)}" data-swing="${novaEsc(swing)}">${value ? novaEsc(value) : '--'}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  render() {
    const dirty = this.dirty();
    const selected = this._selected;
    const value = selected ? this.matrix()?.[selected.club]?.[selected.swing] || '' : '';
    const yardValue = this._yardDraft !== undefined ? this._yardDraft : value;
    const capture = this._capture;
    const avg = capture?.shots?.length ? (capture.shots.reduce((sum, shot) => sum + shot, 0) / capture.shots.length).toFixed(1) : '--';
    this.innerHTML = `<ha-card><div class="panel">
      <div class="head"><div><div class="kicker">Short Game</div><div class="title">Wedge Matrix</div></div><button class="save ${dirty ? 'dirty' : ''}">${dirty ? 'Save Matrix' : 'Saved'}</button></div>
      <div class="note">Build confidence inside scoring range. This matrix only shows wedges saved in the selected player bag.</div>
      <div class="tableWrap">${this.renderTable()}</div>
      <div class="editor"><div><span>Selected</span><b>${selected ? `${novaEsc(selected.club)} / ${novaEsc(selected.swing)}` : 'Pick a cell'}</b></div><input class="yardInput" placeholder="Yards or range, ex. 74/80" ${selected ? '' : 'disabled'}><button class="apply" ${selected ? '' : 'disabled'}>Set</button></div>
      <div class="capturePanel"><div><span>5-shot capture</span><b>${capture ? `${capture.club} / ${capture.swing}: ${capture.shots.length}/${this.captureTarget} shots` : 'Pick a cell, start capture, then hit shots.'}</b><small>Running avg: ${novaEsc(avg)}</small></div><button class="captureStart" ${selected && !capture ? '' : 'disabled'}>Start</button><button class="captureThrow" ${capture?.shots?.length ? '' : 'disabled'}>Throw Out Last</button><button class="captureStop" ${capture ? '' : 'disabled'}>Reset</button></div>
      <div class="manageNote">Need another wedge here? Add it to the player bag first.</div>
    </div></ha-card><style>
      ha-card{border:0;border-radius:26px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));color:white;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.34)}.panel{padding:18px;position:relative;isolation:isolate}.panel:before{content:'';position:absolute;inset:-30% -20% auto auto;width:300px;height:250px;border-radius:50%;background:radial-gradient(circle,rgba(247,255,92,.18),transparent 64%);z-index:-1}.head{display:flex;align-items:center;justify-content:space-between;gap:12px}.kicker{color:#8ffcff;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.title{font-size:24px;font-weight:950;letter-spacing:-.05em}.note,.manageNote{margin-top:12px;color:rgba(255,255,255,.68);font-size:13px;font-weight:750;line-height:1.35}.manageNote{color:rgba(255,255,255,.48);font-size:12px}.save,.cell,.apply,.captureStart,.captureThrow,.captureStop{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:white;border-radius:999px;font-weight:900}.save{padding:9px 12px;color:#b8ffbf}.save.dirty{color:#f7ff8a;border-color:rgba(247,255,92,.4);background:rgba(247,255,92,.12)}.tableWrap{margin-top:16px;overflow:visible;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.18)}table{width:100%;table-layout:fixed;border-collapse:collapse;min-width:0}th,td{border-bottom:1px solid rgba(255,255,255,.1);border-right:1px solid rgba(255,255,255,.08);padding:8px;text-align:center}th{color:rgba(255,255,255,.58);font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.12em}thead th:first-child,tbody th{width:86px}tbody th{text-align:left;color:#8ffcff}.cell{width:100%;min-height:42px;border-radius:13px;font-size:clamp(13px,1.8vw,16px);padding:0 6px}.cell.filled{background:rgba(56,248,255,.12);border-color:rgba(56,248,255,.28);color:#d8fdff}.cell.selected{box-shadow:inset 0 0 0 1px rgba(247,255,92,.75);color:#f7ff8a}.editor,.capturePanel{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:9px;align-items:center;margin-top:12px}.capturePanel{grid-template-columns:minmax(0,1fr) auto auto auto}.editor div,.capturePanel div{padding:10px;border-radius:16px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11)}.editor span,.capturePanel span{display:block;color:rgba(255,255,255,.5);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em}.editor b,.capturePanel b{display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.capturePanel small{display:block;margin-top:4px;color:#8ffcff;font-weight:850}.yardInput{min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(0,0,0,.22);color:white;padding:12px;font-weight:850;outline:none}.apply,.captureStart,.captureThrow,.captureStop{border-radius:16px;padding:0 13px;height:42px;color:#8ffcff}.captureStart{color:#f7ff8a}.captureThrow,.captureStop{color:#ff9aad}.apply:disabled,.yardInput:disabled,.captureStart:disabled,.captureThrow:disabled,.captureStop:disabled{opacity:.45}.empty{padding:18px;color:rgba(255,255,255,.62);font-weight:850;text-align:center}@media(max-width:760px){.tableWrap{overflow:auto}table{min-width:520px}.editor,.capturePanel{grid-template-columns:1fr}.apply,.captureStart,.captureThrow,.captureStop{width:100%}}
      ${novaTvStyles}
    </style>`;
    this.querySelectorAll('[data-club]').forEach(button => button.addEventListener('click', () => this.selectCell(button.dataset.club, button.dataset.swing)));
    this.querySelector('.save')?.addEventListener('click', () => this.save());
    const yardInput = this.querySelector('.yardInput');
    if (yardInput) {
      yardInput.value = yardValue;
      yardInput.addEventListener('input', (ev) => { this._yardDraft = ev.target.value; });
      yardInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') this.updateSelected(ev.currentTarget.value);
      });
    }
    this.querySelector('.apply')?.addEventListener('click', () => {
      this.updateSelected(yardInput?.value);
      this._yardDraft = undefined;
    });
    this.querySelector('.captureStart')?.addEventListener('click', () => this.startCapture());
    this.querySelector('.captureThrow')?.addEventListener('click', () => this.throwOutCaptureShot());
    this.querySelector('.captureStop')?.addEventListener('click', () => this.stopCapture());
  }
}

class GolfClubResultsCard extends HTMLElement {
  setConfig(config) { this.config = config || {}; }
  connectedCallback() { novaTrackEditing(this); }
  set hass(hass) {
    this._hass = hass;
    novaTrackEditing(this);
    const playerEntity = this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player';
    const summaryEntity = this.config.summary_entity || 'sensor.golf_range_matrix_range_matrix_player_bag_summary';
    const attrs = novaAttrs(hass, summaryEntity);
    const sig = JSON.stringify([
      novaValue(hass, playerEntity),
      attrs.updated_at,
      (attrs.bag || []).join('|'),
      (attrs.clubs || []).map((c) => c.club).join('|'),
    ]);
    if (novaIsEditing(this)) return;
    if (sig === this._sig) return;
    this._sig = sig;
    this.render();
  }
  render() {
    const player = novaValue(this._hass, this.config.player_entity || 'select.golf_range_matrix_range_matrix_active_player') || 'Tyler';
    const attrs = novaAttrs(this._hass, this.config.summary_entity || 'sensor.golf_range_matrix_range_matrix_player_bag_summary');
    const byName = new Map((attrs.clubs || []).map((c) => [String(c.club).toLowerCase(), c]));
    const emptyClub = (name) => ({
      club: name,
      shot_count: 0,
      averages: {},
      tendencies: {},
      confidence: { rating: 'unmapped' },
      playable_yardage: {},
      ai_notes: '',
    });
    const bagNames = attrs.bag || [];
    const clubs = bagNames.length
      ? bagNames.map((name) => byName.get(String(name).toLowerCase()) || emptyClub(name))
      : novaSortClubs(attrs.clubs || [], (club) => club.club);
    const mapped = clubs.filter(club => Number(club.shot_count || 0) > 0).length;
    const totalShots = attrs.shot_count || 0;
    this.innerHTML = `<ha-card><section class="panel">
      <div class="head"><div><div class="kicker">Mapped Bag Results</div><h2>${novaEsc(player)}'s Club Cards</h2><p>${mapped} mapped clubs | ${totalShots} saved shots | updates when you re-map</p></div><div class="summaryBadge"><span>${clubs.length}</span><small>clubs</small></div></div>
      <div class="grid">${clubs.length ? clubs.map((club, index) => this.club(player, club, index)).join('') : '<div class="empty">Map or save clubs to build this results wall.</div>'}</div>
    </section></ha-card><style>
      ha-card{border:0;border-radius:30px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));color:white;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.36)}
      .panel{position:relative;isolation:isolate;padding:20px}.panel:before{content:'';position:absolute;inset:-160px -120px auto auto;width:520px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(56,248,255,.20),transparent 64%);z-index:-1}.panel:after{content:'';position:absolute;left:-140px;bottom:-180px;width:460px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(168,85,247,.22),transparent 65%);z-index:-1}
      .head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:18px}.kicker{color:#8ffcff;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.18em}h2{margin:4px 0 0;font-size:30px;line-height:1;font-weight:950;letter-spacing:-.05em}p{margin:8px 0 0;color:rgba(255,255,255,.66);font-weight:750}.summaryBadge{min-width:82px;min-height:82px;border-radius:26px;display:grid;place-items:center;background:rgba(247,255,92,.12);border:1px solid rgba(247,255,92,.35);box-shadow:inset 0 0 28px rgba(247,255,92,.08)}.summaryBadge span{font-size:30px;font-weight:950;color:#f7ff8a}.summaryBadge small{margin-top:-18px;color:rgba(255,255,255,.72);font-weight:900;text-transform:uppercase;letter-spacing:.12em}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.clubCard{border:1px solid rgba(255,255,255,.12);border-radius:26px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.035));padding:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);overflow:hidden}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.club{font-size:26px;font-weight:950;letter-spacing:-.05em}.model{margin-top:3px;color:rgba(255,255,255,.62);font-size:13px;font-weight:850}.badge{white-space:nowrap;border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);font-size:12px;font-weight:950;color:rgba(255,255,255,.72)}.badge.mapped{background:rgba(114,255,125,.13);border-color:rgba(114,255,125,.34);color:#b8ffbf}
      .body{display:grid;grid-template-columns:130px minmax(0,1fr);gap:13px;margin-top:14px}.photo{height:154px;border-radius:22px;overflow:hidden;background:radial-gradient(circle at 50% 22%,rgba(56,248,255,.22),rgba(0,0,0,.25));border:1px solid rgba(255,255,255,.10);display:grid;place-items:center}.photo img{width:100%;height:100%;object-fit:cover}.fallback{display:grid;place-items:center;gap:8px;color:#8ffcff;text-align:center}.fallback ha-icon{--mdc-icon-size:44px}.fallback strong{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:white}.numbers,.details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.numbers div,.details div{border-radius:16px;padding:10px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.09)}.numbers span,.details span{display:block;color:rgba(255,255,255,.52);font-size:10px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.numbers b{display:block;margin-top:5px;font-size:19px;font-weight:950;color:#f7ff8a}.details{margin-top:10px}.details b{display:block;margin-top:4px;font-size:14px;font-weight:900}
      .insight{display:grid;gap:4px;margin-top:12px;padding:12px;border-radius:18px;background:rgba(56,248,255,.08);border:1px solid rgba(56,248,255,.16)}.insight strong{color:#8ffcff;text-transform:capitalize}.insight span{color:rgba(255,255,255,.82);font-weight:850}.insight small{color:rgba(255,255,255,.58);font-weight:700;line-height:1.35}
      .editor{margin-top:12px;border-radius:18px;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.10);padding:9px 11px}.editor summary{cursor:pointer;font-weight:950;color:#8ffcff}.editor label{display:block;margin-top:10px;color:rgba(255,255,255,.58);font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.12em}.editor input{box-sizing:border-box;width:100%;margin-top:5px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(0,0,0,.28);color:white;padding:10px;font-weight:800;outline:none}.editor button{margin-top:11px;width:100%;border:1px solid rgba(247,255,92,.36);border-radius:14px;background:rgba(247,255,92,.12);color:#f7ff8a;padding:10px;font-weight:950}.empty{grid-column:1/-1;padding:24px;border-radius:24px;background:rgba(255,255,255,.07);color:rgba(255,255,255,.72);font-weight:850}
      @media(max-width:720px){.head{align-items:flex-start}.summaryBadge{display:none}.body{grid-template-columns:1fr}.photo{height:190px}}
      ${novaTvStyles}
    </style>`;
    this.querySelectorAll('[data-save]').forEach((button) => button.addEventListener('click', (ev) => {
      const root = ev.target.closest('[data-club]');
      novaCall(this._hass, 'save_club_metadata', {
        player, club: root.dataset.club,
        brand: root.querySelector('[name="brand"]').value,
        model: root.querySelector('[name="model"]').value,
        image_url: root.querySelector('[name="image_url"]').value,
      });
    }));
    this.querySelectorAll('[data-reset-club]').forEach((button) => button.addEventListener('click', (ev) => {
      const root = ev.target.closest('[data-club]');
      const club = root?.dataset?.club;
      if (!club) return;
      if (!window.confirm(`Reset all saved shots for ${club}?`)) return;
      novaCall(this._hass, 'reset_club_shots', { player, club });
    }));
  }
  club(player, club, index) {
    const avg = club.averages || {};
    const playable = club.playable_yardage?.carry || {};
    const meta = (novaAttrs(this._hass, this.config.summary_entity || 'sensor.golf_range_matrix_range_matrix_player_bag_summary').metadata || {})[club.club] || {};
    const shotCount = Number(club.shot_count || 0);
    const title = [meta.brand, meta.model].filter(Boolean).join(' ');
    const confidence = club.confidence?.rating || 'unmapped';
    const tendency = club.tendencies?.direction || 'Ready to map';
    const dispersion = club.tendencies?.dispersion || 'No saved shots yet';
    const image = String(meta.image_url || '').trim();
    const hero = [['Carry', avg.carry ? `${avg.carry} yd` : '--'], ['Total', avg.total ? `${avg.total} yd` : '--'], ['Playable', playable.low != null && playable.high != null ? `${playable.low}-${playable.high} yd` : '--'], ['Offline', avg.offline != null ? `${avg.offline} yd` : '--']]
      .map(([label, value]) => `<div><span>${label}</span><b>${novaEsc(value)}</b></div>`).join('');
    const details = [['Launch', avg.launch_angle ? `${avg.launch_angle} deg` : '--'], ['Spin', avg.total_spin ? `${avg.total_spin} rpm` : '--'], ['Ball', avg.ball_speed ? `${avg.ball_speed} mph` : '--'], ['Smash', avg.smash_factor ?? '--']]
      .map(([label, value]) => `<div><span>${label}</span><b>${novaEsc(value)}</b></div>`).join('');
    return `<article class="clubCard" data-club="${novaEsc(club.club)}">
      <div class="top"><div><div class="club">${novaEsc(club.club)}</div><div class="model">${novaEsc(title || 'Add brand + model')}</div></div><div class="badge ${shotCount >= 5 ? 'mapped' : ''}">${shotCount ? `${shotCount} shots` : 'unmapped'}</div></div>
      <div class="body"><div class="photo">${image ? `<img src="${novaEsc(image)}" alt="${novaEsc(club.club)}" loading="lazy">` : `<div class="fallback"><ha-icon icon="mdi:golf-tee"></ha-icon><strong>${novaEsc(club.club)}</strong></div>`}</div><div class="numbers">${hero}</div></div>
      <div class="insight"><strong>${novaEsc(confidence)} confidence</strong><span>${novaEsc(tendency)} | ${novaEsc(dispersion)}</span><small>${novaEsc(club.ai_notes || 'Map this club to unlock averages, playable yardage, and shot tendencies.')}</small></div>
      <div class="details">${details}</div>
      <details class="editor"><summary>Club details</summary><label>Brand<input name="brand" value="${novaEsc(meta.brand || '')}" placeholder="Titleist"></label><label>Model<input name="model" value="${novaEsc(meta.model || '')}" placeholder="Vokey SM10"></label><label>Image URL<input name="image_url" value="${novaEsc(image)}" placeholder="https://..."></label><button data-save="${index}">Save Club Details</button>${shotCount ? `<button class="resetClub" data-reset-club="${index}">Reset ${novaEsc(club.club)} Shots</button>` : ''}</details>
    </article>`;
  }
}

class RangeSwingVideoCard extends HTMLElement {
  setConfig(config) {
    this.config = {
      switch_entity: 'switch.golf_swing_analyzer_swing_analyzer',
      url_entity: 'sensor.golf_swing_analyzer_last_swing_annotated_url',
      timestamp_entity: 'sensor.golf_swing_analyzer_last_swing_timestamp',
      club_entity: 'sensor.golf_swing_analyzer_last_swing_club',
      summary_entity: 'sensor.golf_swing_analyzer_last_swing_summary',
      priority_entity: 'sensor.golf_swing_analyzer_last_swing_priority_fault',
      why_entity: 'sensor.golf_swing_analyzer_last_swing_why_it_matters',
      evidence_entity: 'sensor.golf_swing_analyzer_last_swing_evidence',
      drill_entity: 'sensor.golf_swing_analyzer_last_swing_drill',
      confidence_entity: 'sensor.golf_swing_analyzer_last_swing_confidence',
      llm_status_entity: 'sensor.golf_swing_analyzer_last_swing_llm_status',
      llm_error_entity: 'sensor.golf_swing_analyzer_last_swing_llm_error',
      title: 'Last Swing',
      show_coaching: false,
      ...config,
    };
  }
  set hass(hass) {
    this._hass = hass;
    const ids = [
      this.config.switch_entity, this.config.url_entity, this.config.timestamp_entity,
      this.config.club_entity, this.config.summary_entity, this.config.priority_entity,
      this.config.why_entity, this.config.evidence_entity, this.config.drill_entity,
      this.config.confidence_entity, this.config.llm_status_entity, this.config.llm_error_entity,
    ];
    const signature = ids.map((id) => `${id}:${hass.states?.[id]?.state || ''}:${hass.states?.[id]?.last_changed || ''}`).join('|');
    if (signature === this._signature) return;
    this._signature = signature;
    this.render();
  }
  src(rawUrl, rawTs) {
    if (!rawUrl || ['unknown', 'unavailable'].includes(rawUrl)) return '';
    const encoded = encodeURI(rawUrl);
    const separator = encoded.includes('?') ? '&' : '?';
    return `${encoded}${separator}t=${encodeURIComponent(rawTs || Date.now())}`;
  }
  toggle() {
    this._hass.callService('switch', 'toggle', { entity_id: this.config.switch_entity });
  }
  text(entity) {
    const st = novaState(this._hass, entity);
    const full = st?.attributes?.full_text;
    const value = (full !== undefined && full !== null && String(full).length) ? String(full) : (st?.state ?? '');
    return value && !['unknown', 'unavailable', 'none'].includes(String(value).toLowerCase()) ? String(value) : '';
  }
  coaching() {
    const priority = this.text(this.config.priority_entity);
    const why = this.text(this.config.why_entity);
    const evidence = this.text(this.config.evidence_entity);
    const drill = this.text(this.config.drill_entity);
    const confidence = this.text(this.config.confidence_entity);
    const rawStatus = this.text(this.config.llm_status_entity);
    const status = ['ok', 'waiting', ''].includes(String(rawStatus).toLowerCase()) ? '' : rawStatus;
    const error = this.text(this.config.llm_error_entity);
    const summary = this.text(this.config.summary_entity);
    const evidenceItems = evidence.split(/\s+\|\s+|\n+/).map(item => item.trim()).filter(Boolean);
    const hasAi = [priority, why, evidence, drill].some(Boolean);
    const title = hasAi ? (priority || 'Swing analysis') : 'Waiting for Trinity analysis';
    const fallback = !hasAi && summary ? `Deterministic pose fallback: ${summary}` : 'No LLM result has been published for this swing yet.';
    return `<section class="coach">
      <div class="coachHead"><div><div class="kicker">Local LLM Breakdown</div><h3>${novaEsc(title)}</h3></div>${confidence || status ? `<span>${novaEsc(confidence || status)}</span>` : ''}</div>
      ${hasAi && summary && summary !== priority ? `<p>${novaEsc(summary)}</p>` : `<p>${novaEsc(fallback)}</p>`}
      ${why ? `<div class="coachBlock"><b>Why it matters</b><p>${novaEsc(why)}</p></div>` : ''}
      ${evidenceItems.length ? `<div class="coachBlock"><b>Evidence</b><ul>${evidenceItems.map(item => `<li>${novaEsc(item)}</li>`).join('')}</ul></div>` : ''}
      ${drill ? `<div class="coachBlock"><b>Drill</b><p>${novaEsc(drill)}</p></div>` : ''}
      ${error ? `<div class="coachBlock errorText"><b>LLM status</b><p>${novaEsc(error)}</p></div>` : ''}
    </section>`;
  }
  render() {
    if (!this._hass) return;
    const sw = novaState(this._hass, this.config.switch_entity);
    const urlState = novaState(this._hass, this.config.url_entity);
    const tsState = novaState(this._hass, this.config.timestamp_entity);
    const clubState = novaState(this._hass, this.config.club_entity);
    const on = sw?.state === 'on';
    const src = this.src(urlState?.state || '', tsState?.state || urlState?.last_changed || '');
    const when = tsState?.state && !['unknown', 'unavailable'].includes(tsState.state) ? tsState.state.replace('T', ' ') : '';
    const club = clubState?.state && !['unknown', 'unavailable'].includes(clubState.state) ? clubState.state : '';
    const meta = [club, when].filter(Boolean).join(' - ');
    if (this._tool === undefined) this._tool = 'box';
    if (this._color === undefined) this._color = '#ff4d6d';
    if (this._thick === undefined) this._thick = 'm';
    if (!Array.isArray(this._shapes)) this._shapes = [];
    if (this._markupOn === undefined) this._markupOn = false;
    if (src !== this._markupSrc) { this._markupSrc = src; this._shapes = []; }
    const swatches = ['#ff4d6d', '#ffd23f', '#38f8ff', '#72ff7d', '#ffffff', '#000000'];
    const mtoolBtn = (tool, icon, label) => `<button class="mtool ${this._tool === tool ? 'sel' : ''}" data-tool="${tool}" title="${label}"><ha-icon icon="${icon}"></ha-icon></button>`;
    const thicks = [['s', 3, 'Thin'], ['m', 5, 'Medium'], ['l', 8, 'Thick'], ['xl', 12, 'X-Thick']];
    const thickBtn = ([t, px, label]) => `<button class="mtool mthick ${this._thick === t ? 'sel' : ''}" data-thick="${t}" title="${label} line"><span style="height:${px}px"></span></button>`;
    this.innerHTML = `<ha-card><div class="swing-card">
      <div class="top"><div><div class="kicker">Swing Analyzer</div><h2>${novaEsc(this.config.title)}</h2><div class="meta">${novaEsc(meta)}</div></div><button class="toggle ${on ? 'on' : ''}"><ha-icon icon="mdi:video-vintage"></ha-icon><span>${on ? 'On' : 'Off'}</span></button></div>
      ${src ? `
      <div class="fszone">
      <div class="markbar">
        <button class="mtool draw ${this._markupOn ? 'on' : ''}" data-mk="toggle"><ha-icon icon="mdi:draw"></ha-icon><span>${this._markupOn ? 'Drawing' : 'Draw'}</span></button>
        <button class="mtool" data-mk="fullscreen" title="Fullscreen (keeps markup)"><ha-icon icon="mdi:fullscreen"></ha-icon></button>
        <div class="mtools" ${this._markupOn ? '' : 'hidden'}>
          ${mtoolBtn('line', 'mdi:vector-line', 'Line + angle (spine / shaft / shoulder tilt)')}
          ${mtoolBtn('vline', 'mdi:arrow-expand-vertical', 'Plumb line (head sway / hang back)')}
          ${mtoolBtn('hline', 'mdi:arrow-expand-horizontal', 'Level line (shoulder / hip level)')}
          ${mtoolBtn('box', 'mdi:vector-rectangle', 'Box (head / impact zone)')}
          ${mtoolBtn('oval', 'mdi:vector-ellipse', 'Oval (head)')}
          ${mtoolBtn('pen', 'mdi:lead-pencil', 'Freehand')}
          <span class="msep"></span>
          ${swatches.map(c => `<button class="mswatch ${this._color === c ? 'sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
          <span class="msep"></span>
          ${thicks.map(thickBtn).join('')}
          <span class="msep"></span>
          <button class="mtool" data-mk="undo" title="Undo"><ha-icon icon="mdi:undo"></ha-icon></button>
          <button class="mtool" data-mk="clear" title="Clear all"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>
          <button class="mtool" data-mk="save" title="Save image"><ha-icon icon="mdi:content-save"></ha-icon></button>
        </div>
      </div>
      <div class="stage">
        <video class="video" muted ${this._markupOn ? '' : 'controls'} playsinline preload="auto" autoplay loop src="${novaEsc(src)}"></video>
        <canvas class="markup" style="pointer-events:${this._markupOn ? 'auto' : 'none'};cursor:${this._markupOn ? 'crosshair' : 'default'}"></canvas>
      </div>
      </div>` : `<div class="empty">No swing analyzed yet.</div>`}
      ${this.config.show_coaching ? this.coaching() : ''}
    </div></ha-card><style>
      ha-card{border:0;border-radius:28px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));color:white;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,.34)}
      .swing-card{padding:18px;position:relative;isolation:isolate}.swing-card:before{content:'';position:absolute;inset:-35% auto auto 42%;width:360px;height:250px;border-radius:50%;background:radial-gradient(circle,rgba(56,248,255,.18),transparent 65%);z-index:-1}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.kicker{color:#8ffcff;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}h2{margin:2px 0 0;font-size:25px;font-weight:950;letter-spacing:-.04em}.meta{margin-top:4px;color:rgba(255,255,255,.58);font-size:12px;font-weight:800}.toggle{height:38px;min-width:82px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:rgba(255,255,255,.78);font-weight:950;cursor:pointer}.toggle ha-icon{--mdc-icon-size:19px;color:#8ffcff}.toggle.on{background:rgba(114,255,125,.14);border-color:rgba(114,255,125,.42);color:#d8ffdc}.toggle.on ha-icon{color:#72ff7d}.stage{position:relative;border-radius:20px;overflow:hidden;line-height:0}.video{width:100%;aspect-ratio:16/9;min-height:320px;background:#000;border-radius:20px;display:block;object-fit:contain}.markup{position:absolute;left:0;top:0;touch-action:none}.markbar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:10px}.markbar .mtools{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.markbar .mtools[hidden]{display:none}.mtool{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:rgba(255,255,255,.82);font-weight:850;cursor:pointer}.mtool ha-icon{--mdc-icon-size:18px;color:#8ffcff}.mtool.sel{background:rgba(56,248,255,.16);border-color:rgba(56,248,255,.5);color:#dffaff}.mtool.draw.on{background:rgba(255,77,109,.18);border-color:rgba(255,77,109,.5);color:#ffd2dc}.mtool.draw.on ha-icon{color:#ff4d6d}.mswatch{width:22px;height:22px;padding:0;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer}.mswatch.sel{border-color:#fff;box-shadow:0 0 0 2px rgba(56,248,255,.6)}.mthick{padding:0 9px}.mthick span{display:block;width:20px;border-radius:999px;background:rgba(255,255,255,.78)}.mthick.sel span{background:#8ffcff}.msep{width:1px;height:22px;background:rgba(255,255,255,.16);margin:0 2px}.empty{display:grid;place-items:center;min-height:280px;border-radius:20px;background:rgba(0,0,0,.28);color:rgba(255,255,255,.62);font-weight:800;text-align:center;padding:14px}.fszone:fullscreen{display:flex;flex-direction:column;gap:10px;background:#070b16;padding:12px}.fszone:fullscreen .markbar{margin-bottom:0;flex:0 0 auto}.fszone:fullscreen .stage{flex:1 1 auto;display:flex;align-items:center;justify-content:center;border-radius:0;min-height:0}.fszone:fullscreen .video{width:100%;height:100%;min-height:0;aspect-ratio:auto;object-fit:contain}.coach{margin-top:14px;border:1px solid rgba(56,248,255,.18);border-radius:22px;background:rgba(56,248,255,.07);padding:14px}.coachHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.coach h3{margin:2px 0 0;font-size:20px;line-height:1.1;letter-spacing:-.03em}.coachHead span{border:1px solid rgba(247,255,92,.28);border-radius:999px;padding:6px 9px;color:#f7ff8a;font-size:11px;font-weight:950;text-transform:uppercase}.coach p{margin:8px 0 0;color:rgba(255,255,255,.80);font-weight:760;line-height:1.42}.coachBlock{margin-top:12px}.coachBlock b{display:block;color:#8ffcff;text-transform:uppercase;letter-spacing:.12em;font-size:10px}.coachBlock ul{margin:8px 0 0;padding-left:19px;color:rgba(255,255,255,.80);font-weight:760;line-height:1.4}.errorText b{color:#ff9aad}.errorText p{color:#ffd2dc}@media(max-width:900px){.video{min-height:220px}.empty{min-height:220px}}
      ${novaTvStyles}
    </style>`;
    this.querySelector('.toggle')?.addEventListener('click', () => this.toggle());
    const video = this.querySelector('video');
    if (video) {
      video.addEventListener('canplay', () => { if (!this._markupOn) video.play().catch(() => {}); });
      video.addEventListener('loadeddata', () => { if (!this._markupOn) video.play().catch(() => {}); });
    }
    this._setupMarkup();
  }
  _setupMarkup() {
    const canvas = this.querySelector('.markup');
    const video = this.querySelector('video');
    const stage = this.querySelector('.stage');
    if (!canvas || !video || !stage) return;
    const ctx = canvas.getContext('2d');

    this.querySelectorAll('[data-mk], [data-tool], [data-color], [data-thick]').forEach((el) => {
      el.addEventListener('click', () => {
        // All markup interactions update the DOM in place and never call
        // render(). Re-rendering rebuilds innerHTML, which would yank the
        // fullscreened .fszone out of the DOM and drop us out of fullscreen.
        if (el.dataset.tool) {
          this._tool = el.dataset.tool;
          this.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('sel', b.dataset.tool === this._tool));
          return;
        }
        if (el.dataset.color) {
          this._color = el.dataset.color;
          this.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('sel', b.dataset.color === this._color));
          return;
        }
        if (el.dataset.thick) {
          this._thick = el.dataset.thick;
          this.querySelectorAll('[data-thick]').forEach(b => b.classList.toggle('sel', b.dataset.thick === this._thick));
          return;
        }
        const action = el.dataset.mk;
        if (action === 'toggle') {
          this._markupOn = !this._markupOn;
          const tools = this.querySelector('.mtools');
          if (tools) tools.hidden = !this._markupOn;
          el.classList.toggle('on', this._markupOn);
          const span = el.querySelector('span'); if (span) span.textContent = this._markupOn ? 'Drawing' : 'Draw';
          canvas.style.pointerEvents = this._markupOn ? 'auto' : 'none';
          canvas.style.cursor = this._markupOn ? 'crosshair' : 'default';
          if (this._markupOn) { try { video.pause(); } catch (e) {} video.removeAttribute('controls'); }
          else { video.setAttribute('controls', ''); try { video.play().catch(() => {}); } catch (e) {} }
        } else if (action === 'fullscreen') {
          try {
            const zone = this.querySelector('.fszone') || stage;
            if (document.fullscreenElement) document.exitFullscreen();
            else (zone.requestFullscreen ? zone.requestFullscreen() : zone.webkitRequestFullscreen?.())?.catch?.(() => {});
          } catch (e) {}
        } else if (action === 'undo') {
          this._shapes.pop();
          this._redraw();
        } else if (action === 'clear') {
          this._shapes = [];
          this._redraw();
        } else if (action === 'save') {
          this._saveMarkup();
        }
      });
    });

    const sizeCanvas = () => {
      const vrect = video.getBoundingClientRect();
      const srect = stage.getBoundingClientRect();
      if (!vrect.width || !vrect.height) return;
      // Position the canvas over the *displayed image* inside the video element.
      // The video uses object-fit:contain, so when the element aspect differs
      // from the source (e.g. fullscreen), the image is letterboxed. Mapping the
      // canvas to that letterboxed image area keeps shapes (normalized 0..1 of
      // the image) locked to the body at any size/aspect.
      const iw = video.videoWidth || 16;
      const ih = video.videoHeight || 9;
      const scale = Math.min(vrect.width / iw, vrect.height / ih);
      const dispW = iw * scale;
      const dispH = ih * scale;
      const offX = (vrect.width - dispW) / 2;
      const offY = (vrect.height - dispH) / 2;
      canvas.style.left = `${vrect.left - srect.left + offX}px`;
      canvas.style.top = `${vrect.top - srect.top + offY}px`;
      canvas.style.width = `${dispW}px`;
      canvas.style.height = `${dispH}px`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(dispW * dpr));
      canvas.height = Math.max(1, Math.round(dispH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._redraw();
    };
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} }
    this._ro = new ResizeObserver(sizeCanvas);
    this._ro.observe(stage);
    this._ro.observe(video);
    video.addEventListener('loadedmetadata', sizeCanvas);
    if (this._fsHandler) document.removeEventListener('fullscreenchange', this._fsHandler);
    this._fsHandler = () => { requestAnimationFrame(sizeCanvas); requestAnimationFrame(() => requestAnimationFrame(sizeCanvas)); };
    document.addEventListener('fullscreenchange', this._fsHandler);
    sizeCanvas();
    requestAnimationFrame(sizeCanvas);

    // Bind drawing handlers regardless of markup state. The canvas only
    // receives pointer events when markup is on (pointer-events toggled in
    // place), so toggling Draw on/off no longer needs a full re-render.
    const pt = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
    };
    let drawing = false;
    canvas.addEventListener('pointerdown', (ev) => {
      drawing = true;
      canvas.setPointerCapture(ev.pointerId);
      const p = pt(ev);
      this._current = { tool: this._tool, color: this._color, thick: this._thick, pts: [p, p] };
      this._redraw();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!drawing || !this._current) return;
      const p = pt(ev);
      if (this._current.tool === 'pen') this._current.pts.push(p);
      else this._current.pts[1] = p;
      this._redraw();
    });
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      if (this._current) { this._shapes.push(this._current); this._current = null; }
      this._redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', finish);
  }
  _drawShape(ctx, shape, w, h, scale = 1) {
    const pts = shape.pts || [];
    if (!pts.length) return;
    const thickFactor = { s: 0.55, m: 1, l: 1.8, xl: 2.8 }[shape.thick || 'm'] || 1;
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = Math.max(1.5, 0.005 * Math.min(w, h)) * thickFactor * scale;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const X = (n) => n * w;
    const Y = (n) => n * h;
    ctx.beginPath();
    if (shape.tool === 'pen') {
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      ctx.stroke();
    } else if (shape.tool === 'line') {
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      ctx.lineTo(X(pts[1].x), Y(pts[1].y));
      ctx.stroke();
      const dx = X(pts[1].x) - X(pts[0].x);
      const dy = Y(pts[1].y) - Y(pts[0].y);
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        // Tilt from vertical (0 deg = straight up/down), the useful reading for
        // spine angle, shaft lean and shoulder tilt.
        let fromVert = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
        if (fromVert > 90) fromVert = 180 - fromVert;
        const deg = Math.round(fromVert);
        const mx = (X(pts[0].x) + X(pts[1].x)) / 2;
        const my = (Y(pts[0].y) + Y(pts[1].y)) / 2;
        const fs = Math.max(11, 0.028 * Math.min(w, h));
        ctx.save();
        ctx.font = `800 ${fs}px Inter, Arial, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fs * 0.18);
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(`${deg}\u00B0`, mx + fs * 0.5, my - fs * 0.5);
        ctx.fillStyle = shape.color;
        ctx.fillText(`${deg}\u00B0`, mx + fs * 0.5, my - fs * 0.5);
        ctx.restore();
      }
    } else if (shape.tool === 'vline') {
      const x = X((pts[1] || pts[0]).x);
      ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    } else if (shape.tool === 'hline') {
      const y = Y((pts[1] || pts[0]).y);
      ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    } else if (shape.tool === 'box') {
      const x = X(Math.min(pts[0].x, pts[1].x));
      const y = Y(Math.min(pts[0].y, pts[1].y));
      ctx.strokeRect(x, y, Math.abs(X(pts[1].x - pts[0].x)), Math.abs(Y(pts[1].y - pts[0].y)));
    } else if (shape.tool === 'oval') {
      const cx = X((pts[0].x + pts[1].x) / 2);
      const cy = Y((pts[0].y + pts[1].y) / 2);
      const rx = Math.abs(X(pts[1].x - pts[0].x)) / 2;
      const ry = Math.abs(Y(pts[1].y - pts[0].y)) / 2;
      ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  _redraw() {
    const canvas = this.querySelector('.markup');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    const all = [...(this._shapes || [])];
    if (this._current) all.push(this._current);
    all.forEach((s) => this._drawShape(ctx, s, w, h));
  }
  _saveMarkup() {
    const video = this.querySelector('video');
    if (!video) return;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const out = document.createElement('canvas');
    out.width = vw;
    out.height = vh;
    const octx = out.getContext('2d');
    try { octx.drawImage(video, 0, 0, vw, vh); } catch (e) { octx.fillStyle = '#000'; octx.fillRect(0, 0, vw, vh); }
    (this._shapes || []).forEach((s) => this._drawShape(octx, s, vw, vh, vw / Math.max(1, video.clientWidth)));
    const link = document.createElement('a');
    link.download = `swing-markup-${Date.now()}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  }
}

const NOVA_COACH_LOGO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABIMDRANCxIQDhAUExIVGywdGxgYGzYnKSAsQDlEQz85Pj1HUGZXR0thTT0+WXlaYWltcnNyRVV9hnxvhWZwcm7/2wBDARMUFBsXGzQdHTRuST5Jbm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm7/wAARCAA4ADgDASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAQFBgMBAv/EACsQAAIBAwMDAQgDAAAAAAAAAAECAwAEEQUSITFBURMGFSIyYXGBoRRS0f/EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/EABkRAQEBAQEBAAAAAAAAAAAAAAABETECIf/aAAwDAQACEQMRAD8A3FKUoFKgM8l9O8ccjRW0bbWZDhpG7gHsB5qu1zOlLbmySNQ7EylwWJwOO+fNE1oKVSaNry3wCyKI343LnOM9CPof1V3Ul1SlKVQpSlBSafdiCC2R+A8eST/bcd37qP7WSboLXZnJLdPsKk6hYtEZCsTyW7sZB6fzwuepA7qe4rNX80t7cRWrM/wZbOzIK+fPbxmjF5j3RATqoC527H3cDx/u2t9Wd0DRf47CVg23j4nXDPjoMdgOvPJNaKpJjXnhSlKquc80dtA80zBY0GWJ7Cq+w1drhpEuIDBJs9WJWPzp5+9Tby0hvYhHOpdAwbbnAJHnzUIaHarcLP6czSKThmnY4z170S7vx4dYk932U0duJJrwhVTftAOCev4qvGqo1694YI2vEC26RxzEg7m75UY5781ZS6dE9iLU2x9O3I9HEhBH1BBz0rmui22GR7V2EqAu7zFmDDkAEnIx5FB8XOuXFk7R3lkqSbA6bJtwI3BT2461M1jUvddqk2wOXkEY3NtAz3JwfFRV0W3MeHtXkMy7JDJOzFFyDwSfzx4rvHpFvGVJSV9rrIvqTs2COnU/WivvSdQfUInkZIlVTtBjkL5/QpU4dOmKUClKUClKUClKUClKUH//2Q==';

class RangeSwingCoachCard extends HTMLElement {
  setConfig(config) {
    this.config = {
      title: 'Local LLM Coaching',
      priority_entity: 'sensor.golf_swing_analyzer_last_swing_priority_fault',
      why_entity: 'sensor.golf_swing_analyzer_last_swing_why_it_matters',
      evidence_entity: 'sensor.golf_swing_analyzer_last_swing_evidence',
      drill_entity: 'sensor.golf_swing_analyzer_last_swing_drill',
      confidence_entity: 'sensor.golf_swing_analyzer_last_swing_confidence',
      summary_entity: 'sensor.golf_swing_analyzer_last_swing_summary',
      llm_status_entity: 'sensor.golf_swing_analyzer_last_swing_llm_status',
      llm_error_entity: 'sensor.golf_swing_analyzer_last_swing_llm_error',
      logo_url: NOVA_COACH_LOGO,
      ...config,
    };
  }
  set hass(hass) {
    this._hass = hass;
    const ids = [
      this.config.priority_entity,
      this.config.why_entity,
      this.config.evidence_entity,
      this.config.drill_entity,
      this.config.confidence_entity,
      this.config.summary_entity,
      this.config.llm_status_entity,
      this.config.llm_error_entity,
    ];
    const signature = ids.map((id) => `${id}:${hass.states?.[id]?.state || ''}:${hass.states?.[id]?.last_changed || ''}`).join('|');
    if (signature === this._signature) return;
    this._signature = signature;
    this.render();
  }
  text(entity) {
    const st = novaState(this._hass, entity);
    const full = st?.attributes?.full_text;
    const value = (full !== undefined && full !== null && String(full).length) ? String(full) : (st?.state ?? '');
    return value && !['unknown', 'unavailable', 'none'].includes(String(value).toLowerCase()) ? String(value) : '';
  }
  row(label, value) {
    return value ? `<div class="coach-row"><b>${novaEsc(label)}</b><p>${novaEsc(value)}</p></div>` : '';
  }
  render() {
    if (!this._hass) return;
    const priority = this.text(this.config.priority_entity) || 'Waiting for Trinity analysis';
    const why = this.text(this.config.why_entity);
    const evidence = this.text(this.config.evidence_entity);
    const drill = this.text(this.config.drill_entity);
    const confidence = this.text(this.config.confidence_entity);
    const summary = this.text(this.config.summary_entity);
    const status = this.text(this.config.llm_status_entity);
    const error = this.text(this.config.llm_error_entity);
    const logo = this.config.logo_url || NOVA_COACH_LOGO;
    this.innerHTML = `<ha-card>
      <section class="coach-card">
        <div class="coach-bg"></div>
        <div class="coach-titlebar">
          <img src="${novaEsc(logo)}" alt="AI Golf Coach">
          <div>
            <div class="eyebrow">AI Golf Coach</div>
            <h2>Trinity Swing Coach</h2>
          </div>
        </div>
        ${this.row('Grade / Focus', priority)}
        ${this.row('Quick Summary', why)}
        ${this.row('Observations', evidence)}
        ${this.row('Recommended Drills', drill)}
        ${this.row('Confidence / Next Swing', confidence)}
        ${this.row('Fallback metrics', summary)}
        ${status && !['ok', 'waiting', ''].includes(String(status).toLowerCase()) ? `<div class="status"><span></span>LLM status: ${novaEsc(status)}</div>` : ''}
        ${error ? `<div class="error">${novaEsc(error)}</div>` : ''}
      </section>
    </ha-card><style>
      ha-card{border:0;border-radius:24px;background:transparent;color:#eef8ff;box-shadow:0 22px 60px rgba(0,0,0,.34);overflow:hidden}
      .coach-card{position:relative;isolation:isolate;min-height:270px;padding:18px 20px;border:1px solid rgba(56,248,255,.22);border-radius:24px;background:linear-gradient(145deg,rgba(18,25,45,.94),rgba(8,12,24,.86));font-family:Inter,Roboto,Arial,sans-serif;overflow:hidden}
      .coach-bg{position:absolute;inset:0;background:radial-gradient(circle at 85% 10%,rgba(56,248,255,.18),transparent 28%),radial-gradient(circle at 15% 90%,rgba(168,85,247,.22),transparent 34%);z-index:-1}
      .coach-titlebar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
      .coach-titlebar img{width:46px;height:46px;border-radius:999px;object-fit:cover;background:rgba(255,255,255,.92);box-shadow:0 0 20px rgba(247,255,92,.22)}
      .eyebrow{color:#8ffcff;font-size:10px;font-weight:950;letter-spacing:.16em;text-transform:uppercase}
      h2{margin:2px 0 0;color:#f7ff8a;font-size:20px;line-height:1.05;font-weight:950;letter-spacing:-.03em}
      .coach-row{margin-top:10px}
      .coach-row b{display:block;color:#8ffcff;font-size:11px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}
      .coach-row p{margin:4px 0 0;color:#eef8ff;font-size:13px;font-weight:760;line-height:1.42}
      .status{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.72);font-size:11px;font-weight:900;text-transform:uppercase}
      .status span{width:8px;height:8px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 14px #ff4d6d}
      .status.ok span{background:#72ff7d;box-shadow:0 0 14px #72ff7d}
      .error{margin-top:10px;color:#ffd2dc;font-size:12px;font-weight:800}
      ${novaTvStyles}
    </style>`;
  }
}

novaDefine('range-shot-tracer-card', NovaShotTracerCard);
novaDefine('range-metric-panel-card', GolfMetricPanelCard);
novaDefine('range-shot-history-card', GolfShotHistoryCard);
novaDefine('range-session-control-card', GolfSessionControlCard);
novaDefine('range-bag-builder-card', NovaBagBuilderCard);
novaDefine('range-wedge-matrix-card', NovaWedgeMatrixCard);
novaDefine('range-club-results-card', GolfClubResultsCard);
novaDefine('range-swing-video-card', RangeSwingVideoCard);
novaDefine('range-swing-coach-card', RangeSwingCoachCard);
novaDefine('swing-video-card', RangeSwingVideoCard);
