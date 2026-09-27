// Bridge between Python (Streamlit) and the AeroLab simulation core.
// Reads one JSON request on stdin, writes one JSON response on stdout.
// The physics lives only in src/core.js; this file just drives it.
//
//   {"cmd":"parts"}
//   {"cmd":"analyze","design":{...}}
//   {"cmd":"fly","runs":[{"design":{...},"sas":true,"throttlePlan":[{"from":3000,"to":20000,"throttle":0.45}],"telemetry":true}]}
const { PARTS, analyze, Flight, flightReport, MODEL } = require('../src/core.js');

function summarize(an) {
  return {
    valid: an.valid, wet: an.wet, dry: an.dry, prop: an.prop, twr: an.twr, dvVac: an.dvVac, dvSL: an.dvSL,
    burn: an.burn, L: an.L, cgFull: an.cgFull, cgEmpty: an.cgEmpty, cp: an.cp, smFull: an.smFull, smEmpty: an.smEmpty,
    thrustSL: an.thrustSL || 0, thrustVac: an.thrustVac || 0, qMax: an.veh.qMax, gMax: an.veh.gMax, issues: an.issues,
  };
}
function fly(run) {
  const an = analyze(run.design);
  if (!an.valid) return { analysis: summarize(an), error: 'Design is not valid. Fix the issues first.' };
  const f = new Flight(run.design);
  if (run.sas !== undefined && f.veh.hasComputer) f.sas = !!run.sas;
  const plan = run.throttlePlan || [];
  const maxT = run.maxTime || 900;
  f.ignite();
  while (!f.done && f.t < maxT) {
    if (plan.length) {
      const alt = f.d.alt; let thr = 1;
      for (const p of plan) if (alt >= p.from && alt < p.to) thr = p.throttle;
      f.setThrottle(thr);
    }
    f.step(0.01);
    if (run.stopAtApogee && f.apogeeT !== null) break;
  }
  if (!f.done) f.end();
  const r = flightReport(f, an);
  return {
    analysis: summarize(an), report: r, success: r.success,
    apogee: f.apogee ?? f.max.alt, max: f.max, loss: f.loss,
    failure: f.failure, events: f.events, liftoffT: f.liftoffT,
    telemetry: run.telemetry ? f.tele : undefined,
  };
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(input || '{}');
    let out;
    if (req.cmd === 'parts') out = { parts: PARTS, model: MODEL };
    else if (req.cmd === 'analyze') out = summarize(analyze(req.design));
    else if (req.cmd === 'fly') out = { results: req.runs.map(fly), model: MODEL };
    else throw new Error(`Unknown command: ${req.cmd}`);
    process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(String(e && e.stack || e));
    process.exit(1);
  }
});
