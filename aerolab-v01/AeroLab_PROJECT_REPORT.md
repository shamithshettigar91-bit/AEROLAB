# AeroLab: project report

Status as of 27 September 2026. Version V0.1 (first playable build) plus a Streamlit dashboard.

Attach this file at the start of any future session so work can continue from exactly this point. Section 14 has a ready-made message to paste.

---

## 1. What AeroLab is

AeroLab is a rocket and spacecraft engineering game built on one principle from the original build plan: **the simulation is the source of truth**. The vehicle drawing, the numbers, the flight view, the report, the charts and the future AI and research features all read from one simulation state. Nothing calculates physics on its own.

The long-term plan (from the original 100-section build plan) targets Unity and C#, with three kinds of user: player, AI mission team, and researcher. Development is staged: physics, rocket, flight, builder, orbit, missions, spacecraft, worlds, cognitive AI, research.

What exists today is the V0.1 slice from that plan. It is a browser prototype, built to prove the physics and the game loop before any Unity work:

> Build a vehicle, launch it, fly it, fail or succeed, read why, improve it, fly again.

**Mission 002:** carry a 10 kg science payload above 100 km (the Kármán line) with one stage and one engine.

---

## 2. Timeline of work so far

| Step | What was done |
| --- | --- |
| 1. Plan review | Reviewed the 100-section build plan. Kept its staging, single source of truth, "never just say FAIL" and "LLM never does physics" principles. Raised seven structural fixes (section 3). |
| 2. Simulation core | Wrote `core.js`: parts as data, US76 atmosphere, vehicle analysis, 2D flight on a rotating Earth, RK4 at 100 Hz, attitude autopilot, failure detection, flight reports. Balanced it with about 15 headless test flights before any interface existed. |
| 3. Playable game | Built the builder screen, flight screen and report screen as one self-contained HTML page. Published it as a claude.ai artifact. |
| 4. Project zip | Split the game into sources, a build script, 20 automated tests, a README and a physics document. |
| 5. Streamlit dashboard | Added a Streamlit app (Play, Flight Lab, Parameter Sweep) that drives the same JavaScript core from Python through Node, plus VS Code run, debug and task configurations. |
| 6. This report | Written as the hand-off for future sessions. |

Published game (claude.ai artifact): https://claude.ai/artifact/PccpSrP7zJHSB2DwXRLKbT

---

## 3. Design decisions and why

These came from reviewing the original plan. Keep them unless there is a strong reason to change.

1. **Simulation core has no rendering dependency.** `core.js` never touches the page, canvas or browser. This lets the same code run in the game, in Node tests and in the Streamlit dashboard, and later run thousands of research flights headlessly. In Unity this becomes a separate assembly (`.asmdef`) with no engine references.
2. **Parts are data.** Every part is an entry in `PARTS`. Adding a part means adding data, not code, just like Unity ScriptableObjects.
3. **Engine data is not overdetermined.** Engines store only vacuum thrust and two Isp values. Mass flow is derived: ṁ = T_vac / (Isp_vac · g₀). Burn time comes from the attached propellant. Storing thrust, Isp, burn time and fuel flow separately would let them contradict each other.
4. **Earth rotates.** The flight is integrated in an inertial frame, and the pad starts with about 465 m/s of eastward velocity. The atmosphere rotates with Earth, so drag uses air-relative velocity.
5. **RK4 at a fixed 100 Hz.** Explicit Euler makes orbits drift. Time warp runs more steps per frame, never bigger steps, so results do not depend on the frame rate or warp setting.
6. **Deterministic.** There is no randomness in the physics. The same design and flight plan always give the same result, which is a requirement for the planned research mode ("run again reproduces the experiment").
7. **Versioned data.** Saved designs get version labels (`Sounder_v001`, `_v002`), and saving never overwrites. The physics model versions are shown in the builder and returned by the dashboard.
8. **One language for physics.** The Streamlit dashboard does not re-implement physics in Python. It calls the JavaScript core through Node, so the two can never disagree.

Floating origin (point 6 of the original review) is not needed in the browser prototype but is required once rendering moves to Unity's float-based transforms.

