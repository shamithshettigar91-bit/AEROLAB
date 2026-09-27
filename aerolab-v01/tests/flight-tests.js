// Headless tests for the AeroLab simulation core. No browser needed.
// Run from the project root:  node tests/flight-tests.js
const { analyze, Flight, flightReport, atmosphere } = require('../src/core.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  pass  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}
function fly(design, opts = {}) {
  const an = analyze(design), f = new Flight(design);
  if (opts.sas !== undefined) f.sas = opts.sas;
  f.ignite();
  while (!f.done && f.t < 900) {
    if (opts.throttle) f.setThrottle(opts.throttle(f));
    f.step(0.01);
  }
  return { an, f, r: flightReport(f, an) };
}
const D = (stack, fins = null) => ({ stack, fins });
const BASE = ['nose_ogive', 'payload_sci', 'avionics'];
const near = (a, b, tol) => Math.abs(a - b) / Math.abs(b) < tol;

console.log('\nAtmosphere, against US Standard 1976 reference values');
check('sea level density 1.225 kg/m³', near(atmosphere(0).rho, 1.225, 0.005));
check('11 km pressure 22.6 kPa', near(atmosphere(11000).p, 22632, 0.01));
check('11 km temperature 216.65 K', near(atmosphere(11000).T, 216.65, 0.001));
check('sea level speed of sound 340 m/s', near(atmosphere(0).a, 340.3, 0.005));

console.log('\nEngineering analysis');
const a = analyze(D([...BASE, 'tank_m', 'eng_sparrow'], 'fins_s'));
check('design with fins is valid', a.valid);
check('lift-off mass adds up to 520 kg', Math.round(a.wet) === 520, a.wet);
check('ΔV follows the rocket equation', near(a.dvVac, 285 * 9.80665 * Math.log(a.wet / a.dry), 1e-9));
check('fins give a positive stability margin', a.smFull > 0);
check('no fins means unstable', analyze(D([...BASE, 'tank_m', 'eng_sparrow'])).smFull < 0);
check('missing flight computer is an error', !analyze(D(['nose_ogive', 'payload_sci', 'tank_m', 'eng_sparrow'])).valid);
check('missing payload is an error', !analyze(D(['nose_ogive', 'avionics', 'tank_m', 'eng_sparrow'])).valid);
check('engine not at the bottom is an error', !analyze(D([...BASE, 'eng_sparrow', 'tank_m'])).valid);

console.log('\nFlights');
let t = fly(D([...BASE, 'tank_m', 'eng_sparrow']));
check('starter without fins breaks up after burnout', t.f.failure && t.f.failure.kind === 'breakup', t.f.failure && t.f.failure.kind);
t = fly(D([...BASE, 'tank_m', 'eng_sparrow'], 'fins_s'));
check('starter with small fins reaches 100 km', t.r.success, `${(t.f.max.alt / 1000).toFixed(1)} km`);
t = fly(D([...BASE, 'tank_m', 'eng_sparrow']), { sas: false });
check('unstable with attitude hold off tumbles', t.f.failure && t.f.failure.kind === 'tumble');
t = fly(D([...BASE, 'tank_l', 'eng_heron'], 'fins_s'));
check('Heron at full throttle overloads the structure', t.f.failure && t.f.failure.kind === 'overload');
t = fly(D([...BASE, 'tank_l', 'eng_heron'], 'fins_s'), { throttle: f => (f.d.alt > 3000 && f.d.alt < 20000) ? 0.45 : 1 });
check('Heron throttled through max Q succeeds', t.r.success);
t = fly(D(['nose_ogive', 'payload_heavy', 'avionics', 'tank_m', 'eng_sparrow'], 'fins_s'));
check('heavy payload on tank M falls short', !t.r.success && !t.f.failure);
t = fly(D(['nose_ogive', 'payload_sci', 'srm_needle'], 'fins_l'));
check('solid motor with large fins succeeds', t.r.success);
t = fly(D(['nose_ogive', 'payload_sci', 'srm_needle']));
check('solid motor without fins tumbles', t.f.failure && t.f.failure.kind === 'tumble');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
