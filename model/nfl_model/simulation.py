"""Discrete margin distribution, replacing the normal CDF for pricing.

The rest of the model turns a projected margin into probabilities through a
normal distribution (see ``distribution.py``). That describes the *body* well
enough -- out-of-sample residuals come back with skew +0.08 and kurtosis +0.21
-- but it is badly wrong in one way no continuous distribution can avoid.

Football scores are sums of 7s and 3s, so margins pile up on the numbers those
make. Over 3,134 games:

    margin   actual   normal says   ratio
       3     14.93%       5.53%     2.70x
       7      8.74%       5.00%     1.75x
       6      7.08%       5.16%     1.37x
      14      5.14%       3.46%     1.49x

Nearly a quarter of games land exactly on 3 or 7, and a continuous
distribution prices a push at a spread of 3 -- among the most common lines in
the sport -- as essentially impossible, when it happens about fifteen percent
of the time.

Two ways to fix it were tried. Simulating drives is the obvious one, and it is
not enough: a bounded number of possessions, each scoring or not, each score a
touchdown or a field goal, reproduces the dispersion and most of the mass at 7,
but tops out near 8% at a margin of 3 across every sensible parameter setting
(9-15 drives, 35-58% touchdown rate). The clustering at 3 comes from game
script -- a team down four kicks to cut it to one score, a team up seven kicks
to go up ten -- and independent scoring cannot produce that. The drive
simulator is kept below for scenario work, with that limit documented.

What is used for pricing instead is the empirical distribution directly: the
normal shape supplies the location from the model's projection, and a weight
per margin, measured from twelve seasons, supplies the lumpiness. That
reproduces the real key-number frequencies by construction rather than hoping a
generative story lands on them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

from . import distribution as dist

# Observed frequency of each absolute margin, 2015-2026 (3,134 games). Margins
# past the explicit entries are close enough to the smooth shape that a weight
# of 1.0 is right; the lumpiness lives at the bottom of the scale.
OBSERVED_MARGIN_FREQ: Dict[int, float] = {
    0: 0.0019, 1: 0.0440, 2: 0.0459, 3: 0.1493, 4: 0.0463, 5: 0.0345,
    6: 0.0708, 7: 0.0874, 8: 0.0376, 9: 0.0271, 10: 0.0472, 11: 0.0313,
    12: 0.0204, 13: 0.0260, 14: 0.0514, 15: 0.0189, 16: 0.0218, 17: 0.0313,
    18: 0.0156, 19: 0.0128, 20: 0.0217, 21: 0.0216,
}
# Beyond this the weights are 1.0 and the normal shape carries the tail.
LUMPY_THROUGH = 21
MAX_MARGIN = 80

# Scoring structure for the drive simulator, calibrated against 6,268
# team-games: mean 22.84 points, sd 9.94. Binomial rather than Poisson because
# possessions are capped by the clock, which makes real scoring UNDER-dispersed
# -- modelling touchdowns and field goals as independent counts instead gave a
# margin sd of 21.4 against a real 14.1.
POINTS_PER_TD = 7.0   # folds the extra point in at its ~94% rate
POINTS_PER_FG = 3.0
DRIVES = 13
TD_GIVEN_SCORE = 0.5

DEFAULT_SIMS = 40_000


@dataclass
class MarginDistribution:
    """Probability of each integer home margin for one game."""

    margins: np.ndarray
    probs: np.ndarray

    def home_win(self) -> float:
        ties = float(self.probs[self.margins == 0].sum())
        return float(self.probs[self.margins > 0].sum()) + 0.5 * ties

    def cover(self, spread_line: float) -> tuple:
        """(home cover, away cover, push) at a line, pushes excluded from cover.

        ``spread_line`` is nflverse convention: positive means the home team is
        favoured by that many. A half-point line cannot push, which the
        arithmetic handles without a special case.
        """
        cushion = self.margins - spread_line
        push = float(self.probs[cushion == 0].sum())
        decided = 1.0 - push
        if decided <= 0:
            return 0.5, 0.5, push
        home = float(self.probs[cushion > 0].sum()) / decided
        return home, 1.0 - home, push


def _margin_weights() -> np.ndarray:
    """Weight per absolute margin: how much more often it happens than a smooth
    distribution of the same spread would suggest."""
    sd = dist.DEFAULT_MARGIN_SD
    weights = np.ones(MAX_MARGIN + 1)
    for k in range(0, LUMPY_THROUGH + 1):
        observed = OBSERVED_MARGIN_FREQ.get(k)
        if observed is None:
            continue
        # What a smooth distribution of this spread puts within +/-0.5 of k,
        # counting both signs except at zero.
        lo, hi = (k - 0.5) / sd, (k + 0.5) / sd
        from math import erf, sqrt
        cdf = lambda z: 0.5 * (1 + erf(z / sqrt(2)))
        smooth = (cdf(hi) - cdf(lo)) * (1.0 if k == 0 else 2.0)
        if smooth > 1e-9:
            weights[k] = observed / smooth
    return weights


_WEIGHTS = _margin_weights()


def margin_distribution(pred_margin: float, sigma: Optional[float] = None
                        ) -> MarginDistribution:
    """Discrete distribution over integer home margins.

    The normal shape places the mass according to the model's projection; the
    empirical weights make it lumpy in the places real football is lumpy.
    """
    sigma = float(sigma) if sigma else dist.DEFAULT_MARGIN_SD
    margins = np.arange(-MAX_MARGIN, MAX_MARGIN + 1)
    z = (margins - pred_margin) / sigma
    density = np.exp(-0.5 * z * z)
    probs = density * _WEIGHTS[np.abs(margins)]
    total = probs.sum()
    return MarginDistribution(margins, probs / total if total > 0 else probs)


def home_cover_prob(pred_margin: float, spread_line: float,
                    sigma: Optional[float] = None) -> float:
    """Probability the home side covers, pushes excluded."""
    return margin_distribution(pred_margin, sigma).cover(spread_line)[0]


def push_prob(pred_margin: float, spread_line: float,
              sigma: Optional[float] = None) -> float:
    """Probability the game lands exactly on the number."""
    return margin_distribution(pred_margin, sigma).cover(spread_line)[2]


def home_win_prob(pred_margin: float, sigma: Optional[float] = None) -> float:
    return margin_distribution(pred_margin, sigma).home_win()


# --------------------------------------------------------------------------- #
# Drive simulator -- scenario work, not pricing
# --------------------------------------------------------------------------- #
def simulate_scores(pred_margin: float, total: Optional[float] = None,
                    sims: int = DEFAULT_SIMS, seed: Optional[int] = None
                    ) -> tuple:
    """Simulate (home_score, away_score) pairs from a projection and a total.

    Useful for questions the margin distribution alone cannot answer -- what a
    team total does, how often a game stays within a touchdown at the half --
    but NOT used for pricing. It reproduces the dispersion and the mass at 7,
    and underweights a margin of 3 by roughly half, because game script is what
    puts games there and independent scoring has no game script.
    """
    rng = np.random.default_rng(seed)
    total = float(total) if total is not None and np.isfinite(total) else 45.0
    points_per_score = (POINTS_PER_TD * TD_GIVEN_SCORE
                        + POINTS_PER_FG * (1.0 - TD_GIVEN_SCORE))

    def draw(expected_points: float) -> np.ndarray:
        rate = np.clip(expected_points / (DRIVES * points_per_score), 0.02, 0.95)
        scoring = rng.binomial(DRIVES, rate, size=sims)
        tds = rng.binomial(scoring, TD_GIVEN_SCORE)
        return tds * POINTS_PER_TD + (scoring - tds) * POINTS_PER_FG

    return draw((total + pred_margin) / 2.0), draw((total - pred_margin) / 2.0)


def key_number_profile(margins: np.ndarray) -> dict:
    """How much mass sits on each key number -- for validating against reality."""
    absolute = np.abs(margins)
    return {int(k): float(np.mean(absolute == k)) for k in (1, 2, 3, 4, 6, 7, 10, 14)}
