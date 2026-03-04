import streamlit as st

# ---------- Auth helpers ----------
def get_user_info():
    info = st.experimental_user or {}
    return info, info.get("is_logged_in", False)