---

## 4. Project structure

```
aerolab-v01/
├── index.html              Built game, one self-contained file (generated, do not edit)
├── src/
│   ├── core.js             Simulation core, 418 lines
│   ├── ui.js               Game interface, 494 lines
│   └── template.html       Page structure and CSS, 288 lines
├── dashboard/
│   ├── Home.py             Streamlit entry point, Play page
│   ├── sim_bridge.py       Python ↔ Node bridge, caching, chart helper
│   └── pages/
│       ├── 1_Flight_Lab.py
│       └── 2_Parameter_Sweep.py
├── tools/
│   ├── build.py            Inlines core.js and ui.js into template.html → index.html
│   └── run_flight.js       JSON-in, JSON-out runner used by the dashboard
├── tests/flight-tests.js   20 headless tests
├── docs/
│   ├── PHYSICS_MODEL.md    Equations, assumptions, limits
│   └── PROJECT_REPORT.md   This file
├── .vscode/                launch.json, tasks.json, extensions.json
├── .streamlit/config.toml  Dashboard theme
├── requirements.txt        streamlit>=1.37, pandas>=2.0
├── package.json            npm run build / npm test shortcuts
├── README.md
└── .gitignore
```

**Rule:** edit only files in `src/`, then rebuild. `index.html` is overwritten by `tools/build.py`. The Streamlit Play page rebuilds automatically when `src/` is newer than `index.html`.

---

## 5. Simulation core (`src/core.js`)

### 5.1 Constants (SI units everywhere)

| Name | Value | Meaning |
| --- | --- | --- |
| `G0` | 9.80665 m/s² | Standard gravity, used for Isp |
| `MU` | 3.986004418 × 10¹⁴ m³/s² | Earth gravitational parameter |
| `RE` | 6,371,000 m | Earth radius |
| `WE` | −7.2921159 × 10⁻⁵ rad/s | Earth rotation (negative so east is +x in this frame) |
| `P0` | 101,325 Pa | Sea-level pressure |
| `RAIR` | 287.053 J/(kg·K) | Gas constant for air |
| `DIAM` | 0.6 m | Single vehicle diameter in V0.1 |
| `AREF` | π × 0.3² ≈ 0.283 m² | Aerodynamic reference area |
| `LIMITS.qAlpha` | 4,500 Pa | Bending limit, q × sin α |
| `MODEL` | AeroModel 0.1, US76-lite 1.0, PointMass 1.0, RK4 at 100 Hz | Model version labels |

### 5.2 Functions and classes

| Name | Purpose | Unity equivalent in the plan |
| --- | --- | --- |
| `PARTS` | Part definitions (section 6) | Part ScriptableObjects |
| `atmosphere(h)` | T, p, ρ, speed of sound from altitude | `AtmosphereModel.cs` |
| `buildVehicle(design)` | Places parts along the body axis, finds engine, tanks, propellant capacity, dry mass, CP, Cd₀, limits | `VehicleManager.cs` |
| `massProps(veh, prop)` | Mass, CG, moment of inertia and pitch damping for the current propellant | part of `VehicleManager.cs` |
| `analyze(design)` | Builder numbers (wet and dry mass, TWR, ΔV, burn time, CG, CP, stability margin) and validation issues | `VehicleAnalyzer.cs` |
| `orbitApo(x,y,vx,vy)` | Apoapsis altitude from orbital energy and angular momentum | `OrbitCalculator.cs` |
| `machFactor(M)` | Drag rise through the transonic region | part of `AerodynamicsModel.cs` |
| `class Flight` | Full flight simulation (5.3) | `SimulationEngine.cs` and related |
| `flightReport(f, an)` | Result, cause, evidence, contributing factors, suggested fixes | failure analysis |

A design is a plain object: `{ stack: [partIds top to bottom], fins: finId | null }`. Positions along the body are measured in metres from the nose tip, increasing aft.

### 5.3 The `Flight` class

