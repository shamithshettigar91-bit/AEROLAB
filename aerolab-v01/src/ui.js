// ================= AEROLAB UI (reads simulation state, never computes physics) =================
const $ = s => document.querySelector(s);
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const CAT = [['nose', 'Nose cones'], ['payload', 'Payload'], ['avionics', 'Avionics'], ['tank', 'Propellant tanks'], ['engine', 'Engines'], ['fins', 'Fins, attached to the tail']];
const RANK = { nose: 0, payload: 1, avionics: 2, tank: 3, engine: 4 };
const DV_NEEDED = 2500;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
let design = store.get('aerolab.v01.current', null) || { name: 'Sounder', stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow'], fins: null };
let selected = null, an = null, bestDone = store.get('aerolab.v01.missionDone', false);

function partStat(d) {
  switch (d.cat) {
    case 'tank': return `${d.prop} kg propellant, ${d.mass} kg empty`;
    case 'engine': return d.type === 'solid' ? `${fmt(d.tvac / 1000, 0)} kN, Isp ${d.ispSL}–${d.ispVac} s, ${d.mass + d.prop} kg loaded`
      : `${fmt(d.tvac / 1000, 0)} kN, Isp ${d.ispSL}–${d.ispVac} s, ${d.mass} kg`;
    case 'fins': return `${d.mass} kg, pulls pressure aft`;
    default: return `${d.mass} kg, ${d.len} m long`;
  }
}
function partMass(d) { return d.mass + (d.prop || 0); }

// ---------- Builder ----------
function renderPalette() {
  const el = $('#palette'); el.innerHTML = '';
  for (const [cat, label] of CAT) {
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = `<h3>${label}</h3>`;
    for (const [id, d] of Object.entries(PARTS)) if (d.cat === cat) {
      const b = document.createElement('button'); b.className = 'pbtn';
      b.innerHTML = `<strong>${d.name}</strong><small>${partStat(d)}</small>`;
      b.title = d.note; b.onclick = () => addPart(id); g.appendChild(b);
    }
    el.appendChild(g);
  }
}
function addPart(id) {
  const d = PARTS[id];
  if (d.cat === 'fins') { design.fins = id; selected = 'fins'; return update(); }
  if (design.stack.length >= 8 && !(d.cat === 'nose' || d.cat === 'engine')) return flash('The stack is limited to 8 parts in V0.1.');
  const st = design.stack;
  if (d.cat === 'nose') { const i = st.findIndex(p => PARTS[p].cat === 'nose'); if (i >= 0) st.splice(i, 1); st.unshift(id); selected = 0; return update(); }
  if (d.cat === 'engine') { const i = st.findIndex(p => PARTS[p].cat === 'engine'); if (i >= 0) st.splice(i, 1); st.push(id); selected = st.length - 1; return update(); }
  let at = 0; st.forEach((p, i) => { if (RANK[PARTS[p].cat] <= RANK[d.cat]) at = i + 1; });
  st.splice(at, 0, id); selected = at; update();
}
function renderStack() {
  const ul = $('#stack'); ul.innerHTML = '';
  if (!design.stack.length) ul.innerHTML = '<li class="empty">Add parts from the list. They stack top to bottom.</li>';
  design.stack.forEach((id, i) => {
    const d = PARTS[id], li = document.createElement('li'); if (selected === i) li.className = 'sel';
    li.innerHTML = `<span class="nm">${d.name}</span><span class="kg">${fmt(partMass(d))} kg</span>
      <button class="ib" aria-label="Move ${d.name} up" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="ib" aria-label="Move ${d.name} down" ${i === design.stack.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="ib" aria-label="Remove ${d.name}">✕</button>`;
    const [up, dn, rm] = li.querySelectorAll('button');
    li.querySelector('.nm').onclick = () => { selected = i; update(); };
    up.onclick = () => { [design.stack[i - 1], design.stack[i]] = [design.stack[i], design.stack[i - 1]]; selected = i - 1; update(); };
    dn.onclick = () => { [design.stack[i + 1], design.stack[i]] = [design.stack[i], design.stack[i + 1]]; selected = i + 1; update(); };
    rm.onclick = () => { design.stack.splice(i, 1); selected = null; update(); };
    ul.appendChild(li);
  });
  const fr = $('#finsRow');
  if (design.fins) {
    const d = PARTS[design.fins];
    fr.innerHTML = `<ul class="stack"><li class="${selected === 'fins' ? 'sel' : ''}"><span class="nm">${d.name}, on the tail</span><span class="kg">${d.mass} kg</span><button class="ib" aria-label="Remove fins">✕</button></li></ul>`;
    fr.querySelector('.nm').onclick = () => { selected = 'fins'; update(); };
    fr.querySelector('button').onclick = () => { design.fins = null; selected = null; update(); };
  } else fr.innerHTML = '<div class="muted" style="font-size:13.5px">No fins attached.</div>';
}
function status(v, rules) { for (const [test, cls, txt] of rules) if (test(v)) return [cls, txt]; return ['', '']; }
function renderAnalysis() {
  an = analyze(design);
  const e = an.veh.eng, row = (k, v, cls = '', sub = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>` + (sub ? `<tr class="sub"><td colspan="2" style="text-align:left">${sub}</td></tr>` : '');
  const [tc, tt] = status(an.twr, [[x => x < 1, 'st-bad', 'Will not leave the pad'], [x => x < 1.5, 'st-caution', 'Slow climb, large gravity losses'],
    [x => x <= 3.5, 'st-good', 'Healthy'], [x => true, 'st-caution', 'Fast in thick air. Watch dynamic pressure.']]);
  const [sc, stx] = status(an.smFull, [[x => x < 0, 'st-bad', 'Unstable: pressure acts ahead of gravity'], [x => x < 1, 'st-caution', 'Marginal'],
    [x => x <= 3, 'st-good', 'Stable'], [x => true, 'st-caution', 'Overstable: turns hard into any wind']]);
  const dvPct = Math.min(100, an.dvVac / 4000 * 100), need = DV_NEEDED / 4000 * 100;
  const dvCls = an.dvVac >= DV_NEEDED ? 'st-good' : an.dvVac >= DV_NEEDED * 0.85 ? 'st-caution' : 'st-bad';
  $('#engTable').innerHTML =
    row('Lift-off mass', `${fmt(an.wet)} kg`) + row('Empty mass', `${fmt(an.dry)} kg`) + row('Usable propellant', `${fmt(an.prop)} kg`) +
    (e ? row('Thrust, sea level / vacuum', `${fmt(an.thrustSL / 1000, 1)} / ${fmt(an.thrustVac / 1000, 1)} kN`) : '') +
    row('Thrust-to-weight at lift-off', e ? fmt(an.twr, 2) : '—', tc, tt) +
    `<tr><td colspan="2" style="border-bottom:0;padding-bottom:0;text-align:left;font-weight:400">ΔV, vacuum <span style="float:right;font-weight:600" class="${dvCls}">${fmt(an.dvVac)} m/s</span>
      <div class="dvbar"><div style="width:${dvPct}%"></div><span style="left:${need}%"></span></div></td></tr>
      <tr class="sub"><td colspan="2" style="text-align:left">The mark shows roughly ${fmt(DV_NEEDED)} m/s, what a vertical flight to 100 km needs once gravity and drag take their share.</td></tr>` +
    row('Burn time', an.burn ? `${fmt(an.burn, 0)} s` : '—') + row('Length', `${fmt(an.L, 1)} m`) +
    row('Centre of gravity, full / empty', `${fmt(an.cgFull, 2)} / ${fmt(an.cgEmpty, 2)} m`, '', 'Measured from the nose tip.') +
    row('Centre of pressure', `${fmt(an.cp, 2)} m`) +
    row('Stability margin', `${fmt(an.smFull, 1)} cal`, sc, stx + '. One calibre is one body diameter, 0.6 m.') +
    row('Structural limit', `${fmt(an.veh.qMax / 1000)} kPa`, '', 'Maximum dynamic pressure the airframe survives.') +
    (an.veh.payloads.length ? row('Payload acceleration limit', `${an.veh.gMax} g`) : '');
  const ul = $('#issues'); ul.innerHTML = '';
  if (!an.issues.length) ul.innerHTML = '<li class="ok" style="border-left-color:var(--good)">No problems found. Ready for the pad.</li>';
  for (const i of an.issues) {
    const li = document.createElement('li'); li.className = i.level;
    li.innerHTML = `<div>${i.text}${i.part ? ` <span class="muted">(${i.part})</span>` : ''}</div><div class="fix">${i.fix}</div>`;
    ul.appendChild(li);
  }
  const errs = an.issues.filter(i => i.level === 'error').length;
  $('#launchBtn').disabled = !an.valid;
  $('#launchMsg').textContent = an.valid ? '' : `Fix ${errs} problem${errs > 1 ? 's' : ''} to launch`;
  $('#models').innerHTML = `Physics ${MODEL.physics}<br>Atmosphere ${MODEL.atmosphere}<br>Gravity ${MODEL.gravity}<br>Integrator ${MODEL.integrator}`;
}
function renderInspector() {
  const el = $('#inspector');
  let d = null;
  if (selected === 'fins' && design.fins) d = PARTS[design.fins];
  else if (typeof selected === 'number' && design.stack[selected]) d = PARTS[design.stack[selected]];
  el.innerHTML = d ? `<b>${d.name}</b><div>${d.note}</div><div class="muted">${partStat(d)}</div>`
    : `<span class="muted">Select a part in the drawing or the stack to inspect it.</span>`;
}
function update() {
  design.name = $('#dname').value.trim() || 'Sounder';
  store.set('aerolab.v01.current', design);
  renderStack(); renderAnalysis(); renderInspector(); drawBuilder();
}
function flash(msg) { $('#barMsg').textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => $('#barMsg').textContent = '', 3000); }

// ---------- Save / load (versioned, never overwrites) ----------
function refreshLoad() {
  const list = store.get('aerolab.v01.designs', []), sel = $('#loadSel');
  sel.innerHTML = '<option value="">Load design</option>' + list.map((d, i) => `<option value="${i}">${d.label}</option>`).reverse().join('');
}
$('#saveBtn').onclick = () => {
  const list = store.get('aerolab.v01.designs', []), name = (design.name || 'Sounder').replace(/[^\w\- ]/g, '');
  const n = list.filter(d => d.name === name).length + 1;
  const label = `${name}_v${String(n).padStart(3, '0')}`;
  list.push({ name, label, stack: [...design.stack], fins: design.fins, savedAt: Date.now() });
  if (store.set('aerolab.v01.designs', list)) { flash(`Saved ${label}`); refreshLoad(); } else flash('This browser blocked saving.');
};
$('#loadSel').onchange = e => {
  const list = store.get('aerolab.v01.designs', []), d = list[+e.target.value]; if (!d) return;
  design = { name: d.name, stack: [...d.stack], fins: d.fins }; $('#dname').value = d.name; selected = null; update(); flash(`Loaded ${d.label}`); e.target.value = '';
};
$('#dname').oninput = () => update();

// ---------- Rocket drawing (shared by builder and flight) ----------
const PAINT = { body: '#E3E8EE', shade: '#B6BFCB', line: '#27303E', metal: '#6A7280', metalDark: '#3B424D', accent: '#F2A541', fin: '#3C4A5E', window: '#2C4A70', tank: '#D3DAE3' };
function drawRocket(ctx, veh, sc, opt = {}) {
  const r = DIAM / 2 * sc, lw = Math.max(1, Math.min(2, sc * 0.02));
  ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.strokeStyle = PAINT.line;
  const shadeFill = (x0, w) => { const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, PAINT.shade); g.addColorStop(0.35, PAINT.body); g.addColorStop(1, PAINT.shade); return g; };
  if (veh.fins) {
    const span = (veh.design.fins === 'fins_l' ? 0.55 : 0.36) * sc, y0 = (veh.sFin - 0.4) * sc, y1 = (veh.sFin + 0.4) * sc;
    ctx.fillStyle = PAINT.fin;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r, y0); ctx.lineTo(s * (r + span), y0 + 0.5 * (y1 - y0)); ctx.lineTo(s * (r + span), y1 + 0.06 * sc); ctx.lineTo(s * r, y1); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  veh.items.forEach((it, idx) => {
    const d = it.def, h = d.len * sc; ctx.save(); ctx.translate(0, it.sTop * sc);
    ctx.fillStyle = shadeFill();
    if (d.cat === 'nose') {
      ctx.beginPath(); ctx.moveTo(-r, h);
      if (d.cpFrac < 0.5) { ctx.quadraticCurveTo(-r, h * 0.3, 0, 0); ctx.quadraticCurveTo(r, h * 0.3, r, h); }
      else { ctx.lineTo(0, 0); ctx.lineTo(r, h); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (d.cat === 'engine' && d.type === 'liquid') {
      const ts = Math.min(0.35 * sc, h * 0.3);
      ctx.fillStyle = PAINT.metalDark; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.lineTo(r * 0.45, ts); ctx.lineTo(-r * 0.45, ts); ctx.closePath(); ctx.fill(); ctx.stroke();
      const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, '#3E4550'); g.addColorStop(0.4, '#8C95A3'); g.addColorStop(1, '#3E4550');
      ctx.fillStyle = g; const tw = r * 0.28, ew = r * 0.85;
      ctx.beginPath(); ctx.moveTo(-tw, ts); ctx.lineTo(tw, ts); ctx.quadraticCurveTo(tw * 1.1, ts + (h - ts) * 0.55, ew, h); ctx.lineTo(-ew, h); ctx.quadraticCurveTo(-tw * 1.1, ts + (h - ts) * 0.55, -tw, ts); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (d.cat === 'engine') {
      const nz = Math.min(0.5 * sc, h * 0.2), body = h - nz;
      ctx.fillRect(-r, 0, 2 * r, body); ctx.strokeRect(-r, 0, 2 * r, body);
      ctx.fillStyle = PAINT.accent; ctx.fillRect(-r, body * 0.08, 2 * r, Math.max(2, 0.12 * sc)); ctx.strokeRect(-r, body * 0.08, 2 * r, Math.max(2, 0.12 * sc));
      ctx.fillStyle = PAINT.metalDark; ctx.beginPath(); ctx.moveTo(-r * 0.4, body); ctx.lineTo(r * 0.4, body); ctx.lineTo(r * 0.7, h); ctx.lineTo(-r * 0.7, h); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(-r, 0, 2 * r, h); ctx.strokeRect(-r, 0, 2 * r, h);
      if (d.cat === 'tank') { ctx.globalAlpha = 0.5; for (const y of [0.1 * sc, h - 0.1 * sc]) { ctx.beginPath(); ctx.moveTo(-r, y); ctx.lineTo(r, y); ctx.stroke(); } ctx.globalAlpha = 1; }
      if (d.cat === 'payload') { ctx.fillStyle = PAINT.accent; ctx.fillRect(-r, h * 0.72, 2 * r, h * 0.12); ctx.fillStyle = PAINT.window; ctx.beginPath(); ctx.arc(0, h * 0.38, Math.min(r * 0.3, h * 0.2), 0, 7); ctx.fill(); }
      if (d.cat === 'avionics') { ctx.fillStyle = PAINT.metalDark; const n = 4; for (let k = 0; k < n; k++) ctx.fillRect(-r + (k + 0.5) * (2 * r / n) - r * 0.08, h * 0.3, r * 0.16, h * 0.4); }
    }
    if (opt.highlight === idx) { ctx.strokeStyle = opt.hl; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(-r - 6, -3, 2 * r + 12, h + 6); ctx.setLineDash([]); ctx.strokeStyle = PAINT.line; ctx.lineWidth = lw; }
    ctx.restore();
  });
  if (opt.highlight === 'fins' && veh.fins) { const span = (veh.design.fins === 'fins_l' ? 0.55 : 0.36) * sc; ctx.strokeStyle = opt.hl; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(-r - span - 6, (veh.sFin - 0.45) * sc, 2 * (r + span) + 12, 0.95 * sc); ctx.setLineDash([]); }
}
function cgMarker(ctx, x, y, R, col, hollow) {
  ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
  if (!hollow) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, -Math.PI / 2, 0); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill(); }
}
let bGeom = null;
function drawBuilder() {
  const cv = $('#bcv'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const text = css('--text'), muted = css('--muted'), line = css('--line'), data = css('--data'), acc = css('--accent');
  // grid, like a drawing sheet
  ctx.strokeStyle = line; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let x = (W / 2) % 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const veh = an.veh; if (!veh.items.length) { ctx.fillStyle = muted; ctx.font = '15px ' + css('--font'); ctx.textAlign = 'center'; ctx.fillText('Your vehicle appears here', W / 2, H / 2); bGeom = null; return; }
  const sc = Math.min((H - 70) / veh.L, W * 0.16 / DIAM, 120), top = (H - veh.L * sc) / 2, cx = W / 2;
  bGeom = { sc, top, cx };
  ctx.save(); ctx.translate(cx, top); drawRocket(ctx, veh, sc, { highlight: selected, hl: acc }); ctx.restore();
  const r = DIAM / 2 * sc, markX = cx + r + 58;
  // centreline
  ctx.strokeStyle = muted; ctx.setLineDash([8, 4, 2, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, top - 16); ctx.lineTo(cx, top + veh.L * sc + 16); ctx.stroke(); ctx.setLineDash([]);
  // CG / CP markers
  const f = css('--font'); ctx.font = `13px ${f}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const yCg = top + an.cgFull * sc, yCgE = top + an.cgEmpty * sc, yCp = top + an.cp * sc;
  ctx.strokeStyle = data; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx, yCg); ctx.lineTo(markX - 9, yCg); ctx.stroke(); ctx.globalAlpha = 1;
  cgMarker(ctx, markX, yCg, 8, data, false); cgMarker(ctx, markX, yCgE, 5, data, true);
  ctx.fillStyle = data; ctx.fillText(`CG ${fmt(an.cgFull, 2)} m`, markX + 14, yCg);
  ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(markX, yCp, 8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(markX, yCp, 2.5, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx, yCp); ctx.lineTo(markX - 9, yCp); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillText(`CP ${fmt(an.cp, 2)} m`, markX + 14, yCp + (Math.abs(yCp - yCg) < 16 ? 16 : 0));
  // length dimension on the left
  const dx = cx - r - 60; ctx.strokeStyle = muted; ctx.fillStyle = muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(dx, top); ctx.lineTo(dx, top + veh.L * sc); ctx.stroke();
  for (const y of [top, top + veh.L * sc]) { ctx.beginPath(); ctx.moveTo(dx - 6, y); ctx.lineTo(dx + 6, y); ctx.stroke(); }
  ctx.save(); ctx.translate(dx - 10, top + veh.L * sc / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(`${fmt(veh.L, 1)} m`, 0, 0); ctx.restore();
}
$('#bcv').addEventListener('click', e => {
  if (!bGeom) return; const rc = e.target.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
  const s = (y - bGeom.top) / bGeom.sc, lat = Math.abs(x - bGeom.cx) / bGeom.sc;
  if (an.veh.fins && lat > DIAM / 2 && lat < DIAM / 2 + 0.6 && Math.abs(s - an.veh.sFin) < 0.5) { selected = 'fins'; return update(); }
  if (lat > DIAM / 2 + 0.1) { selected = null; return update(); }
  const i = an.veh.items.findIndex(it => s >= it.sTop && s < it.sBot); selected = i >= 0 ? i : null; update();
});
window.addEventListener('resize', () => { if (!$('#builder').classList.contains('hidden')) drawBuilder(); else resizeFlight(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => drawBuilder());

// ---------- Flight ----------
let F = null, fAn = null, warp = 1, keys = {}, lastFrame = 0, accum = 0, hudTick = 0, logCount = 0, particles = [], stars = [], boom = null, reportShown = false, running = false;
const WARPS = [1, 2, 5, 10, 25];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function buildWarp() {
  $('#warp').innerHTML = WARPS.map(w => `<button class="btn ${w === warp ? 'on' : ''}" data-w="${w}">${w}×</button>`).join('');
  $('#warp').querySelectorAll('button').forEach(b => b.onclick = () => setWarp(+b.dataset.w));
}
function setWarp(w) { warp = w; buildWarp(); }
function startFlight() {
  F = new Flight(design); fAn = analyze(design); warp = 1; accum = 0; logCount = 0; boom = null; reportShown = false;
  $('#log').innerHTML = ''; $('#banner').classList.add('hidden'); $('#modal').classList.add('hidden');
  $('#builder').classList.add('hidden'); $('#bbar').classList.add('hidden'); document.querySelector('.top').classList.add('hidden');
  $('#flight').classList.remove('hidden');
  const liquid = F.veh.eng.type === 'liquid';
  $('#thrCtl').style.display = liquid ? '' : 'none'; $('#thr').value = 100; $('#thrVal').textContent = '100%';
  $('#sasBtn').style.display = liquid ? '' : 'none'; $('#pl').style.display = liquid ? '' : 'none'; $('#pr').style.display = liquid ? '' : 'none';
  $('#igniteBtn').classList.remove('hidden'); $('#cutBtn').classList.add('hidden');
  syncSas(); buildWarp();
  stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.3 }));
  particles = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), l: Math.random() }));
  showBanner('On the pad', liquid ? 'Press Space or Ignite. Hold attitude keeps you pointed straight up.' : 'Press Space or Ignite. A solid motor burns to the end once lit.');
  resizeFlight(); running = true; lastFrame = performance.now(); requestAnimationFrame(loop);
}
function showBanner(h, p, btn) {
  const b = $('#banner'); b.innerHTML = `<h2>${h}</h2><div>${p}</div>` + (btn ? `<div style="margin-top:10px"><button class="btn primary" id="bannerBtn">${btn}</button></div>` : '');
  b.classList.remove('hidden'); if (btn) $('#bannerBtn').onclick = openReport;
}
function syncSas() { const b = $('#sasBtn'); b.textContent = F.sas ? 'Hold attitude on' : 'Hold attitude off'; b.classList.toggle('on', F.sas); }
function resizeFlight() {
  const cv = $('#fcv'), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
}
function ignite() { if (!F || F.engine !== 'off') return; F.ignite(); $('#banner').classList.add('hidden'); $('#igniteBtn').classList.add('hidden'); if (F.veh.eng.type === 'liquid') $('#cutBtn').classList.remove('hidden'); }
$('#igniteBtn').onclick = ignite;
$('#cutBtn').onclick = () => { if (F.shutdown()) $('#cutBtn').classList.add('hidden'); };
$('#thr').oninput = e => { F.setThrottle(e.target.value / 100); $('#thrVal').textContent = e.target.value + '%'; };
$('#sasBtn').onclick = () => { F.sas = !F.sas; if (F.sas) F.targetPitch = Math.max(0, Math.min(90, F.d.pitch)); syncSas(); };
$('#endBtn').onclick = () => { if (F && !F.done) { F.userEnded = true; F.end(); } openReport(); };
const hold = (el, v) => {
  const on = e => { e.preventDefault(); F && (F.pitchInput = v); }, off = () => { F && (F.pitchInput = 0); };
  el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, off));
};
hold($('#pl'), -1); hold($('#pr'), 1);
window.addEventListener('keydown', e => {
  if ($('#flight').classList.contains('hidden') || !F) return;
  if (!$('#modal').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); ignite(); }
  else if (k === 'w' || k === 's') { const t = $('#thr'); t.value = +t.value + (k === 'w' ? 5 : -5); t.oninput({ target: t }); }
  else if (k === 'a' || k === 'arrowleft') { F.pitchInput = -1; }
  else if (k === 'd' || k === 'arrowright') { F.pitchInput = 1; }
  else if (k === 't') $('#sasBtn').click();
  else if (k === 'x') $('#cutBtn').click();
  else if (k === '.' || k === ',') { const i = WARPS.indexOf(warp) + (k === '.' ? 1 : -1); setWarp(WARPS[Math.max(0, Math.min(WARPS.length - 1, i))]); }
  else if (k === 'escape') $('#endBtn').click();
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (F && ['a', 'd', 'arrowleft', 'arrowright'].includes(k)) F.pitchInput = 0; });

