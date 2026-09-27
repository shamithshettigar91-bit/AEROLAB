// ================= AEROLAB SIMULATION CORE (pure, no rendering) =================
// All internal units SI: kg, m, s, N, Pa, K, rad.
const G0 = 9.80665, MU = 3.986004418e14, RE = 6371000, WE = -7.2921159e-5;
const P0 = 101325, RAIR = 287.053, DIAM = 0.6, AREF = Math.PI * (DIAM / 2) ** 2;
const DEG = Math.PI / 180;
const MODEL = { physics: 'AeroModel 0.1', atmosphere: 'US76-lite 1.0', gravity: 'PointMass 1.0', integrator: 'RK4 at 100 Hz' };

// ---------- Part definitions (data, not code) ----------
const PARTS = {
  nose_ogive: { cat: 'nose', name: 'Ogive nose cone', mass: 18, len: 1.2, cd: 0.15, cna: 2, cpFrac: 0.466, qMax: 150000,
    note: 'Low drag. The pointed shape keeps pressure forward.' },
  nose_cone: { cat: 'nose', name: 'Conical nose cone', mass: 12, len: 0.8, cd: 0.24, cna: 2, cpFrac: 0.667, qMax: 150000,
    note: 'Lighter and shorter, but more drag.' },
  payload_sci: { cat: 'payload', name: 'Science payload', mass: 25, len: 0.6, qMax: 120000, gMax: 15, payload: 10,
    note: '10 kg instrument in a 15 kg housing. Survives up to 15 g.' },
  payload_heavy: { cat: 'payload', name: 'Heavy payload', mass: 85, len: 0.9, qMax: 120000, gMax: 12, payload: 60,
    note: '60 kg instrument package. Survives up to 12 g.' },
  avionics: { cat: 'avionics', name: 'Flight computer', mass: 12, len: 0.3, qMax: 150000,
    note: 'Commands engine gimbal and holds attitude. Liquid engines need one.' },
  tank_s: { cat: 'tank', name: 'Propellant tank S', mass: 40, prop: 160, len: 1.0, qMax: 120000,
    note: '160 kg kerosene and liquid oxygen.' },
  tank_m: { cat: 'tank', name: 'Propellant tank M', mass: 70, prop: 330, len: 2.0, qMax: 120000,
    note: '330 kg kerosene and liquid oxygen.' },
  tank_l: { cat: 'tank', name: 'Propellant tank L', mass: 100, prop: 500, len: 3.0, qMax: 120000,
    note: '500 kg kerosene and liquid oxygen.' },
  eng_sparrow: { cat: 'engine', type: 'liquid', name: 'LR-12 Sparrow', mass: 55, len: 0.9, tvac: 16000, ispSL: 250, ispVac: 285, gimbal: 5 * DEG, qMax: 150000,
    note: 'Small liquid engine. Throttles 40–100%, gimbals 5°.' },
  eng_heron: { cat: 'engine', type: 'liquid', name: 'LR-40 Heron', mass: 110, len: 1.3, tvac: 42000, ispSL: 262, ispVac: 298, gimbal: 4 * DEG, qMax: 150000,
    note: 'Powerful liquid engine. Throttles 40–100%, gimbals 4°.' },
  srm_needle: { cat: 'engine', type: 'solid', name: 'SR-9 Needle solid motor', mass: 140, prop: 600, len: 4.0, tvac: 24000, ispSL: 228, ispVac: 252, gimbal: 0, qMax: 150000,
    note: 'Carries its own 600 kg propellant. Cannot throttle, steer or shut down.' },
  fins_s: { cat: 'fins', name: 'Small fin set', mass: 10, cna: 6, cd: 0.03,
    note: 'Four fins at the tail. Moves the centre of pressure aft.' },
  fins_l: { cat: 'fins', name: 'Large fin set', mass: 20, cna: 11, cd: 0.06,
    note: 'Strong stability at the cost of mass and drag.' },
};
const LIMITS = { qAlpha: 4500 }; // Pa·rad bending limit (q × sin α)

// ---------- Atmosphere (US Standard 1976, simplified) ----------
const LAY = [
  [0, 288.15, -0.0065, 101325], [11000, 216.65, 0, 22632.1], [20000, 216.65, 0.001, 5474.89],
  [32000, 228.65, 0.0028, 868.019], [47000, 270.65, 0, 110.906], [51000, 270.65, -0.0028, 66.9389],
  [71000, 214.65, -0.002, 3.95642], [86000, 184.65, 0, 0.30230]];
