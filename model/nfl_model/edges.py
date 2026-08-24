"""Compare model probabilities against the book to surface value.

For every game we build the two markets the model can price -- moneyline and
spread -- for both sides, then keep only the wagers that clear an edge / EV
gate. Thresholds mirror the UFC model's ``BET_RULES``: favorites need a smaller
edge than underdogs, because a fixed probability edge is worth less at short
odds.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import List, Optional

from . import distribution as dist
from . import odds as odds_math

# Minimum model-vs-market edge (in probability) required to flag a bet, plus the
# hard EV floor. A "favorite" here is any side priced at negative American odds.
BET_RULES = {
    "MIN_FAVORITE_EDGE": 0.03,
    "MIN_UNDERDOG_EDGE": 0.05,
    "MIN_EV": 0.0,  # Expected Value must be strictly positive to qualify.
    "COIN_FLIP_BAND": (0.47, 0.53),  # win-prob band we treat as a toss-up
}


@dataclass
class Wager:
    """One priced betting option (a single side of a single market)."""

    market: str  # "moneyline" | "spread"
    side: str  # "home" | "away"
    label: str  # human-readable, e.g. "KC -3.5" or "NO ML"
    model_prob: float
    book_odds: float
    implied_prob: float  # raw implied (vig included)
    fair_odds: int
    edge: float  # model_prob - implied_prob
    ev: float  # expected profit per 1u staked
    qualifies: bool


def _wager(market: str, side: str, label: str, model_prob: float, book_odds: float) -> Wager:
    implied = odds_math.american_to_prob(book_odds)
    edge = model_prob - implied
    ev = odds_math.ev_per_dollar(model_prob, book_odds)
    is_dog = book_odds > 0
    min_edge = BET_RULES["MIN_UNDERDOG_EDGE"] if is_dog else BET_RULES["MIN_FAVORITE_EDGE"]
    qualifies = edge >= min_edge and ev > BET_RULES["MIN_EV"]
    return Wager(
        market=market,
        side=side,
        label=label,
        model_prob=model_prob,
        book_odds=float(book_odds),
        implied_prob=implied,
        fair_odds=odds_math.prob_to_american(model_prob),
        edge=edge,
        ev=ev,
        qualifies=qualifies,
    )


def _spread_label(team: str, line_for_team: float) -> str:
    """Render a team's spread, e.g. ('KC', -3.5) -> 'KC -3.5'."""
    sign = "+" if line_for_team > 0 else ""
    return f"{team} {sign}{line_for_team:g}"


def analyze_game(game: dict, pred_margin: float, sigma: float) -> dict:
    """Price both markets for one game and pick the best qualifying wager.

    ``game`` supplies teams and market lines (nflverse convention:
    ``spread_line`` positive = home favored). ``pred_margin`` is the model's
    projected home margin; ``sigma`` its residual spread.
    """
    home, away = game["home_team"], game["away_team"]
    spread_line = game.get("spread_line")  # + => home favored, home laying points

    home_win = dist.home_win_prob(pred_margin, sigma)
    away_win = 1.0 - home_win

    wagers: List[Wager] = []

    # --- Moneyline ---
    # An illegal price (strictly between -100 and +100) implies a nonsense
    # probability and would fabricate an enormous edge, so drop the market
    # rather than price it. There is no sensible default for a moneyline.
    ml_home, ml_away = game.get("home_moneyline"), game.get("away_moneyline")
    if odds_math.is_valid_american(ml_home) and odds_math.is_valid_american(ml_away):
        wagers.append(_wager("moneyline", "home", f"{home} ML", home_win, ml_home))
        wagers.append(_wager("moneyline", "away", f"{away} ML", away_win, ml_away))

    # --- Spread ---
    home_odds = away_odds = None
    if spread_line is not None:
        home_cover = dist.home_cover_prob(pred_margin, spread_line, sigma)
        away_cover = 1.0 - home_cover
        # Spreads are near-universally -110; fall back to it when a book's juice
        # is missing or unusable.
        home_odds = game.get("home_spread_odds")
        away_odds = game.get("away_spread_odds")
        home_odds = home_odds if odds_math.is_valid_american(home_odds) else -110
        away_odds = away_odds if odds_math.is_valid_american(away_odds) else -110
        # nflverse spread_line is the home number; the away team gets +spread_line.
        wagers.append(
            _wager("spread", "home", _spread_label(home, -spread_line), home_cover, home_odds)
        )
        wagers.append(
            _wager("spread", "away", _spread_label(away, spread_line), away_cover, away_odds)
        )

    qualifying = sorted(
        (w for w in wagers if w.qualifies), key=lambda w: (w.ev, w.edge), reverse=True
    )

    # Vig-free market read on the moneyline, for context/coin-flip detection.
    market_home = market_away = None
    if odds_math.is_valid_american(ml_home) and odds_math.is_valid_american(ml_away):
        market_home, market_away = odds_math.remove_vig(
            [
                odds_math.american_to_prob(ml_home),
                odds_math.american_to_prob(ml_away),
            ]
        )

    lo, hi = BET_RULES["COIN_FLIP_BAND"]
    is_coin_flip = lo < home_win < hi

    return {
        "id": game.get("game_id", f"{away}@{home}"),
        "season": game.get("season"),
        "week": game.get("week"),
        "home": home,
        "away": away,
        "kickoff": game.get("gameday"),
        "projectedMargin": round(pred_margin, 2),
        "projectedWinner": home if pred_margin >= 0 else away,
        "fairSpread": dist.fair_spread_line(pred_margin),  # nflverse convention
        "coinFlip": is_coin_flip,
        "market": {
            "spreadLine": spread_line,
            "total": game.get("total_line"),
            "homeMoneyline": game.get("home_moneyline"),
            "awayMoneyline": game.get("away_moneyline"),
            "homeSpreadOdds": home_odds,
            "awaySpreadOdds": away_odds,
            "noVigHomeWin": market_home,
            "noVigAwayWin": market_away,
        },
        "moneyline": {"homeWinProb": home_win, "awayWinProb": away_win},
        "wagers": [asdict(w) for w in wagers],
        "valueBets": [asdict(w) for w in qualifying],
        "bestBet": asdict(qualifying[0]) if qualifying else None,
    }
