"""The margin model: a regularized linear regression of home point margin.

Why Ridge and not a Random Forest? The NFL plays only ~272 games a season.
Tree ensembles with a dozen features overfit that little, noisy data and learn
schedule quirks as if they were signal. A standardized, L2-regularized linear
model is the honest workhorse here: it degrades gracefully, its coefficients
are interpretable, and out of sample it usually beats the fancier options on
data this sparse.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .distribution import DEFAULT_MARGIN_SD
from .features import FEATURE_COLUMNS

# Candidate L2 strengths searched when ``alpha`` is left to auto-tune.
ALPHA_GRID = [0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0]


@dataclass
class MarginModel:
    """Trained pipeline plus the residual spread needed for probabilities."""

    pipeline: Pipeline
    sigma: float
    alpha: float
    feature_columns: List[str]
    train_rmse: float
    cv_rmse: float
    coefficients: dict = field(default_factory=dict)

    def predict_margin(self, frame: pd.DataFrame) -> np.ndarray:
        """Projected home margin for each row of a matchup frame."""
        X = frame[self.feature_columns].to_numpy(dtype=float)
        return self.pipeline.predict(X)


def _pick_alpha(X: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Choose L2 strength by time-series cross-validation (no shuffling).

    Ordinary k-fold would leak the future into the past. ``TimeSeriesSplit``
    only ever validates on games that come after the training fold, which is
    how the model will actually be used.
    """
    n_splits = min(5, max(2, len(y) // 60))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    best_alpha, best_rmse = ALPHA_GRID[0], float("inf")
    for alpha in ALPHA_GRID:
        pipe = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=alpha))])
        scores = cross_val_score(pipe, X, y, cv=tscv, scoring="neg_root_mean_squared_error")
        rmse = -scores.mean()
        if rmse < best_rmse:
            best_alpha, best_rmse = alpha, rmse
    return best_alpha, best_rmse


def train_margin_model(
    train: pd.DataFrame,
    alpha: Optional[float] = None,
    feature_columns: List[str] = FEATURE_COLUMNS,
) -> MarginModel:
    """Fit the margin model on completed games.

    ``train`` must contain ``FEATURE_COLUMNS`` and a ``home_margin`` target with
    no NaNs. ``alpha=None`` auto-tunes via time-series CV; pass a float to pin it.
    """
    frame = train.dropna(subset=feature_columns + ["home_margin"])
    X = frame[feature_columns].to_numpy(dtype=float)
    y = frame["home_margin"].to_numpy(dtype=float)
    if len(y) < 30:
        raise ValueError(f"Only {len(y)} training games; need at least 30 for a stable fit.")

    if alpha is None:
        alpha, cv_rmse = _pick_alpha(X, y)
    else:
        _, cv_rmse = alpha, float("nan")

    pipeline = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=alpha))])
    pipeline.fit(X, y)

    residuals = y - pipeline.predict(X)
    train_rmse = float(np.sqrt(np.mean(residuals**2)))
    # The probability model needs the spread of outcomes around the projection.
    # Clamp to a sane NFL band so a small/odd training set can't produce a
    # degenerate sigma that makes every game look like a lock or a coin flip.
    sigma = float(np.clip(np.std(residuals, ddof=1), 10.0, 16.0))
    if not np.isfinite(sigma):
        sigma = DEFAULT_MARGIN_SD

    ridge: Ridge = pipeline.named_steps["ridge"]
    coefficients = dict(zip(feature_columns, (float(c) for c in ridge.coef_)))
    coefficients["__intercept__"] = float(ridge.intercept_)  # home-field advantage baseline

    return MarginModel(
        pipeline=pipeline,
        sigma=sigma,
        alpha=float(alpha),
        feature_columns=feature_columns,
        train_rmse=train_rmse,
        cv_rmse=float(cv_rmse),
        coefficients=coefficients,
    )