- **State:** `x, y, vx, vy` (inertial, Earth-centred), `th` (body angle), `om` (angular rate), `prop` (propellant mass), `t`.
- **Pad:** while `clamped`, the vehicle rotates with Earth. It releases when thrust along local up exceeds weight. If it is still clamped 4 s after ignition, that is the "insufficient thrust" failure.
- **Engine state machine:** `off → ignition` (0.6 s thrust ramp) `→ running → shutdown` or `burnout`. Liquid engines throttle between 40% and 100% with a rate limit and can be cut once (no relight). Solid motors run at 100% to burnout.
- **Forces (`deriv`):** point-mass gravity; thrust with pressure-dependent Isp and gimbal angle plus a fixed 0.15° misalignment; drag along the relative wind; normal force at CP; pitch damping. Torques are computed about the current CG.
- **Integration (`step`):** RK4 over the 7-element state at dt = 0.01 s, with mass properties fixed within a step.
- **Attitude hold, "SAS" (`control`):** a PID loop on pitch above the local horizon (gains 12, 4, 7 per unit inertia) with a feed-forward that cancels the aerodynamic torque. It computes the required gimbal angle, clamped to the engine's limit and rate-limited to 20°/s. With SAS off, the pitch keys drive the gimbal directly. There is no steering without thrust, since V0.1 has no RCS.
- **Events:** ignition, lift-off, supersonic, Max Q (logged when q falls 3% below its peak), burnout or cut-off, 100 km crossed, apogee, impact.
- **Failure checks (only before apogee):** structural overload, aerodynamic break-up, loss of control (tumble), payload g-overload, insufficient thrust. Criteria are in `docs/PHYSICS_MODEL.md`.
- **Loss accounting:** gravity loss while burning, drag loss until apogee, and delivered ΔV. These feed the "fell short" report.
- **Telemetry:** recorded at 10 Hz: time, altitude, speed, sensed g, q, mass, Mach, thrust, fuel fraction, downrange.
- **Derived values (`derived`):** altitude, air-relative speed, vertical speed, q, Mach, downrange, pitch, velocity pitch, predicted apogee, current TWR.

### 5.4 Validation rules in `analyze`

Errors (block launch): no parts, no engine, more than one engine, engine not at the bottom, more than one nose, nose not at top, no payload, liquid engine without a tank, liquid engine without a flight computer.

Warnings: no nose cone (flat top, Cd 0.8); liquid tanks with a solid motor (dead weight); TWR below 1; negative stability margin (unstable), with a different message for gimballed and solid engines; margin between 0 and 1 calibre with fins (thin).

### 5.5 Flight report logic (`flightReport`)

- **Success:** peak altitude, margin, ΔV, next-step suggestion.
- **`twr`:** thrust-to-weight evidence, stronger engine or less mass.
- **`overload`:** q against the limit; throttle down between about 5 and 15 km, or use a smaller engine.
- **`breakup`:** stability margin and q. If unstable, suggest fins. If the break-up came within 8 s of burnout, explain that the gimbal lost authority at burnout.
- **`tumble`:** unstable airframe or attitude hold switched off.
- **`gforce`:** acceleration rises as propellant burns off; throttle late in the burn.
- **Fell short:** ΔV budget with gravity and drag losses, low TWR, high drag, downrange drift.
- **Ended early by the player:** say so, show predicted apogee.

---

## 6. Parts library

| id | Name | Category | Mass | Other data |
| --- | --- | --- | --- | --- |
| `nose_ogive` | Ogive nose cone | nose | 18 kg | 1.2 m, Cd 0.15, CP at 0.466 L, q limit 150 kPa |
| `nose_cone` | Conical nose cone | nose | 12 kg | 0.8 m, Cd 0.24, CP at 0.667 L |
| `payload_sci` | Science payload | payload | 25 kg | 0.6 m, 10 kg instrument, 15 g limit, q limit 120 kPa |
| `payload_heavy` | Heavy payload | payload | 85 kg | 0.9 m, 60 kg instrument, 12 g limit |
| `avionics` | Flight computer | avionics | 12 kg | 0.3 m, required for liquid engines |
| `tank_s` | Propellant tank S | tank | 40 kg | 160 kg propellant, 1.0 m, q limit 120 kPa |
| `tank_m` | Propellant tank M | tank | 70 kg | 330 kg propellant, 2.0 m |
| `tank_l` | Propellant tank L | tank | 100 kg | 500 kg propellant, 3.0 m |
| `eng_sparrow` | LR-12 Sparrow | liquid engine | 55 kg | 16 kN vac, Isp 250 / 285 s, 5° gimbal, 0.9 m |
| `eng_heron` | LR-40 Heron | liquid engine | 110 kg | 42 kN vac, Isp 262 / 298 s, 4° gimbal, 1.3 m |
| `srm_needle` | SR-9 Needle | solid motor | 140 kg | plus 600 kg propellant, 24 kN vac, Isp 228 / 252 s, 4.0 m, no gimbal |
| `fins_s` | Small fin set | fins | 10 kg | CNα 6, Cd +0.03, span 0.36 m |
| `fins_l` | Large fin set | fins | 20 kg | CNα 11, Cd +0.06, span 0.55 m |