function atmosphere(h) {
  if (h < 0) h = 0;
  let k = LAY.length - 1; while (k > 0 && h < LAY[k][0]) k--;
  const [hb, Tb, Lr, pb] = LAY[k]; const dh = h - hb;
  let T, p;
  if (Lr === 0) { T = Tb; p = pb * Math.exp(-G0 * dh / (RAIR * Tb)); }
  else { T = Tb + Lr * dh; p = pb * Math.pow(T / Tb, -G0 / (RAIR * Lr)); }
  return { T, p, rho: p / (RAIR * T), a: Math.sqrt(1.4 * RAIR * T) };
}

// ---------- Vehicle assembly ----------
function buildVehicle(design) {
  const items = []; let s = 0;
  for (const id of design.stack) {
    const def = PARTS[id]; if (!def) continue;
    items.push({ id, def, sTop: s, sMid: s + def.len / 2, sBot: s + def.len }); s += def.len;
  }
  const L = Math.max(s, 0.1);
  const fins = design.fins ? PARTS[design.fins] : null;
  const engIt = items.find(i => i.def.cat === 'engine') || null;
  const eng = engIt ? engIt.def : null;
  const tanks = items.filter(i => i.def.cat === 'tank');
  const containers = !eng ? [] : (eng.type === 'solid' ? [engIt] : tanks);
  const propCap = containers.reduce((a, i) => a + i.def.prop, 0);
  const deadProp = eng && eng.type === 'solid' ? tanks.reduce((a, i) => a + i.def.prop, 0) : (eng ? 0 : tanks.reduce((a, i) => a + i.def.prop, 0));
  const sFin = L - 0.45;
  let dryMass = items.reduce((a, i) => a + i.def.mass, 0) + (fins ? fins.mass : 0) + deadProp;
  // aerodynamics: Barrowman-style normal force slopes
  const top = items[0];
  const hasNoseTop = top && top.def.cat === 'nose';
  const aeroTerms = [];
  aeroTerms.push(hasNoseTop ? [top.def.cna, top.def.len * top.def.cpFrac] : [2, 0.05]);
  if (fins) aeroTerms.push([fins.cna, sFin]);
  const cna = aeroTerms.reduce((a, t) => a + t[0], 0);
  const cp = aeroTerms.reduce((a, t) => a + t[0] * t[1], 0) / cna;
  const cd0 = (hasNoseTop ? top.def.cd : 0.8) + 0.012 * L + (fins ? fins.cd : 0);
  const mdotMax = eng ? eng.tvac / (eng.ispVac * G0) : 0;
  const qMax = Math.min(...items.map(i => i.def.qMax || 1e9));
  const payloads = items.filter(i => i.def.cat === 'payload');
  const gMax = payloads.length ? Math.min(...payloads.map(p => p.def.gMax)) : 99;
  const sEng = engIt ? engIt.sTop + 0.25 : L;
  const hasComputer = items.some(i => i.def.cat === 'avionics');
  return { design, items, L, fins, sFin, eng, engIt, containers, propCap, deadProp, dryMass, aeroTerms, cna, cp, cd0,
    mdotMax, qMax, gMax, sEng, hasComputer, payloads };
}

function massProps(veh, prop) {
  const frac = veh.propCap > 0 ? Math.max(prop, 0) / veh.propCap : 0;
  const pts = [];
  for (const it of veh.items) {
    let m = it.def.mass;
    if (veh.containers.includes(it)) m += it.def.prop * frac;
    else if (it.def.prop && it.def.cat === 'tank') m += it.def.prop; // dead propellant
    pts.push([m, it.sMid, it.def.len]);
  }
  if (veh.fins) pts.push([veh.fins.mass, veh.sFin, 0.8]);
  let m = 0, ms = 0; for (const p of pts) { m += p[0]; ms += p[0] * p[1]; }
  const cg = m > 0 ? ms / m : 0;
  let I = 0; for (const p of pts) I += p[0] * ((p[1] - cg) ** 2 + p[2] * p[2] / 12);
  let damp = 0.05; for (const t of veh.aeroTerms) damp += 0.5 * t[0] * ((t[1] - cg) / veh.L) ** 2;
  return { m, cg, I: Math.max(I, 1), damp };
}