function loop(now) {
  if (!running) return;
  const real = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (!F.done) {
    accum += real * warp; let n = 0;
    while (accum >= 0.01 && n < 4000 && !F.done) { F.step(0.01); accum -= 0.01; n++; }
    if (F.done) { accum = 0; if (F.failure) boom = { t: now }; setWarp(1); }
  }
  renderFlight(real, now);
  if (++hudTick % 3 === 0) renderHud();
  if (F.done && !reportShown && (!boom || now - boom.t > 1600)) { reportShown = true; setTimeout(openReport, 250); }
  requestAnimationFrame(loop);
}

function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = i => Math.round(((pa >> i) & 255) * (1 - t) + ((pb >> i) & 255) * t); return `rgb(${c(16)},${c(8)},${c(0)})`; }
function renderFlight(real, now) {
  const cv = $('#fcv'), ctx = cv.getContext('2d'), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const d = F.d, alt = Math.max(0, d.alt), veh = F.veh, mp = F.mp || massProps(veh, F.prop);
  // sky darkens as the air thins
  const t = Math.min(1, Math.pow(Math.max(0, alt) / 70000, 0.6));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix('#3F7EC4', '#000004', t)); g.addColorStop(1, mix('#A9D0EE', '#070B18', Math.min(1, t * 1.1)));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sa = Math.min(1, Math.max(0, (alt - 25000) / 30000));
  if (sa > 0) { ctx.fillStyle = '#fff'; for (const s of stars) { ctx.globalAlpha = sa * (0.4 + 0.6 * s.s / 1.7); ctx.fillRect(s.x * W, s.y * H, s.s, s.s); } ctx.globalAlpha = 1; }
  // planet limb at altitude
  const la = Math.min(1, Math.max(0, (alt - 6000) / 12000));
  if (la > 0) {
    const k = Math.min(1, alt / 200000), R = W * (6 - 4.8 * k), topY = H * (0.8 + 0.12 * k), cy = topY + R;
    ctx.globalAlpha = la;
    const glow = ctx.createRadialGradient(W / 2, cy, R, W / 2, cy, R + 40);
    glow.addColorStop(0, 'rgba(120,180,255,.55)'); glow.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(W / 2, cy, R + 40, 0, 7); ctx.fill();
    const pg = ctx.createLinearGradient(0, topY, 0, H); pg.addColorStop(0, '#2F6FA8'); pg.addColorStop(0.3, '#1D4C7C'); pg.addColorStop(1, '#10304F');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(W / 2, cy, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  const L = veh.L, sc = Math.min(H * 0.3, 210) / L, cx = W / 2, cy = H * 0.52;
  let shx = 0, shy = 0;
  if (!reduceMotion && !F.done && F.throttle > 0) { const s = Math.min(3, d.q / 20000 + (F.clamped ? 1.5 : 0)); shx = (Math.random() - 0.5) * s; shy = (Math.random() - 0.5) * s; }
  // ground and pad
  const groundY = cy + (alt * sc) + (L - mp.cg) * sc;
  if (groundY < H + 20) {
    const padX = cx - d.downrange * sc + shx;
    ctx.fillStyle = '#56684F'; ctx.fillRect(0, groundY, W, H - groundY + 10);
    ctx.fillStyle = '#8B8F93'; ctx.fillRect(padX - DIAM * sc * 3, groundY - 4, DIAM * sc * 6, 6);
    ctx.strokeStyle = '#B04A2F'; ctx.lineWidth = 2; const tx = padX - DIAM * sc * 1.6, th = L * sc * 1.1;
    ctx.strokeRect(tx - 10, groundY - th, 10, th);
    for (let y = groundY - th; y < groundY; y += 14) { ctx.beginPath(); ctx.moveTo(tx - 10, y); ctx.lineTo(tx, y + 14); ctx.stroke(); }
  }
  // airflow streaks: they show how dense the air is and where it is coming from
  const dens = Math.min(1, Math.sqrt(d.rho / 1.225)), vp = d.velPitch * DEG;
  if (dens > 0.02 && d.speed > 5 && !F.clamped) {
    const spd = Math.min(d.speed * sc, 2200) * real, dxp = -Math.cos(vp), dyp = Math.sin(vp), len = Math.min(120, 6 + d.speed * 0.08);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * dens * Math.min(1, d.speed / 200)})`; ctx.lineWidth = 1;
    for (const p of particles) {
      p.x += dxp * spd / W; p.y += dyp * spd / H; p.x = (p.x % 1 + 1) % 1; p.y = (p.y % 1 + 1) % 1;
      const x = p.x * W, y = p.y * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dxp * len * (0.5 + p.l), y - dyp * len * (0.5 + p.l)); ctx.stroke();
    }
  }
  // vehicle, rotated from local vertical
  if (!boom) {
    ctx.save(); ctx.translate(cx + shx, cy + shy); ctx.rotate((90 - d.pitch) * DEG); ctx.translate(0, -mp.cg * sc);
    if (F.throttle > 0 && F.prop > 0) drawPlume(ctx, veh, sc, d);
    drawRocket(ctx, veh, sc);
    ctx.restore();
    // velocity marker
    if (d.speed > 20 && !F.clamped) {
      const R = L * sc * 0.72, x = cx + Math.cos(vp) * R, y = cy - Math.sin(vp) * R;
      ctx.strokeStyle = '#8FE0BE'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
      for (const a of [0, Math.PI / 2, Math.PI]) { ctx.beginPath(); ctx.moveTo(x + Math.cos(a - vp) * 7, y + Math.sin(a - vp) * 7); ctx.lineTo(x + Math.cos(a - vp) * 13, y + Math.sin(a - vp) * 13); ctx.stroke(); }
    }
  } else {
    const k = Math.min(1, (now - boom.t) / 1400);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + 160 * k);
    gr.addColorStop(0, `rgba(255,240,200,${1 - k})`); gr.addColorStop(0.4, `rgba(255,140,40,${0.8 * (1 - k)})`); gr.addColorStop(1, 'rgba(80,40,20,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 40 + 160 * k, 0, 7); ctx.fill();
    ctx.fillStyle = '#3B424D'; for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3, r = 20 + 180 * k * (0.5 + (i % 3) / 3); ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r + 60 * k * k, 6, 4); }
  }
}
function drawPlume(ctx, veh, sc, d) {
  const solid = veh.eng.type === 'solid', r = DIAM / 2 * sc, exp = 1 + 2.2 * (1 - Math.min(1, d.p / P0));
  const len = veh.L * sc * (0.45 + 0.55 * F.throttle) * (0.9 + 0.2 * Math.random()) * (0.8 + 0.5 * (exp - 1) / 2.2);
  const w0 = r * 0.8, w1 = r * (solid ? 1.2 : 0.9) * exp, y0 = veh.L * sc;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
  if (solid) { g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.25, 'rgba(255,200,110,.95)'); g.addColorStop(1, 'rgba(255,120,40,0)'); }
  else { g.addColorStop(0, 'rgba(255,245,220,1)'); g.addColorStop(0.2, 'rgba(255,178,80,.9)'); g.addColorStop(1, 'rgba(255,90,30,0)'); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w0, y0); ctx.quadraticCurveTo(-w1 * 1.1, y0 + len * 0.4, 0, y0 + len); ctx.quadraticCurveTo(w1 * 1.1, y0 + len * 0.4, w0, y0); ctx.closePath(); ctx.fill();
  if (d.p > 20000 && F.clamped === false && d.alt < 8000 && solid) {
    ctx.fillStyle = 'rgba(230,230,230,.25)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc((Math.random() - 0.5) * r * 2, y0 + len + i * r * 1.2, r * (1 + i * 0.5), 0, 7); ctx.fill(); }
  }
}
function renderHud() {
  const d = F.d, tp = F.liftoffT === null ? (F.engine === 'off' ? 0 : F.t - F.ignT) : F.t - F.liftoffT;
  const mm = Math.floor(Math.abs(tp) / 60), ss = Math.floor(Math.abs(tp) % 60);
  $('#tplus').textContent = `${F.liftoffT === null ? 'T–' : 'T+'} ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${warp > 1 ? `   ${warp}× time` : ''}`;
  $('#hAlt').innerHTML = `${fmt(Math.max(0, d.alt) / 1000, 2)}<small>km</small>`;
  const aoa = Math.asin(Math.min(1, F._aux ? F._aux.sina : 0)) / DEG;
  const qPct = Math.min(100, d.q / F.veh.qMax * 100), qCol = qPct > 80 ? '#EE6A55' : qPct > 55 ? '#E9C46A' : '#6CC4A1';
  const apo = d.apo === Infinity ? 'escape' : `${fmt(Math.max(0, d.apo) / 1000, 1)} km`;
  const rows = [
    ['Velocity', `${fmt(d.speed)} m/s`], ['Vertical speed', `${fmt(d.vr)} m/s`], ['Acceleration', `${fmt(F.sensedG || 0, 1)} g`],
    ['Mach', fmt(d.mach, 2)], ['Dynamic pressure', `${fmt(d.q / 1000, 1)} kPa`], ['meter', qPct, qCol],
    ['Angle of attack', d.speed > 20 ? fmt(aoa, 1) + '°' : '—'],
    ['Pitch', `${fmt(d.pitch, 1)}°`], ...(F.sas && F.veh.eng.gimbal > 0 ? [['Holding pitch', `${fmt(F.targetPitch, 0)}°`]] : []),
    ['Thrust', `${fmt(d.thrust / 1000, 1)} kN`], ['Thrust-to-weight', fmt(d.twr, 2)], ['Mass', `${fmt(d.mass)} kg`],
    ['Propellant', `${fmt(d.fuel * 100)}%`], ['meter', d.fuel * 100, '#F2A541'],
    ['Predicted apogee', F.clamped ? '—' : apo],
    ['Downrange', `${fmt(Math.abs(d.downrange) / 1000, 1)} km${Math.abs(d.downrange) > 100 ? (d.downrange > 0 ? ' east' : ' west') : ''}`]];
  $('#readouts').innerHTML = rows.map(r => r[0] === 'meter' ? `<span style="grid-column:1/3" class="meter"><div style="width:${r[1]}%;background:${r[2]}"></div></span>`
    : `<span class="k">${r[0]}</span><span class="v">${r[1]}</span>`).join('');
  if (F.engine !== 'running' && F.engine !== 'ignition') $('#cutBtn').classList.add('hidden');
  const ob = $('#objective'); ob.classList.toggle('done', F.reached);
  $('#objText').textContent = F.reached ? 'Payload above 100 km: complete' : `Payload above 100 km: ${fmt(Math.max(0, F.max.alt) / 1000, 1)} km so far`;
  while (logCount < F.events.length) {
    const ev = F.events[logCount++], div = document.createElement('div'); div.className = ev.kind;
    const tt = F.liftoffT === null ? 0 : ev.t - F.liftoffT;
    div.innerHTML = `<b>T${tt < 0 ? '–' : '+'}${fmt(Math.abs(tt), 1)}</b>${ev.msg}`; $('#log').prepend(div);
    while ($('#log').children.length > 8) $('#log').lastChild.remove();
  }
  if (F.apogeeT !== null && !F.done && $('#banner').classList.contains('hidden'))
    showBanner(F.reached ? 'Apogee, objective complete' : 'Apogee, short of 100 km', 'The vehicle is falling back. Keep watching at high time warp, or read the report now.', 'View flight report');
  if (hudTick % 15 === 0) drawTraj();
}
function drawTraj() {
  const cv = $('#traj'), ctx = cv.getContext('2d'), W = 220, H = 150, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const tl = F.tele; const maxA = Math.max(120000, F.max.alt * 1.1), maxD = Math.max(20000, ...tl.map(s => Math.abs(s.down))) * 1.1;
  const X = v => 26 + (v / maxD) * (W - 36) * 0.5 + (W - 36) * 0.5 - 0, Y = v => H - 18 - v / maxA * (H - 30);
  ctx.font = '11px ' + css('--font'); ctx.fillStyle = 'rgba(234,241,248,.7)';
  ctx.strokeStyle = 'rgba(234,241,248,.25)'; ctx.beginPath(); ctx.moveTo(26, H - 18); ctx.lineTo(W - 10, H - 18); ctx.stroke();
  ctx.setLineDash([4, 3]); ctx.strokeStyle = '#6CC4A1'; ctx.beginPath(); ctx.moveTo(26, Y(100000)); ctx.lineTo(W - 10, Y(100000)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText('100 km', 28, Y(100000) - 4); ctx.fillText('Altitude against downrange', 8, 13);
  ctx.strokeStyle = '#F2A541'; ctx.lineWidth = 2; ctx.beginPath();
  tl.forEach((s, i) => { const x = X(s.down), y = Y(Math.max(0, s.alt)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1;
}

// ---------- Report ----------
const CH = [
  ['alt', 'Altitude', 'km', s => s.alt / 1000], ['speed', 'Velocity', 'm/s', s => s.speed], ['g', 'Acceleration', 'g', s => s.g],
  ['q', 'Dynamic pressure', 'kPa', s => s.q / 1000], ['mach', 'Mach', '', s => s.mach], ['thrust', 'Thrust', 'kN', s => s.thrust / 1000], ['mass', 'Mass', 'kg', s => s.mass]];
let chan = 'alt';
function openReport() {
  if (!F) return; if (!F.done) F.end();
  const R = flightReport(F, fAn);
  if (R.success && !bestDone) { bestDone = true; store.set('aerolab.v01.missionDone', true); }
  $('#missionFlag').classList.toggle('done', bestDone);
  const li = a => a.map(x => `<li>${x}</li>`).join('');
  $('#repL').innerHTML = `<div class="verdict ${R.success ? 'good' : 'bad'}" id="verdict">${R.success ? 'Mission complete' : 'Mission failed'}</div>
    <div class="cause">${R.cause}</div>
    <h3>Evidence</h3><ul>${li(R.evidence)}</ul>
    ${R.factors.length ? `<h3>Contributing factors</h3><ul>${li(R.factors)}</ul>` : ''}
    <h3>${R.success ? 'Next' : 'What to try'}</h3><ul>${li(R.fixes)}</ul>`;
  const st = [[fmt(F.max.alt / 1000, 1) + ' km', 'Peak altitude'], [fmt(F.max.q / 1000, 1) + ' kPa', 'Max Q'], [fmt(F.max.g, 1) + ' g', 'Peak acceleration'], [fmt(F.max.mach, 2), 'Peak Mach']];
  $('#repStats').innerHTML = st.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  $('#chips').innerHTML = CH.map(c => `<button class="${c[0] === chan ? 'on' : ''}" data-c="${c[0]}">${c[1]}</button>`).join('');
  $('#chips').querySelectorAll('button').forEach(b => b.onclick = () => { chan = b.dataset.c; $('#chips').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); drawChart(); });
  $('#modal').classList.remove('hidden'); $('#banner').classList.add('hidden');
  requestAnimationFrame(() => drawChart()); $('#backBtn').focus();
}
let hoverX = null;
function drawChart() {
  const cv = $('#rcv'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = CH.find(x => x[0] === chan), tl = F.tele; if (tl.length < 2) return;
  const t0 = F.liftoffT ?? 0, xs = tl.map(s => s.t - t0), ys = tl.map(c[3]);
  const lim = chan === 'alt' ? 100 : chan === 'q' ? F.veh.qMax / 1000 : chan === 'g' && F.veh.payloads.length ? F.veh.gMax : null;
  let ymax = Math.max(...ys, lim ? lim * 1.05 : 0) * 1.08 || 1, ymin = Math.min(0, ...ys);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), L = 52, B = 30, T = 10, Rm = 12;
  const X = v => L + (v - x0) / (x1 - x0 || 1) * (W - L - Rm), Y = v => H - B - (v - ymin) / (ymax - ymin) * (H - B - T);
  const text = css('--text'), muted = css('--muted'), line = css('--line'), acc = css('--accent'), good = css('--good'), bad = css('--bad');
  ctx.font = '12px ' + css('--font'); ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
  const step = niceStep((ymax - ymin) / 5);
  for (let v0 = Math.ceil(ymin / step) * step; v0 <= ymax; v0 += step) { const v = Math.abs(v0) < 1e-9 ? 0 : v0; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - Rm, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmt(v, step < 1 ? 1 : 0), L - 6, Y(v) + 4); }
  const xs2 = niceStep((x1 - x0) / 6);
  for (let v0 = Math.ceil(x0 / xs2) * xs2; v0 <= x1; v0 += xs2) { const v = Math.abs(v0) < 1e-9 ? 0 : v0; ctx.textAlign = 'center'; ctx.fillText(fmt(v), X(v), H - B + 16); }
  ctx.textAlign = 'left'; ctx.fillText(`${c[1]}${c[2] ? ', ' + c[2] : ''}`, L + 4, T + 12); ctx.textAlign = 'right'; ctx.fillText('Seconds after lift-off', W - Rm, H - 2);
  if (lim) { ctx.setLineDash([5, 4]); ctx.strokeStyle = chan === 'alt' ? good : bad; ctx.beginPath(); ctx.moveTo(L, Y(lim)); ctx.lineTo(W - Rm, Y(lim)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'right'; ctx.fillText(chan === 'alt' ? 'Target' : 'Limit', W - Rm - 4, Y(lim) - 5); }
  ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); xs.forEach((x, i) => i ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i]))); ctx.stroke();
  if (hoverX !== null && hoverX > L) {
    const tv = x0 + (hoverX - L) / (W - L - Rm) * (x1 - x0); let i = xs.findIndex(x => x >= tv); if (i < 0) i = xs.length - 1;
    ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(xs[i]), T); ctx.lineTo(X(xs[i]), H - B); ctx.stroke();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(X(xs[i]), Y(ys[i]), 4, 0, 7); ctx.fill();
    ctx.fillStyle = text; ctx.textAlign = X(xs[i]) > W - 140 ? 'right' : 'left';
    ctx.fillText(`T+${fmt(xs[i], 1)} s   ${fmt(ys[i], ys[i] < 10 ? 2 : 1)} ${c[2]}`, X(xs[i]) + (ctx.textAlign === 'left' ? 8 : -8), T + 30);
  }
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
$('#rcv').addEventListener('pointermove', e => { hoverX = e.clientX - e.target.getBoundingClientRect().left; drawChart(); });
$('#rcv').addEventListener('pointerleave', () => { hoverX = null; drawChart(); });
$('#againBtn').onclick = () => { running = false; startFlight(); };
$('#backBtn').onclick = () => {
  running = false; F = null; $('#modal').classList.add('hidden'); $('#flight').classList.add('hidden');
  $('#builder').classList.remove('hidden'); $('#bbar').classList.remove('hidden'); document.querySelector('.top').classList.remove('hidden'); drawBuilder();
};
$('#modal').addEventListener('keydown', e => { if (e.key === 'Escape') $('#backBtn').click(); });
$('#launchBtn').onclick = () => { if (analyze(design).valid) startFlight(); };

// ---------- Boot ----------
$('#dname').value = design.name || 'Sounder';
$('#missionFlag').classList.toggle('done', bestDone);
renderPalette(); refreshLoad(); update();
if (document.fonts) document.fonts.ready.then(drawBuilder);