Fins are a radial attachment at 0.45 m forward of the tail, not a stack item. The stack is limited to 8 parts.

---

## 7. Game balance: tested outcomes

These results define the intended learning path. The tests in `tests/flight-tests.js` lock most of them in, so a physics change that breaks the lessons will be caught.

| Design (nose + payload + computer + …) | Result | Lesson |
| --- | --- | --- |
| Tank M + Sparrow, no fins (the starter design) | Break-up at about 35 km, right after burnout | Unstable vehicles need fins; the gimbal only helps while the engine runs |
| Tank M + Sparrow, small fins | Success, apogee 134.5 km, max Q 63 kPa, 7.9 g | The fix |
| Tank M + Sparrow, large fins | Success, 111.5 km | More fins cost mass and drag |
| Conical nose, tank M + Sparrow, small fins | Success, 103.3 km | Nose shape matters |
| Tank S + Sparrow, small fins | Falls short, 20 km, drag loss about 1,100 m/s | Light vehicles lose badly to drag |
| Tank M + Sparrow, no fins, attitude hold off | Tumbles within 3 s | Instability without control |
| Heavy payload, tank M + Sparrow | Falls short, 85 km | Payload mass costs ΔV |
| Heavy payload, tank L + Sparrow | Success, 168 km | Add propellant |
| Tank L + Heron, full throttle | Structural overload at 4 km | Too much thrust in thick air |
| Tank L + Heron, 45% throttle from 3 to 20 km | Success, 214 km, peak 15 g | Throttle through max Q |
| Tank M + Heron | Overload | |
| Needle solid, no fins | Tumbles | |
| Needle solid, small fins | Falls short, 67.5 km, drifts 337 km west | Weathercocking and gravity turn |
| Needle solid, large fins | Success, 120.8 km | |
| Heavy payload, tanks L + M + Heron | Success, 304 km | |

ΔV guide shown in the builder: about 2,500 m/s for a vertical flight to 100 km (`DV_NEEDED` in `ui.js`).

---

## 8. Game interface (`src/ui.js`, `src/template.html`)

### 8.1 Builder screen

- Left: parts palette grouped by category. Clicking a part adds it where it belongs (nose on top, engine at the bottom, others in category order).
- Centre: canvas drawing of the vehicle on a drawing-sheet grid, with CG (full and empty) and CP markers and a length dimension. Clicking a part selects it, and an inspector below shows its note.
- Right: mission brief, the stack list (move up or down, remove), fins row, engineering table with colour-coded status, a ΔV bar with the 2,500 m/s mark, the checks list, and model versions.
- Bottom bar: design name, "Save version", "Load design", launch button (disabled with a count of errors).
- Local storage keys: `aerolab.v01.current` (autosave), `aerolab.v01.designs` (versioned list), `aerolab.v01.missionDone`.

### 8.2 Flight screen

