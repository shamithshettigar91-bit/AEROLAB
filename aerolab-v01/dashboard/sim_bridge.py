"""Python side of the AeroLab bridge.

The physics lives only in src/core.js. Python never re-implements it: every
analysis and flight here is run by Node through tools/run_flight.js, so the
Streamlit dashboard and the browser game always agree.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "tools" / "run_flight.js"
BUILD = ROOT / "tools" / "build.py"
GAME = ROOT / "index.html"
SRC = ROOT / "src"

RANK = {"nose": 0, "payload": 1, "avionics": 2, "tank": 3, "engine": 4}


class BridgeError(RuntimeError):
    pass


def node_path() -> str | None:
    return shutil.which("node")


def require_node() -> str:
    node = node_path()
    if not node:
        st.error(
            "Node.js was not found. Install it from nodejs.org (version 18 or later), "
            "restart VS Code so the terminal picks it up, then rerun the app."
        )
        st.stop()
    return node


def _call(payload: dict, timeout: int = 600) -> dict:
    node = require_node()
    proc = subprocess.run(
        [node, str(RUNNER)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise BridgeError(proc.stderr.strip() or "The simulation runner failed.")
    return json.loads(proc.stdout)


def src_fingerprint() -> float:
    """Changes whenever a source file changes, so caches refresh after edits."""
    return max(p.stat().st_mtime for p in [*SRC.iterdir(), RUNNER])


@st.cache_data(show_spinner=False)
def _parts(_fp: float) -> dict:
    return _call({"cmd": "parts"})


def parts() -> dict:
    return _parts(src_fingerprint())["parts"]


def model() -> dict:
    return _parts(src_fingerprint())["model"]


@st.cache_data(show_spinner=False)
def _analyze(design_json: str, _fp: float) -> dict:
    return _call({"cmd": "analyze", "design": json.loads(design_json)})


def analyze(design: dict) -> dict:
    return _analyze(json.dumps(design, sort_keys=True), src_fingerprint())


@st.cache_data(show_spinner=False)
def _fly(runs_json: str, _fp: float) -> list[dict]:
    return _call({"cmd": "fly", "runs": json.loads(runs_json)})["results"]


def fly(runs: list[dict]) -> list[dict]:
    return _fly(json.dumps(runs, sort_keys=True), src_fingerprint())


def build_game() -> str:
    proc = subprocess.run([sys.executable, str(BUILD)], capture_output=True, text=True, cwd=ROOT)
    if proc.returncode != 0:
        raise BridgeError(proc.stderr.strip())
    return proc.stdout.strip()


def game_html() -> str:
    newest_src = max(p.stat().st_mtime for p in SRC.iterdir())
    if not GAME.exists() or GAME.stat().st_mtime < newest_src:
        build_game()
    return GAME.read_text(encoding="utf-8")


def make_design(nose: str | None, payload: str | None, avionics: bool,
                tanks: list[str], engine: str | None, fins: str | None) -> dict:
    stack = [p for p in [nose, payload] if p]
    if avionics:
        stack.append("avionics")
    stack += tanks
    if engine:
        stack.append(engine)
    return {"stack": stack, "fins": fins}


def telemetry_frame(result: dict) -> pd.DataFrame:
    df = pd.DataFrame(result.get("telemetry") or [])
    if df.empty:
        return df
    t0 = result.get("liftoffT") or 0
    df["time_s"] = df["t"] - t0
    df["altitude_km"] = df["alt"] / 1000
    df["velocity_m_s"] = df["speed"]
    df["acceleration_g"] = df["g"]
    df["dynamic_pressure_kPa"] = df["q"] / 1000
    df["thrust_kN"] = df["thrust"] / 1000
    df["mass_kg"] = df["mass"]
    df["downrange_km"] = df["down"] / 1000
    df["propellant_pct"] = df["fuel"] * 100
    return df[["time_s", "altitude_km", "velocity_m_s", "acceleration_g", "dynamic_pressure_kPa",
               "mach", "thrust_kN", "mass_kg", "propellant_pct", "downrange_km"]]


def channel_chart(df: pd.DataFrame, col: str, title: str, limit: tuple | None = None, height: int = 220):
    """One telemetry channel against time, with an optional dashed limit line."""
    import altair as alt  # installed with Streamlit
    x = alt.X("time_s:Q", title="Seconds after lift-off", scale=alt.Scale(domain=[0, float(df["time_s"].max())], nice=False))
    line = alt.Chart(df).mark_line(color="#F2A541", strokeWidth=2).encode(
        x=x, y=alt.Y(f"{col}:Q", title=title), tooltip=[alt.Tooltip("time_s:Q", format=".1f"), alt.Tooltip(f"{col}:Q", format=".2f")])
    chart = line
    if limit:
        lim = pd.DataFrame({"y": [limit[0]], "label": [limit[1]]})
        rule = alt.Chart(lim).mark_rule(strokeDash=[6, 4], color="#6CC4A1" if limit[1] == "Target" else "#EE6A55").encode(y="y:Q")
        text = alt.Chart(lim).mark_text(align="left", dx=4, dy=-6, color="#9BB0C9").encode(y="y:Q", x=alt.value(0), text="label:N")
        chart = line + rule + text
    return chart.properties(height=height)
