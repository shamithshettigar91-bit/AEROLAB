# AeroLab physics model, V0.1

Model identifiers: AeroModel 0.1, US76-lite 1.0, PointMass 1.0, RK4 at 100 Hz.

## Frame and state

The flight is simulated in a two-dimensional inertial frame in Earth's equatorial plane, with the origin at Earth's centre. Earth rotates at 7.2921159 × 10⁻⁵ rad/s, and the launch pad sits on the equator. The vehicle therefore starts with about 465 m/s of eastward inertial velocity.

State vector: position x, y; velocity vx, vy; attitude angle θ; angular rate ω; propellant mass.

Integration uses fourth-order Runge–Kutta at a fixed 0.01 s step, independent of the frame rate. Time warp runs more steps per frame, never larger steps. Mass properties (CG, moment of inertia) are refreshed at the start of each step.

## Gravity

Point mass: g = μ / r², with μ = 3.986004418 × 10¹⁴ m³/s² and Earth radius 6,371 km.

## Atmosphere

US Standard Atmosphere 1976 layers up to 86 km, using a lapse-rate or isothermal barometric formula in each layer. Above 86 km the model is isothermal at 184.65 K. It outputs temperature, pressure, density ρ = p / (R T) and speed of sound a = √(1.4 R T).

The atmosphere rotates with Earth. All aerodynamic forces use air-relative velocity: v_air = v − ω × r.

## Propulsion

Mass flow is derived from the vacuum rating, never stored separately:

ṁ = T_vac / (Isp_vac · g₀)

Isp varies linearly with ambient pressure between its sea-level and vacuum values. Thrust = ṁ · throttle · g₀ · Isp(p).

Liquid engines throttle between 40% and 100% and gimbal a few degrees. Solid motors run at 100% until burnout and cannot shut down or steer. Every engine has a fixed 0.15° thrust misalignment, as any real vehicle does, so instabilities have something to grow from.

Engine states: off, ignition (0.6 s thrust ramp), running, shutdown, burnout.

## Aerodynamics

Dynamic pressure: q = ½ ρ v_air².

Drag: D = q · A · Cd, with reference area A = π (0.3 m)².
Cd = Cd₀ × Mach factor + base drag when unpowered (0.12) + 1.5 sin²α.
Cd₀ = nose-cone term + 0.012 × length + fin term. The Mach factor peaks at 1.9 near Mach 1.05 and falls to about 1.05 at high Mach.

Normal force: N = q · A · CNα · sin α, acting at the centre of pressure.

Centre of pressure uses Barrowman-style normal-force slopes: CNα = 2 for the nose (at 0.466 of its length for an ogive, 0.667 for a cone), plus the fin set's slope at the tail.

Static margin = (CP − CG) / diameter, in calibres. A positive margin means aerodynamically stable.

Pitch damping torque is proportional to q · A · L² · ω / v, with a coefficient derived from each surface's distance from the CG.

## Attitude hold

A PID controller commands the gimbal to hold a target pitch above the horizon. It includes a feed-forward term that cancels the predicted aerodynamic torque. The gimbal is rate-limited to 20°/s. With no thrust there is no steering, because V0.1 has no reaction control thrusters.

## Failure criteria (checked until apogee)

| Failure | Criterion |
| --- | --- |
| Structural overload | q above the weakest part's limit (120 kPa for tanks and payloads) |
| Aerodynamic break-up | q · sin α above 4,500 Pa while q above 2 kPa |
| Loss of control | α above about 44° while q above 500 Pa |
| Payload overload | Sensed acceleration above the payload's g limit |
| Insufficient thrust | Still on the pad 4 s after ignition |

## Losses reported in the flight report

- Gravity loss: ∫ g · (v̂ · r̂) dt while the engine runs.
- Drag loss: ∫ D / m dt until apogee.

## Predicted apogee

Computed from specific orbital energy and angular momentum: r_a = a (1 + e). This assumes vacuum, so it overestimates while the vehicle is still in the atmosphere.

## Known simplifications

The vehicle is rigid, with a single diameter and a single stage. Flight is planar, with no yaw or roll. There is no wind. Tanks drain proportionally. There is no heating model and no aerodynamic hysteresis. The numbers teach the right trends but are not engineering-grade predictions.

## Validation

`tests/flight-tests.js` checks the atmosphere against US76 reference values, mass and the rocket equation, validation rules, and eight flight scenarios whose outcomes should not change unless the model changes on purpose.