// ---------- Static engineering analysis (builder panel) ----------
function analyze(design) {
  const veh = buildVehicle(design);
  const full = massProps(veh, veh.propCap), empty = massProps(veh, 0);
  const e = veh.eng;
  const r = { veh, wet: full.m, dry: empty.m, prop: veh.propCap, cgFull: full.cg, cgEmpty: empty.cg, cp: veh.cp, L: veh.L,
    smFull: (veh.cp - full.cg) / DIAM, smEmpty: (veh.cp - empty.cg) / DIAM, twr: 0, dvVac: 0, dvSL: 0, burn: 0, issues: [] };
  if (e) {
    const tSL = veh.mdotMax * e.ispSL * G0;
    r.thrustSL = tSL; r.thrustVac = e.tvac; r.twr = tSL / (full.m * G0);
    if (veh.propCap > 0) {
      r.dvVac = e.ispVac * G0 * Math.log(full.m / empty.m);
      r.dvSL = e.ispSL * G0 * Math.log(full.m / empty.m);
      r.burn = veh.propCap / veh.mdotMax;
    }
  }
  const I = r.issues, st = design.stack;
  const add = (level, text, part, fix) => I.push({ level, text, part, fix });
  const engines = veh.items.filter(i => i.def.cat === 'engine');
  if (st.length === 0) add('error', 'The vehicle has no parts yet.', null, 'Add a nose cone, payload, tank and engine from the parts list.');
  if (engines.length === 0 && st.length) add('error', 'The vehicle has no engine.', null, 'Add an engine at the bottom of the stack.');
  if (engines.length > 1) add('error', 'Only one engine is supported in V0.1.', engines[1].def.name, 'Remove the extra engine. Staging arrives in V0.2.');
  if (engines.length && veh.items[veh.items.length - 1].def.cat !== 'engine') add('error', 'The engine is not at the bottom of the stack.', engines[0].def.name, 'Move the engine to the bottom.');
  const noses = veh.items.filter(i => i.def.cat === 'nose');
  if (noses.length > 1) add('error', 'The vehicle has more than one nose cone.', noses[1].def.name, 'Remove the extra nose cone.');
  if (noses.length && veh.items[0].def.cat !== 'nose') add('error', 'The nose cone is not at the top.', noses[0].def.name, 'Move the nose cone to the top of the stack.');
  if (!noses.length && st.length) add('warn', 'No nose cone. A flat top creates heavy drag.', null, 'Add a nose cone.');
  if (!veh.payloads.length && st.length) add('error', 'The mission needs a science payload on board.', null, 'Add a payload section.');
  if (e && e.type === 'liquid') {
    if (!veh.items.some(i => i.def.cat === 'tank')) add('error', 'The engine has no propellant supply.', e.name, 'Add a propellant tank above the engine.');
    if (!veh.hasComputer) add('error', 'The liquid engine has no flight computer to command it.', e.name, 'Add a flight computer.');
  }
  if (e && e.type === 'solid' && veh.items.some(i => i.def.cat === 'tank'))
    add('warn', 'Liquid tanks cannot feed a solid motor. Their propellant is dead weight.', 'Propellant tank', 'Remove the tanks.');
  if (e && r.twr > 0 && r.twr < 1) add('warn', `Lift-off thrust-to-weight is ${r.twr.toFixed(2)}. The vehicle will not leave the pad.`, e.name, 'Use a stronger engine or remove mass.');
  if (e && r.smFull < 0) add('warn', `The vehicle is aerodynamically unstable (margin ${r.smFull.toFixed(1)} cal).` +
    (e.gimbal > 0 ? ' The gimbal must fight to keep it straight.' : ' A solid motor cannot steer, so it will tumble.'), null, 'Add fins to move the centre of pressure behind the centre of gravity.');
  else if (e && r.smFull < 1 && veh.fins) add('warn', `Stability margin is thin (${r.smFull.toFixed(1)} cal). One to two calibres is typical.`, null, 'Use larger fins.');
  r.valid = !I.some(i => i.level === 'error');
  return r;
}

