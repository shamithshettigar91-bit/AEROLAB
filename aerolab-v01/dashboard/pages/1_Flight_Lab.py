import pandas as pd
import streamlit as st

import sim_bridge as sb

st.set_page_config(page_title="AeroLab Flight Lab", page_icon="🧪", layout="wide")
st.title("Flight Lab")
st.caption("Design a vehicle, fly it headlessly with the game's own simulation core, and study the telemetry.")

P = sb.parts()
by_cat = lambda cat: [k for k, v in P.items() if v["cat"] == cat]
name = lambda k: P[k]["name"] if k else "None"

# ---------- Design ----------
col_d, col_a = st.columns([1, 1.25], gap="large")
with col_d:
    st.subheader("Design")
    nose = st.selectbox("Nose cone", [None, *by_cat("nose")], index=1, format_func=name)
    payload = st.selectbox("Payload", [None, *by_cat("payload")], index=1, format_func=name)
    avionics = st.checkbox("Flight computer", value=True, help="Liquid engines need one to steer.")
    tank_opts = [None, *by_cat("tank")]
    t1, t2, t3 = st.columns(3)
    tanks = [t1.selectbox("Tank 1", tank_opts, index=2, format_func=name),
             t2.selectbox("Tank 2", tank_opts, index=0, format_func=name),
             t3.selectbox("Tank 3", tank_opts, index=0, format_func=name)]
    engine = st.selectbox("Engine", by_cat("engine"), format_func=name)
    fins = st.selectbox("Fins", [None, *by_cat("fins")], index=1, format_func=name)

    st.subheader("Flight plan")
    liquid = P[engine].get("type") == "liquid"
    sas = st.checkbox("Attitude hold", value=True, disabled=not liquid)
    throttle_down = st.checkbox("Throttle down through the lower atmosphere", value=False, disabled=not liquid)
    plan = []
    if throttle_down and liquid:
        band = st.slider("Altitude band, km", 0.0, 40.0, (3.0, 20.0), step=0.5)
        level = st.slider("Throttle in band, %", 40, 100, 45, step=5)
        plan = [{"from": band[0] * 1000, "to": band[1] * 1000, "throttle": level / 100}]
    stop_apogee = st.checkbox("Stop at apogee", value=True, help="Skip the long fall back to Earth.")

design = sb.make_design(nose, payload, avionics, [t for t in tanks if t], engine, fins)
st.session_state["lab_design"] = design
st.session_state["lab_plan"] = plan
st.session_state["lab_sas"] = sas

# ---------- Analysis ----------
an = sb.analyze(design)
with col_a:
    st.subheader("Engineering")
    m = st.columns(3)
    m[0].metric("Lift-off mass", f"{an['wet']:,.0f} kg")
    m[1].metric("Thrust-to-weight", f"{an['twr']:.2f}")
    m[2].metric("ΔV, vacuum", f"{an['dvVac']:,.0f} m/s")
    m = st.columns(3)
    m[0].metric("Stability margin", f"{an['smFull']:.1f} cal")
    m[1].metric("Burn time", f"{an['burn']:.0f} s")
    m[2].metric("Structural limit", f"{an['qMax'] / 1000:.0f} kPa")
    st.caption(f"Stack, top to bottom: {' → '.join(P[p]['name'] for p in design['stack'])}"
               + (f", plus {P[fins]['name'].lower()}" if fins else ""))
    for i in an["issues"]:
        (st.error if i["level"] == "error" else st.warning)(f"{i['text']}  \n*{i['fix']}*")
    if not an["issues"]:
        st.success("No problems found.")

    run = st.button("Fly this design", type="primary", disabled=not an["valid"], use_container_width=True)

if run:
    with st.spinner("Flying…"):
        res = sb.fly([{"design": design, "sas": sas, "throttlePlan": plan, "telemetry": True, "stopAtApogee": stop_apogee}])[0]
    st.session_state["lab_result"] = res

res = st.session_state.get("lab_result")
if not res:
    st.info("Press **Fly this design** to run a flight.")
    st.stop()

# ---------- Results ----------
st.divider()
r = res["report"]
(st.success if r["success"] else st.error)(f"**{'Mission complete' if r['success'] else 'Mission failed'}.** {r['cause']}")
m = st.columns(5)
m[0].metric("Apogee", f"{res['apogee'] / 1000:,.1f} km", f"{(res['apogee'] - 100000) / 1000:+,.1f} km vs target")
m[1].metric("Max Q", f"{res['max']['q'] / 1000:.1f} kPa")
m[2].metric("Peak acceleration", f"{res['max']['g']:.1f} g")
m[3].metric("Gravity loss", f"{res['loss']['grav']:,.0f} m/s")
m[4].metric("Drag loss", f"{res['loss']['drag']:,.0f} m/s")

c1, c2 = st.columns([1, 1.6], gap="large")
with c1:
    st.markdown("**Evidence**\n" + "\n".join(f"- {x}" for x in r["evidence"]))
    if r["factors"]:
        st.markdown("**Contributing factors**\n" + "\n".join(f"- {x}" for x in r["factors"]))
    st.markdown(("**Next**\n" if r["success"] else "**What to try**\n") + "\n".join(f"- {x}" for x in r["fixes"]))
    ev = pd.DataFrame(res["events"])
    if not ev.empty:
        ev["T+ s"] = (ev["t"] - (res.get("liftoffT") or 0)).round(1)
        st.markdown("**Event log**")
        st.dataframe(ev[["T+ s", "msg"]].rename(columns={"msg": "Event"}), hide_index=True, use_container_width=True)
with c2:
    df = sb.telemetry_frame(res)
    labels = {"altitude_km": "Altitude, km", "velocity_m_s": "Velocity, m/s", "acceleration_g": "Acceleration, g",
              "dynamic_pressure_kPa": "Dynamic pressure, kPa", "mach": "Mach", "thrust_kN": "Thrust, kN",
              "mass_kg": "Mass, kg", "propellant_pct": "Propellant, %", "downrange_km": "Downrange, km"}
    chans = st.multiselect("Channels", list(labels), default=["altitude_km"], format_func=labels.get)
    limits = {"altitude_km": (100, "Target"), "dynamic_pressure_kPa": (an["qMax"] / 1000, "Structural limit"),
              "acceleration_g": (an["gMax"], "Payload limit") if an["gMax"] < 99 else None}
    for ch in chans:
        st.altair_chart(sb.channel_chart(df, ch, labels[ch], limits.get(ch)), use_container_width=True)
    st.download_button("Download telemetry CSV", df.to_csv(index=False).encode(), "aerolab_telemetry.csv", "text/csv")
