"""Turn a single projected margin into both market probabilities.

The core idea of the whole model: NFL final margins are approximately normally
distributed around the projected margin, with a fairly stable standard
deviation (empirically ~13-13.5 points across seasons). Given a projected home
margin ``mu`` and that spread ``sigma``:

    P(home wins)          = P(margin > 0)        = Phi(mu / sigma)
    P(home covers -L)     = P(margin > L)        = Phi((mu - L) / sigma)

So one regression output feeds the moneyline AND the spread, and the two can
never contradict each other -- which is exactly the trap of training a separate
classifier for the moneyline and a separate regressor for the spread.
"""
from __future__ import annotations

import math

# League-wide standard deviation of (actual margin - projected margin), in
# points. ~13.5 is the textbook NFL figure; the trainer overrides this with the
# empirical residual std it measures on the training set.
DEFAULT_MARGIN_SD = 13.5


def norm_cdf(x: float) -> float:
    """Standard normal CDF via the error function (no scipy dependency)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def home_win_prob(pred_margin: float, sd: float = DEFAULT_MARGIN_SD) -> float:
    """P(home team wins outright) from the projected home margin."""
    return norm_cdf(pred_margin / sd)


def home_cover_prob(pred_margin: float, spread_line: float, sd: float = DEFAULT_MARGIN_SD) -> float:
    """P(home team covers the spread).

    ``spread_line`` follows the nflverse convention: **positive means the home
    team is favored by that many points**. The home side covers when the actual
    margin exceeds the line, i.e. ``margin - spread_line > 0``.
    """
    return norm_cdf((pred_margin - spread_line) / sd)


def fair_spread_line(pred_margin: float) -> float:
    """The break-even spread implied by the projection (nflverse convention).

    Equal to the projected margin: if the model expects the home team to win by
    ``mu``, the fair line has the home team favored by ``mu``. In sportsbook
    notation that is the home team at ``-mu``.
    """
    return round(pred_margin * 2) / 2  # snap to the nearest half-point