- Canvas view: sky that darkens with altitude, stars above 25 km, Earth's limb and atmosphere glow above 6 km, launch pad and tower near the ground, airflow streaks whose density follows air density and whose direction shows the relative wind, the vehicle rotated to its real pitch, an exhaust plume that widens as pressure drops, a velocity marker, camera shake scaled with q (off if the system prefers reduced motion), and an explosion on failure.
- HUD: mission time, large altitude, readouts (velocity, vertical speed, acceleration, Mach, q with a bar against the limit, angle of attack, pitch and held pitch, thrust, TWR, mass, propellant with a bar, predicted apogee, downrange), objective chip, trajectory inset, event log.
- Controls: Ignite (Space), Cut engine (X), throttle slider 40–100% (W and S), pitch buttons (A and D, or arrows), attitude hold (T), time warp 1×, 2×, 5×, 10×, 25× (comma and full stop), End flight (Esc).
- The loop runs up to 4,000 fixed steps per frame, updates the HUD every third frame, and drops warp to 1× when the flight ends.
- After apogee a banner offers the report. The report opens automatically after impact or failure.

### 8.3 Report screen

Verdict, cause, evidence, contributing factors, next steps, four headline stats, and a telemetry chart with channel chips, target and limit lines, and a hover readout. Buttons: Fly again, Back to builder.

### 8.4 Visual design tokens

Dark: background `#16233A`, panel `#1D2E4A`, line `#34507A`, text `#E7EDF4`, accent amber `#F2A541`, good `#6CC4A1`, caution `#E9C46A`, bad `#EE6A55`, data cyan `#8FD3F4`. A light palette is also defined. The theme follows the system unless `data-theme` is set on `<html>`. Fonts: Barlow and Barlow Condensed from Google Fonts, with system fallbacks. The layout switches to a single column below 900 px.

---

## 9. Streamlit dashboard

Run from the project root: `streamlit run dashboard/Home.py`, or press F5 in VS Code and choose "AeroLab: Streamlit dashboard".

| Page | What it does |
| --- | --- |
| Home (Play) | Embeds the built game with `components.html`. Sidebar: game height, colour theme (injects `data-theme`), rebuild button, controls help, Node check. |
| Flight Lab | Dropdown design editor (nose, payload, computer, up to three tanks, engine, fins), flight plan (attitude hold, optional throttle band, stop at apogee), live engineering metrics and issues, headless flight, report, event log, Altair charts per channel with target and limit lines, telemetry CSV download. Stores the design in `st.session_state["lab_design"]` for the sweep page. |
| Parameter Sweep | Uses the Flight Lab design as a base. Three sweep types: throttle level through a max Q band, tank combinations, and every engine × fin option. Shows a success count, a chart (line for throttle, bars coloured by outcome with a dashed 100 km line), a results table and CSV download. |

### 9.1 Bridge protocol (`tools/run_flight.js`)

One JSON request on stdin, one JSON response on stdout.

```
{"cmd":"parts"}                     → {"parts": PARTS, "model": MODEL}
{"cmd":"analyze","design":{...}}    → analysis summary with issues
{"cmd":"fly","runs":[{
   "design": {...},
   "sas": true,
   "throttlePlan": [{"from": 3000, "to": 20000, "throttle": 0.45}],
   "telemetry": true,
   "stopAtApogee": true,
   "maxTime": 900
}]}                                 → {"results": [...], "model": MODEL}
```

Each result holds `analysis`, `report`, `success`, `apogee`, `max`, `loss`, `failure`, `events`, `liftoffT` and, if requested, `telemetry`.

### 9.2 `sim_bridge.py`

`parts()`, `model()`, `analyze(design)` and `fly(runs)` call Node and are cached with `st.cache_data`. The cache key includes the modification time of `src/` and the runner, so edits invalidate it. Also: `build_game()`, `game_html()` (rebuilds when stale), `make_design(...)`, `telemetry_frame(result)` and `channel_chart(...)`. If Node is missing, the page shows install instructions and stops.

### 9.3 VS Code files

- `launch.json`: "AeroLab: Streamlit dashboard" (debugpy, module streamlit, run on save) and "AeroLab: flight tests (Node)".
- `tasks.json`: install Python packages, run dashboard, build game (default build task), test (default test task).
- `extensions.json`: recommends the Python and Python Debugger extensions.

---

## 10. Tests

`node tests/flight-tests.js` (or `npm test`). 20 tests, all passing:

- Atmosphere: sea-level density, 11 km pressure and temperature, sea-level speed of sound, against US76 values.
- Analysis: validity, mass sum (520 kg), rocket equation, stable with fins, unstable without, and three validation errors.
- Flights: the eight scenarios marked in section 7.

Run the tests after every change to `core.js`. If a test fails after a deliberate physics change, update the test and record the change in section 13.

---

## 11. Known limitations and small issues

Physics simplifications (deliberate for V0.1):
- 2D planar flight, equatorial launch site, no yaw or roll.
- One diameter (0.6 m), one stage, rigid body, proportional tank draining.
- No wind, no aerodynamic heating, no recovery system.
- Predicted apogee assumes vacuum, so it overestimates in the lower atmosphere.
- Heavily finned solid rockets drift far downrange (weathercocking plus gravity turn). This is physically plausible but large.
- Light vehicles show very high drag losses (about 1,100 m/s for tank S).

Interface issues worth fixing:
- Ignition and lift-off both show T+0.0 in the in-game event log, because events are labelled only once lift-off time is known. The Flight Lab event log shows the correct −0.2 s.
- `keys` in `ui.js` is declared but unused.
- In Streamlit, the player must click inside the game before it receives key presses.
- Saved designs live in browser local storage, so designs saved in the standalone `index.html` and in the Streamlit Play page are separate.
- Fonts need an internet connection; without it the system fallback is used.
- The published artifact and the zip may drift apart if one is updated without the other.

---

## 12. Roadmap: what comes next

From the original plan's order, the next stages are:

1. **V0.2, staging.** Multiple engines and stages, stage separation (shutdown, detach, separation impulse, remove mass, ignite next), per-stage ΔV and TWR, interstage parts, a staging key.
2. **Orbit (plan phase 6).** Periapsis, eccentricity, orbital period; a map view; switching to analytic Kepler propagation during unpowered coasts for high time warp; Mission 003, 200 km orbit.
3. **Missions (plan phase 7).** Mission list, objectives, constraints and rewards as data; missions 001 to 006.
4. **Recovery.** Parachutes, landing legs, a descent and landing check.
5. **Research features.** Monte Carlo with uncertainty models, experiment objects storing seed, versions and parameters, reproducible reruns. The dashboard's sweep page is the foundation.
6. **Unity port.** Move `core.js` to C# in a no-engine assembly, parts to ScriptableObjects, the builder and flight view to Unity scenes, and add a floating origin. The flight tests become Unity EditMode tests with the same expected results.
7. **Later:** spacecraft systems (power, thermal, communication, electric propulsion), Moon and Mars, rovers, cognitive NPC mission team, AI assistants.

Smaller improvements that fit any time: reaction control thrusters for steering without thrust, wind, parts with different diameters, a telemetry CSV download inside the game, fixing the issues in section 11.

---

## 13. Change log

| Version | Date | Changes |
| --- | --- | --- |
| V0.1 | 27 Sep 2026 | First playable build: builder, flight, report. Simulation core AeroModel 0.1. 13 parts. Mission 002. |
| V0.1 + dashboard | 27 Sep 2026 | Streamlit dashboard (Play, Flight Lab, Parameter Sweep), Node bridge, VS Code configs, 900 px layout breakpoint, theme injection. |

Add a row here for every future update.

---

## 14. How to continue in a new session

Attach this file (and the project zip if you want code changes made directly), then paste:

> This is my AeroLab project. The attached PROJECT_REPORT.md describes everything built so far: the architecture, the simulation core, the parts, the tested balance, the game interface, the Streamlit dashboard and the roadmap. Keep the design decisions in section 3. Next I want to: **[describe the update, for example "add staging for V0.2"]**. Update the code, keep the tests passing (add tests for new behaviour), and update this report's change log.

Working rules to keep:
- Physics changes go only in `src/core.js`; the interface and dashboard read state and never compute physics.
- New parts are data entries in `PARTS`.
- SI units internally; conversion only for display.
- Rebuild with `python3 tools/build.py` and run `node tests/flight-tests.js` after every change.
- Bump the `MODEL` version string whenever the physics changes, so old results stay traceable.