// ---------- Orbit calculation ----------
function orbitApo(x, y, vx, vy) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
  const eps = v2 / 2 - MU / r; if (eps >= 0) return Infinity;
  const h = x * vy - y * vx, a = -MU / (2 * eps);
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  return a * (1 + e) - RE;
}

// ---------- Drag coefficient ----------
function machFactor(M) {
  if (M < 0.8) return 1;
  if (M < 1.05) return 1 + (M - 0.8) / 0.25 * 0.9;
  if (M < 1.3) return 1.9 - (M - 1.05) / 0.25 * 0.3;
  return Math.max(1.05, 1.6 - (M - 1.3) * 0.2);
}

// ---------- Flight simulation ----------
class Flight {
  constructor(design) {
    this.veh = buildVehicle(design);
    const v = this.veh;
    this.t = 0; this.prop = v.propCap;
    this.x = 0; this.y = RE; this.vx = -WE * RE; this.vy = 0; this.th = Math.PI / 2; this.om = WE;
    this.clamped = true; this.engine = 'off'; this.ignT = 0; this.throttleCmd = 1; this.throttle = 0;
    this.gimbal = 0; this.sas = v.hasComputer; this.targetPitch = 90; this.pitchInput = 0;
    this.misalign = 0.15 * DEG; // small thrust misalignment, as on any real vehicle
    this.events = []; this.tele = []; this.teleNext = 0;
    this.max = { alt: 0, q: 0, g: 0, mach: 0, speed: 0 };
    this.loss = { grav: 0, drag: 0, delivered: 0 }; this.liftoffT = null; this.apogeeT = null; this.reached = false;
    this.done = false; this.failure = null; this.qRising = true; this.mach1 = false; this.burnout = false;
    this.d = this.derived(); this.sensedG = 1;
  }
  log(msg, kind = 'info') { this.events.push({ t: this.t, msg, kind }); }
  ignite() {
    if (this.engine !== 'off' || !this.veh.eng || this.veh.propCap <= 0) return;
    this.engine = 'ignition'; this.ignT = this.t; this.log('Ignition');
  }
  shutdown() {
    if (!this.veh.eng || this.veh.eng.type === 'solid') return false;
    if (this.engine === 'running' || this.engine === 'ignition') { this.engine = 'shutdown'; this.log('Engine cut-off commanded'); return true; }
    return false;
  }
  setThrottle(v) { if (this.veh.eng && this.veh.eng.type === 'liquid') this.throttleCmd = Math.min(1, Math.max(0.4, v)); }

  localFrame(x, y) { const r = Math.hypot(x, y); const ux = x / r, uy = y / r; return { ux, uy, ex: uy, ey: -ux }; }
  pitchOf(th, x, y) { const f = this.localFrame(x, y); const bx = Math.cos(th), by = Math.sin(th); return Math.atan2(bx * f.ux + by * f.uy, bx * f.ex + by * f.ey) / DEG; }

  deriv(S, mp) {
    const [x, y, vx, vy, th, om, prop] = S, v = this.veh;
    const r = Math.hypot(x, y), alt = r - RE, m = v.dryMass + Math.max(prop, 0);
    const atm = atmosphere(alt);
    const gm = MU / (r * r);
    let fx = -gm * x / r * m, fy = -gm * y / r * m, tau = 0;
    const bx = Math.cos(th), by = Math.sin(th);
    let T = 0, mdot = 0;
    if (this.throttle > 0 && prop > 0) {
      const e = v.eng; mdot = v.mdotMax * this.throttle;
      T = mdot * G0 * (e.ispVac - (e.ispVac - e.ispSL) * atm.p / P0);
      const d = this.gimbal + this.misalign, tx = bx * Math.cos(d) - by * Math.sin(d), ty = bx * Math.sin(d) + by * Math.cos(d);
      fx += T * tx; fy += T * ty;
      const arm = v.sEng - mp.cg; tau += -arm * bx * (T * ty) + arm * by * (T * tx);
    }
    const ax = vx + WE * y, ay = vy - WE * x; // air-relative velocity (atmosphere co-rotates)
    const va = Math.hypot(ax, ay), q = 0.5 * atm.rho * va * va;
    let D = 0, sina = 0; const tau0 = tau;
    if (va > 0.5) {
      const wx = -ax / va, wy = -ay / va, wb = wx * bx + wy * by, px = wx - wb * bx, py = wy - wb * by;
      sina = Math.hypot(px, py);
      const cd = v.cd0 * machFactor(va / atm.a) + (T > 0 ? 0 : 0.12) + 1.5 * sina * sina;
      D = q * AREF * cd; fx += D * wx; fy += D * wy;
      const N = q * AREF * v.cna; fx += N * px; fy += N * py;
      const arm = v.cp - mp.cg; tau += -arm * bx * (N * py) + arm * by * (N * px);
      tau += -mp.damp * q * AREF * v.L * v.L * om / Math.max(va, 20);
    }
    this._aux = { tauAero: tau - tau0, T, D, q, mach: va / atm.a, sina, m, atm, alt, va, gm, fxNG: fx + gm * x / r * m, fyNG: fy + gm * y / r * m };
    return [vx, vy, fx / m, fy / m, om, tau / mp.I, -mdot];
  }

