# AeroLab V0.1

Build a single-stage sounding rocket and carry a 10 kg science payload above 100 km, the Kármán line.

## Play

Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). No install or server is needed. Everything runs offline except the Barlow web font, which falls back to a system font if there is no connection.

Flight controls:

| Key | Action |
| --- | --- |
| Space | Ignite |
| W / S | Throttle up / down (liquid engines, 40–100%) |
| A / D or ← / → | Pitch west / east |
| T | Attitude hold on / off |
| X | Cut engine (no relight) |
| , / . | Time warp down / up (1× to 25×) |
| Esc | End flight and open the report |

The on-screen buttons do the same thing on touch devices.

## Run with Streamlit in VS Code

The Streamlit dashboard wraps the game and adds two analysis pages. It has three pages:

- **Play:** the game itself, embedded.
- **Flight Lab:** design a vehicle, fly it headlessly, read the report, chart any telemetry channel against its limit, and download the CSV.
- **Parameter Sweep:** fly many variations in one go (throttle level through max Q, tank combinations, or every engine with every fin set) and compare the results.

Setup, once:

1. Install Python 3.10+ and Node.js 18+. Check with `python --version` and `node --version` in a new VS Code terminal.
2. Install the VS Code Python extension (VS Code suggests it when you open the folder).
3. Open the `aerolab-v01` folder in VS Code (File → Open Folder).
4. Create a virtual environment: Ctrl+Shift+P → *Python: Create Environment* → Venv, and tick `requirements.txt`. Or in the terminal:

   ```
   python -m venv .venv
   .venv\Scripts\activate        (Windows)
   source .venv/bin/activate      (macOS / Linux)
   pip install -r requirements.txt
   ```

Run it, any of three ways:

- Press **F5** and choose *AeroLab: Streamlit dashboard*. This also lets you set breakpoints in the Python files.
- Ctrl+Shift+P → *Tasks: Run Task* → *AeroLab: run dashboard*.
- In the terminal: `streamlit run dashboard/Home.py`

The dashboard opens at http://localhost:8501. Always run it from the project root so the paths resolve.

How it connects: Python never re-implements the physics. Every analysis and flight in the dashboard is sent to Node through `tools/run_flight.js`, which drives the same `src/core.js` the game uses. The game and the dashboard therefore always give identical results. When you edit anything in `src/`, the Play page rebuilds `index.html` automatically and the analysis caches refresh.

## Project layout

```
aerolab-v01/
├── index.html            Built game, one self-contained file
├── src/
│   ├── core.js           Simulation core: parts, atmosphere, analysis, flight, report
│   ├── ui.js             Builder, flight view, HUD, charts (reads state only)
│   └── template.html     Page structure and styles
├── dashboard/
│   ├── Home.py           Streamlit entry point, Play page
│   ├── sim_bridge.py     Python ↔ Node bridge, caching, chart helpers
│   └── pages/            Flight Lab and Parameter Sweep
├── tools/
│   ├── build.py          Combines src/ into index.html
│   └── run_flight.js     JSON-in, JSON-out runner for the core
├── tests/flight-tests.js Headless tests of the core
├── .vscode/              Run/debug configurations and tasks
├── .streamlit/config.toml Dashboard theme
├── requirements.txt      Python packages
├── docs/PHYSICS_MODEL.md Equations, assumptions and limits
└── package.json          npm shortcuts for build and test
```

## Develop in VS Code

1. Open the `aerolab-v01` folder in VS Code.
2. Edit files in `src/`. Never edit `index.html` directly, because the build overwrites it.
3. Rebuild with `python3 tools/build.py` (or `npm run build`).
4. Refresh `index.html` in the browser.
5. Run `node tests/flight-tests.js` (or `npm test`) before every commit.

Requirements: Python 3 for the build, Node.js 18 or later for the tests.

## Architecture

The simulation core is the single source of truth. `core.js` has no knowledge of the page. It never touches the DOM or a canvas, so the same code runs in the browser and in Node tests, and it can later run thousands of headless flights for research mode. `ui.js` only reads simulation state and sends player commands. It never calculates physics itself, so the HUD, graphs and report cannot disagree.

Main pieces of `core.js`:

| Piece | Role | Unity equivalent from the build plan |
| --- | --- | --- |
| `PARTS` | Part definitions as data | `ScriptableObject` part assets |
| `atmosphere(h)` | Temperature, pressure, density, speed of sound | `AtmosphereModel.cs` |
| `buildVehicle`, `massProps` | Stack positions, mass, CG, inertia, CP | `VehicleManager.cs` |
| `analyze(design)` | Builder numbers and validation messages | `VehicleAnalyzer.cs` |
| `Flight` | State, forces, RK4 integration, engine state machine, attitude hold, events, failure detection, telemetry | `SimulationEngine.cs`, `EngineController.cs`, `FlightController.cs`, `FailureManager.cs`, `TelemetryRecorder.cs` |
| `orbitApo` | Predicted apogee from orbital energy | `OrbitCalculator.cs` |
| `flightReport` | Cause, evidence, factors and fixes | Failure analysis |

All internal units are SI: kg, m, s, N, Pa, K, rad. Conversion to km, kN and degrees happens only in the UI.

## Parts

| Part | Mass | Key figures |
| --- | --- | --- |
| Ogive nose cone | 18 kg | Cd 0.15, 1.2 m |
| Conical nose cone | 12 kg | Cd 0.24, 0.8 m |
| Science payload | 25 kg | 10 kg instrument, 15 g limit |
| Heavy payload | 85 kg | 60 kg instrument, 12 g limit |
| Flight computer | 12 kg | Required for liquid engines |
| Propellant tank S / M / L | 40 / 70 / 100 kg empty | 160 / 330 / 500 kg propellant |
| LR-12 Sparrow | 55 kg | 16 kN vacuum, Isp 250–285 s, 5° gimbal |
| LR-40 Heron | 110 kg | 42 kN vacuum, Isp 262–298 s, 4° gimbal |
| SR-9 Needle solid motor | 140 kg + 600 kg propellant | 24 kN vacuum, Isp 228–252 s, no steering or throttle |
| Small / large fin set | 10 / 20 kg | Normal-force slope 6 / 11 |

To add a part, add an entry to `PARTS` in `src/core.js`, rebuild, and it appears in the builder automatically.

## Saved data

Designs are saved in the browser's local storage as versions (`Sounder_v001`, `Sounder_v002` and so on). Saving never overwrites an earlier version.

## Model versions

Physics AeroModel 0.1, atmosphere US76-lite 1.0, gravity point mass 1.0, integrator RK4 at 100 Hz. These are shown in the builder so results can be traced to the model that produced them.

## Not in V0.1

Staging, orbit, recovery, multiple planets, AI crew and research mode. See the build plan for the order these arrive in.
