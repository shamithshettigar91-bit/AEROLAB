"""AeroLab dashboard. Run from the project root:

    streamlit run dashboard/Home.py
"""
import streamlit as st
import streamlit.components.v1 as components

import sim_bridge as sb

st.set_page_config(page_title="AeroLab", page_icon="🚀", layout="wide", initial_sidebar_state="collapsed")

with st.sidebar:
    st.markdown("### AeroLab V0.1")
    st.caption("Mission 002: carry the science payload above 100 km.")
    height = st.slider("Game height (px)", 600, 1200, 860, step=20)
    theme = st.radio("Game colours", ["Dark", "Light", "Follow system"], horizontal=True)
    if st.button("Rebuild game from src/", use_container_width=True):
        try:
            st.success(sb.build_game())
        except sb.BridgeError as e:
            st.error(str(e))
    st.divider()
    st.caption(
        "Click inside the game once so it receives the keyboard. "
        "Space ignites, W and S throttle, A and D pitch, T toggles attitude hold, "
        "comma and full stop change time warp."
    )
    if not sb.node_path():
        st.warning("Node.js not found. The game works, but Flight Lab and Parameter Sweep need Node.")

st.title("Play")
st.caption("The same game as index.html, running inside Streamlit. Flight Lab and Parameter Sweep use the identical simulation core.")

html = sb.game_html()
if theme != "Follow system":
    html = html.replace('<html lang="en">', f'<html lang="en" data-theme="{theme.lower()}">', 1)
components.html(html, height=height, scrolling=False)