  control(dt) {
    const v = this.veh, e = v.eng;
    // engine state machine: OFF → IGNITION → RUNNING → SHUTDOWN / BURNOUT
    if (this.engine === 'ignition') {
      const k = Math.min(1, (this.t - this.ignT) / 0.6); this.throttle = k * this.throttleCmd;
      if (k >= 1) { this.engine = 'running'; }
    } else if (this.engine === 'running') {
      this.throttle += Math.max(-dt * 1.5, Math.min(dt * 1.5, this.throttleCmd - this.throttle));
    } else this.throttle = 0;
    // attitude: SAS holds target pitch using the gimbal
    let cmd = 0;
    const T = this.throttle > 0 && e ? v.mdotMax * this.throttle * G0 * e.ispVac : 0;
    if (e && e.gimbal > 0 && T > 0) {
      const mp = this.mp;
      if (this.sas) {
        this.targetPitch = Math.max(0, Math.min(90, this.targetPitch - this.pitchInput * 10 * dt));
        const f = this.localFrame(this.x, this.y);
        const thT = Math.atan2(f.ey, f.ex) + this.targetPitch * DEG;
        let err = thT - this.th; err = Math.atan2(Math.sin(err), Math.cos(err));
        this.iErr = Math.max(-0.2, Math.min(0.2, (this.iErr || 0) + err * dt));
        const tauReq = mp.I * (12 * err + 4 * this.iErr - 7 * (this.om - WE)) - (this.tauAero || 0);
        const arm = v.sEng - mp.cg;
        const s = -tauReq / Math.max(arm * T, 1);
        cmd = Math.asin(Math.max(-Math.sin(e.gimbal), Math.min(Math.sin(e.gimbal), s)));
      } else cmd = this.pitchInput * e.gimbal;
    }
    const rate = 20 * DEG * dt; this.gimbal += Math.max(-rate, Math.min(rate, cmd - this.gimbal));
  }

