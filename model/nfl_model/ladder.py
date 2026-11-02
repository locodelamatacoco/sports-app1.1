"""Price ladder: the worst price at each nearby line that still clears the gate.

A verdict at one quote says little about how sturdy it is. SEA -3.5 +105
clearing the gate is one fact; knowing SEA is still a bet at -3 down to -127
and at -4 only from +118 up says whether the pick survives the line moving, and
lets any number on any screen -- a sportsbook app, an odds site checked by hand
-- be judged at a glance without re-running anything.

Computed from the same margin distribution, push charge and edge requirement
the gate uses, so the ladder and the verdict can never disagree.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from . import edges
from . import odds as odds_math
from . import simulation as sim

# Prices searched, worst first for the bettor. Beyond +250 a spread price is not
# a real quote; a line that only works there is reported as no price.
_PRICES = list(range(-250, -100)) + list(range(100, 251))
LADDER_HALF_WIDTH = 2.0   # points either side of the market line
# Shown only between these prices: past them a spread quote is an alternate
# line few books post, and a rung that needs it is noise on the ladder.
SHOW_WORST, SHOW_BEST = -200, 130


def _payout(price: int) -> float:
    return 100.0 / -price if price < 0 else price / 100.0


_PRICES.sort(key=_payout)   # worst payout first


def worst_price(pred_margin: float, sigma: float, side: str,
                line: float) -> Optional[int]:
    """Lowest-paying American price at which this side at this line qualifies.

    ``line`` is nflverse convention (positive = home favoured), as everywhere
    in the gate. Qualifying is monotone in payout -- a better price raises EV
    and the edge requirement rises far more slowly than the edge does -- so the
    first qualifying price in payout order is the threshold.
    """
    home = sim.home_cover_prob(pred_margin, line, sigma)
    prob = home if side == "home" else 1.0 - home
    push = sim.push_prob(pred_margin, line, sigma)
    for price in _PRICES:
        if edges._wager("spread", side, "", prob, price, line=line,
                        push_prob=push).qualifies:
            return price
    return None


def game_ladder(home: str, away: str, pred_margin: float, sigma: float,
                market_line: float) -> Dict[str, List[dict]]:
    """Both sides, every half point within ``LADDER_HALF_WIDTH`` of the market.

    Each rung: the team's own line as a book shows it, the nflverse line, and
    the worst price that still qualifies (None when nothing up to +250 does).
    """
    out: Dict[str, List[dict]] = {}
    steps = int(LADDER_HALF_WIDTH * 2)
    lines = [market_line + 0.5 * k for k in range(-steps, steps + 1)]
    for side, team in (("home", home), ("away", away)):
        rungs = []
        for line in lines:
            team_line = -line if side == "home" else line
            rungs.append({"team": team, "teamLine": team_line, "line": line,
                          "worstPrice": worst_price(pred_margin, sigma, side, line)})
        out[side] = rungs
    return out


def format_rungs(rungs: List[dict]) -> str:
    live = [r for r in rungs if r["worstPrice"] is not None
            and _payout(SHOW_WORST) <= _payout(r["worstPrice"]) <= _payout(SHOW_BEST)]
    if not live:
        return "no bet at a realistic price within 2 pts"
    # "-3 ≥-127" reads: at -3, take -127 or anything paying more.
    return "  ".join(f"{r['teamLine']:+g} ≥{odds_math.format_american(r['worstPrice'])}"
                     for r in live)
