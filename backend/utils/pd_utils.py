# utils/pd_utils.py
from __future__ import annotations
from typing import List
import pandas as pd

def select_cols(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
    """
    Return df with only the requested columns that actually exist, preserving order.
    Safe to call even if some columns are missing.
    """
    keep = [c for c in cols if c in df.columns]
    return df[keep]