  step(dt) {
    if (this.done) return;
    const v = this.veh;
    this.mp = massProps(v, this.prop);
    this.control(dt);
    const S = [this.x, this.y, this.vx, this.vy, this.th, this.om, this.prop];
    if (this.clamped) {
      const k1 = this.deriv(S, this.mp); const a = this._aux;
      const f = this.localFrame(this.x, this.y);
      const up = (a.fxNG) * f.ux + (a.fyNG) * f.uy; // thrust along local up
      if (a.T > 0 && up > a.m * a.gm * 1.0) { this.clamped = false; this.liftoffT = this.t; this.log('Lift-off', 'good'); }
      else {
        this.prop = Math.max(0, this.prop + k1[6] * dt);
        this.t += dt; const ang = Math.PI / 2 + WE * this.t;
        this.x = RE * Math.cos(ang); this.y = RE * Math.sin(ang); this.vx = -WE * this.y; this.vy = WE * this.x; this.th = ang; this.om = WE;
        this.after(dt, k1);
        return;
      }
    }
    const k1 = this.deriv(S, this.mp);
    const aux1 = this._aux; this.tauAero = aux1.tauAero;
    const S2 = S.map((s, i) => s + k1[i] * dt / 2), k2 = this.deriv(S2, this.mp);
    const S3 = S.map((s, i) => s + k2[i] * dt / 2), k3 = this.deriv(S3, this.mp);
    const S4 = S.map((s, i) => s + k3[i] * dt), k4 = this.deriv(S4, this.mp);
    const N = S.map((s, i) => s + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    [this.x, this.y, this.vx, this.vy, this.th, this.om, this.prop] = N;
    this.t += dt;
    // losses (evaluated with the step-start forces)
    const a = aux1;
    if (a.va > 1) {
      const r = Math.hypot(S[0], S[1]); const vr = (S[2] * S[0] + S[3] * S[1]) / r; const vs = Math.hypot(S[2], S[3]);
      if (a.T > 0) { this.loss.grav += a.gm * (vr / vs) * dt; this.loss.delivered += a.T / a.m * dt; }
      if (this.apogeeT === null) this.loss.drag += a.D / a.m * dt;
    }
    this.after(dt, k1);
  }

  after(dt, k1) {
    const v = this.veh;
    if (this.prop <= 0 && this.throttle > 0 && !this.burnout) {
      this.prop = 0; this.burnout = true; this.burnoutT = this.t; this.engine = 'burnout';
      this.log(v.eng.type === 'solid' ? 'Motor burnout' : 'Propellant depleted, engine cut-off');
    }
    if (this.engine === 'shutdown' || this.engine === 'burnout') this.throttle = 0;
    const d = this.derived(); this.d = d; const a = this._aux;
    this.sensedG = Math.hypot(a.fxNG, a.fyNG) / a.m / G0;
    if (!this.clamped) {
      this.max.alt = Math.max(this.max.alt, d.alt); this.max.speed = Math.max(this.max.speed, d.speed);
      this.max.g = Math.max(this.max.g, this.sensedG); this.max.mach = Math.max(this.max.mach, d.mach);
    }
    if (this.apogeeT === null && d.q > this.max.q) { this.max.q = d.q; this.maxQt = this.t; this.maxQalt = d.alt; }
    else if (this.apogeeT === null && this.qRising && this.max.q > 3000 && d.q < this.max.q * 0.97) { this.qRising = false; this.events.push({ t: this.maxQt, msg: `Max Q: ${(this.max.q / 1000).toFixed(1)} kPa at ${(this.maxQalt / 1000).toFixed(1)} km`, kind: 'info' }); }
    if (!this.mach1 && d.mach >= 1) { this.mach1 = true; this.log('Supersonic'); }
    if (!this.reached && d.alt >= 100000) { this.reached = true; this.log('Payload crossed 100 km. Mission objective complete.', 'good'); }
    if (!this.clamped && this.apogeeT === null && this.liftoffT !== null && this.t - this.liftoffT > 2 && d.vr < 0) {
      this.apogeeT = this.t; this.apogee = this.max.alt; this.log(`Apogee: ${(this.max.alt / 1000).toFixed(1)} km`, this.reached ? 'good' : 'bad');
    }
    // failure detection
    if (!this.failure && this.apogeeT === null) {
      if (d.q > v.qMax) this.fail('overload', `Structural overload: dynamic pressure ${(d.q / 1000).toFixed(0)} kPa exceeded the ${(v.qMax / 1000).toFixed(0)} kPa limit`);
      else if (d.q * a.sina > LIMITS.qAlpha && d.q > 2000) this.fail('breakup', `Aerodynamic break-up at ${(Math.asin(Math.min(1, a.sina)) / DEG).toFixed(1)}° angle of attack`);
      else if (!this.clamped && a.sina > 0.7 && d.speed > 30 && d.q > 500) this.fail('tumble', 'Loss of control: the vehicle tumbled')
      else if (this.sensedG > v.gMax && v.payloads.length) this.fail('gforce', `Payload destroyed at ${this.sensedG.toFixed(1)} g (limit ${v.gMax} g)`);
      else if (this.clamped && this.engine !== 'off' && (this.t - this.ignT > 4 || this.prop <= 0)) this.fail('twr', 'The vehicle never left the pad');
    }
    if (!this.clamped && d.alt <= 0 && this.liftoffT !== null && this.t - this.liftoffT > 1) {
      this.log(`Impact ${(d.downrange / 1000).toFixed(1)} km downrange`, 'bad'); this.end();
    }
    if (this.t >= this.teleNext) { this.teleNext += 0.1; this.record(d); }
  }
  fail(kind, msg) { this.failure = { kind, msg, t: this.t, alt: this.d.alt }; this.log(msg, 'bad'); this.end(); }
  end() { if (!this.done) { this.done = true; this.record(this.d); } }
  derived() {
    const r = Math.hypot(this.x, this.y), alt = r - RE, atm = atmosphere(alt);
    const ax = this.vx + WE * this.y, ay = this.vy - WE * this.x, va = Math.hypot(ax, ay);
    const vr = (this.vx * this.x + this.vy * this.y) / r;
    const padAng = Math.PI / 2 + WE * this.t, ang = Math.atan2(this.y, this.x);
    let dang = padAng - ang; dang = Math.atan2(Math.sin(dang), Math.cos(dang));
    const m = this.veh.dryMass + this.prop;
    const e = this.veh.eng; const T = e && this.throttle > 0 && this.prop > 0 ? this.veh.mdotMax * this.throttle * G0 * (e.ispVac - (e.ispVac - e.ispSL) * atm.p / P0) : 0;
    const q = 0.5 * atm.rho * va * va;
    return { alt, speed: va, vr, q, mach: va / atm.a, downrange: RE * dang, mass: m, thrust: T, twr: T / (m * MU / (r * r)),
      pitch: this.pitchOf(this.th, this.x, this.y), velPitch: va > 1 ? this.pitchOf(Math.atan2(ay, ax), this.x, this.y) : 90,
      apo: this.clamped ? 0 : orbitApo(this.x, this.y, this.vx, this.vy), p: atm.p, rho: atm.rho, fuel: this.veh.propCap ? this.prop / this.veh.propCap : 0 };
  }
  record(d) {
    this.tele.push({ t: this.t, alt: d.alt, speed: d.speed, g: this.sensedG || 0, q: d.q, mass: d.mass, mach: d.mach, thrust: d.thrust, fuel: d.fuel, down: d.downrange });
  }
}

// ---------- Flight report / failure analysis ----------
function flightReport(f, an) {
  const v = f.veh;
  const R = { success: f.reached, cause: '', evidence: [], factors: [], fixes: [] };
  const km = x => (x / 1000).toFixed(1) + ' km';
  const apo = f.apogee ?? f.max.alt;
  if (f.reached) {
    R.cause = f.failure ? `Objective complete. The vehicle was then lost: ${f.failure.msg.toLowerCase()}.` : 'Science payload carried above 100 km.';
    R.evidence.push(`Peak altitude ${km(f.max.alt)}`, `Margin above target ${km(f.max.alt - 100000)}`);
    if (an.dvVac > 0) R.evidence.push(`ΔV available ${an.dvVac.toFixed(0)} m/s`);
    if (f.max.alt > 160000) R.fixes.push('There is a lot of spare performance. Try the heavy payload or a smaller tank.');
    else R.fixes.push('Try the heavy payload next, or reach 100 km with a lighter vehicle.');
    return R;
  }
  if (f.failure) {
    const k = f.failure.kind;
    R.evidence.push(`Failure at T+${(f.failure.t - (f.liftoffT ?? 0)).toFixed(1)} s, altitude ${km(f.failure.alt)}`);
    if (k === 'twr') {
      R.cause = 'Insufficient lift-off thrust.';
      R.evidence.push(`Thrust-to-weight ${an.twr.toFixed(2)}, required above 1.00`, `Lift-off mass ${an.wet.toFixed(0)} kg`);
      R.fixes.push('Use a stronger engine.', 'Carry less propellant or a lighter payload.');
    } else if (k === 'overload') {
      R.cause = 'Structural overload from excessive dynamic pressure.';
      R.evidence.push(`Dynamic pressure reached ${(f.max.q / 1000).toFixed(0)} kPa`, `Structural limit ${(v.qMax / 1000).toFixed(0)} kPa`, `Speed ${f.d.speed.toFixed(0)} m/s in dense air`);
      R.factors.push(`Lift-off thrust-to-weight of ${an.twr.toFixed(2)} accelerates the vehicle hard while the air is still thick.`);
      R.fixes.push(v.eng.type === 'liquid' ? 'Throttle down between about 5 and 15 km, then return to full throttle.' : 'A solid motor cannot throttle. Use a liquid engine or add mass.', 'Use a lower-thrust engine.');
    } else if (k === 'breakup') {
      R.cause = 'The vehicle turned sideways into the airflow and broke apart.';
      R.evidence.push(`Stability margin at lift-off ${an.smFull.toFixed(1)} calibres`, `Dynamic pressure ${(f.d.q / 1000).toFixed(1)} kPa`);
      if (an.smFull < 0) {
        R.factors.push('The centre of pressure sits ahead of the centre of gravity, so any small disturbance grows.');
        if (f.burnoutT != null && f.failure.t - f.burnoutT < 8) R.factors.push('The gimbal held it straight while the engine ran. At burnout the steering disappeared and the airflow turned it sideways.');
        R.fixes.push('Add fins to move the centre of pressure aft.');
      }
      else R.factors.push('Large steering inputs at high dynamic pressure bent the vehicle.');
      if (!f.sas && v.eng.gimbal > 0) R.fixes.push('Keep attitude hold (SAS) on so the gimbal can correct errors.');
      R.fixes.push('Avoid pitching while dynamic pressure is high.');
    } else if (k === 'tumble') {
      R.cause = 'Loss of control. The vehicle tumbled end over end.';
      R.evidence.push(`Stability margin at lift-off ${an.smFull.toFixed(1)} calibres`);
      if (an.smFull < 0) { R.factors.push('The centre of pressure sits ahead of the centre of gravity, so the airflow flips the vehicle around.'); R.fixes.push('Add fins to move the centre of pressure aft.'); }
      if (!f.sas && v.eng.gimbal > 0) R.fixes.push('Keep attitude hold (SAS) on so the gimbal can correct errors.');
      if (!R.fixes.length) R.fixes.push('Use larger fins, and avoid sharp pitch inputs.');
    } else if (k === 'gforce') {
      R.cause = 'The payload was crushed by acceleration.';
      R.evidence.push(`Acceleration reached ${f.max.g.toFixed(1)} g`, `Payload limit ${v.gMax} g`);
      R.factors.push('As propellant burns off, the same thrust pushes a lighter vehicle, so acceleration climbs near burnout.');
      R.fixes.push(v.eng.type === 'liquid' ? 'Throttle down late in the burn.' : 'Use a liquid engine you can throttle.', 'Use a less powerful engine.');
    }
    return R;
  }
  if (f.userEnded && f.apogeeT === null) {
    R.cause = f.liftoffT === null ? 'Flight ended on the pad.' : 'Flight ended before apogee.';
    if (f.liftoffT !== null) R.evidence.push(`Altitude at the end ${km(f.d.alt)}`, `Predicted apogee ${km(f.d.apo)}`);
    R.fixes.push('Fly again and let the flight run to apogee. Time warp speeds up the coast.');
    return R;
  }
  // fell short
  R.cause = 'Insufficient ΔV to reach 100 km.';
  R.evidence.push(`Apogee ${km(apo)}, target 100 km`, `ΔV available ${an.dvVac.toFixed(0)} m/s`,
    `Lost to gravity ${f.loss.grav.toFixed(0)} m/s`, `Lost to drag ${f.loss.drag.toFixed(0)} m/s`);
  const shortBy = 100000 - apo;
  if (f.loss.grav > 0.45 * f.loss.delivered) R.factors.push(`Low thrust-to-weight (${an.twr.toFixed(2)}) meant a long, slow climb. Gravity took ${(100 * f.loss.grav / Math.max(1, f.loss.delivered)).toFixed(0)}% of the burn.`);
  if (f.loss.drag > 350) R.factors.push('Drag was high. A pointed nose and fewer fins help.');
  const pitchLoss = f.tele.some(s => s.down > 5000);
  if (pitchLoss) R.factors.push(`The vehicle drifted ${km(Math.abs(f.d.downrange))} downrange. Horizontal speed does not help altitude.`);
  R.fixes.push(shortBy < 25000 ? 'You were close. A bigger tank or a lighter payload should get you there.' : 'Add propellant, or use a more efficient engine.');
  R.fixes.push('Fly straight up. For a sounding mission every degree of tilt costs altitude.');
  return R;
}

if (typeof module !== 'undefined') module.exports = { PARTS, analyze, Flight, flightReport, atmosphere, MODEL };
