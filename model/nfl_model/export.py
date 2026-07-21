"""Assemble the frontend-facing JSON payload.

The shape mirrors what an NFL betting page would want to render -- one entry per
game with the projection, both markets, and the qualifying value bets -- so a
React ``NFLBettingPage`` can consume it the same way ``UFCBettingPage`` consumes
its analysis objects.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import List

import numpy as np
import pandas as pd

from . import edges as edge_mod
from .model import MarginModel


def _clean(obj):
    """Recursively convert numpy/pandas scalars and NaN into JSON-safe values."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if math.isnan(f) else round(f, 6)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if obj is None or isinstance(obj, (str, int, bool)):
        return obj
    if pd.isna(obj):
        return None
    return obj


def build_payload(model: MarginModel, slate: pd.DataFrame, source: str) -> dict:
    """Price every game in ``slate`` and wrap it with run metadata."""
    preds = model.predict_margin(slate)
    games = []
    for pred, (_, row) in zip(preds, slate.iterrows()):
        games.append(edge_mod.analyze_game(row.to_dict(), float(pred), model.sigma))

    total_value_bets = sum(len(g["valueBets"]) for g in games)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataSource": source,
        "disclaimer": (
            "Model output is for analysis/entertainment only, not betting advice. "
            "Edges are measured against the book's posted line; the true scorecard "
            "of skill is closing-line value, not any single week's results."
        ),
        "model": {
            "type": "ridge",
            "alpha": model.alpha,
            "sigma": model.sigma,
            "trainRmse": model.train_rmse,
            "cvRmse": model.cv_rmse,
            "features": model.feature_columns,
            "coefficients": model.coefficients,
            "betRules": edge_mod.BET_RULES,
        },
        "summary": {
            "games": len(games),
            "valueBets": total_value_bets,
        },
        "games": games,
    }
    return _clean(payload)


def write_json(payload: dict, path: str) -> None:
    with open(path, "w") as fh:
        json.dump(payload, fh, indent=2)
