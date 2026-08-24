"""American-odds math.

Deliberately kept 1:1 with the JavaScript helpers in
``src/models/ufcSimulator.js`` so both models agree to the cent on implied
probabilities, fair prices, and vig removal.
"""
from __future__ import annotations

import math
from typing import Iterable, List


def _js_round(x: float) -> int:
    """Round half toward +Infinity, matching JS ``Math.round``.

    Python's built-in ``round`` uses banker's rounding, which would disagree
    with the JS helpers on exact ``.5`` boundaries. ``floor(x + 0.5)`` reproduces
    JS semantics (``Math.round(2.5) === 3``, ``Math.round(-2.5) === -2``).
    """
    return math.floor(x + 0.5)


def american_to_prob(odds: float) -> float:
    """Implied win probability of an American price (vig still included)."""
    return 100.0 / (odds + 100.0) if odds > 0 else -odds / (-odds + 100.0)


def is_valid_american(odds) -> bool:
    """True if ``odds`` is a legal American price.

    The American scale is discontinuous: no price exists strictly between -100
    and +100. Values in that gap mean something upstream produced garbage (e.g.
    averaging prices across the discontinuity), and they imply absurd
    probabilities -- ``american_to_prob(-2)`` is 0.98 -- so they must never
    reach the edge/EV math.
    """
    try:
        o = float(odds)
    except (TypeError, ValueError):
        return False
    if o != o:  # NaN
        return False
    return o <= -100.0 or o >= 100.0


def american_to_decimal(odds: float) -> float:
    """Convert American odds to decimal odds (total return per 1 unit staked)."""
    return 1.0 + (odds / 100.0 if odds > 0 else 100.0 / -odds)


def prob_to_american(prob: float) -> int:
    """Fair American price for a probability (no vig)."""
    p = min(max(prob, 0.001), 0.999)
    return _js_round((-100.0 * p) / (1.0 - p)) if p >= 0.5 else _js_round((100.0 * (1.0 - p)) / p)


def format_american(odds: float) -> str:
    """Render odds the way a book displays them: ``+150`` / ``-180``."""
    odds = int(round(odds))
    return f"+{odds}" if odds > 0 else f"{odds}"


def remove_vig(probs: Iterable[float]) -> List[float]:
    """Normalize a set of mutually-exclusive implied probabilities to sum to 1.

    The book's prices sum to > 1 (the overround / "vig"). Dividing through by
    the total gives the market's true implied probabilities, useful for judging
    whether a moneyline actually carries value or just carries juice.
    """
    probs = list(probs)
    total = sum(probs)
    if total <= 0:
        return probs
    return [p / total for p in probs]


def ev_per_dollar(prob: float, odds: float) -> float:
    """Expected profit per 1 unit staked at ``odds`` given a true ``prob``.

    EV > 0 is the whole game: it means the model thinks the bet pays more than
    it should. ``profit`` is the win payout (decimal - 1); a loss costs the
    stake (1 unit).
    """
    profit = american_to_decimal(odds) - 1.0
    return prob * profit - (1.0 - prob)
