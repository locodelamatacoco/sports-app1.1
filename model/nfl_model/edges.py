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
    # Markets the gate is allowed to flag. Moneylines are excluded on evidence,
    # not taste: across 1,900 walk-forward wagers (2012-2026) they return -5.97%
    # with a 95% CI of [-11.06%, -0.88%] -- the one slice whose interval clears
    # zero, and on the losing side. The same slice was the worst performer in
    # every earlier version of the model too, so this is a standing result
    # rather than a bucket picked out of one backtest.
    #
    # Spreads over that same span sit at +0.46% [-3.46%, +4.38%], but that is
    # the FLATTERING window and should not be quoted on its own. Restricted to
    # 2019-2026, where the features are best populated, gated spreads return
    # -5.12% [-10.63%, +0.39%] over 1,161 bets, and taking a side on *every*
    # game returns -6.32% [-10.53%, -2.02%] over 1,947 -- that interval clears
    # zero on the losing side. Across every slice the model wins 47-49% ATS
    # against a 52.38% break-even; it has never shown 52.4%+ in a large sample.
    #
    # The mechanism is in the disagreement profile: when the model and the line
    # agree to within a point, their errors are identical (gap +0.02 pts). The
    # gap then grows monotonically with disagreement, reaching +1.13 pts
    # [+0.65, +1.62] at 4-6 points apart. The gate fires only on disagreement,
    # so by construction it selects the games where the model is least
    # reliable -- and no threshold escapes that, because raising it selects
    # MORE disagreement. That is a structural problem, not a tuning one.
    #
    # Both markets are still priced and exported; this only governs what gets
    # *flagged* as a bet. Flagged is not a recommendation to stake.
    "MARKETS": ("spread",),
}


@dataclass
class Wager:
    """One priced betting option (a single side of a single market)."""

    market: str  # "moneyline" | "spread"
    side: str  # "home" | "away"
    label: str  # human-readable, e.g. "KC -3.5" or "NO ML"
    # The number this wager is actually struck at, in nflverse convention
    # (positive = home favored). Best-price shopping means this can differ from
    # the game's consensus ``spreadLine``, and the bet must be graded against
    # the number it was taken at, not the middle of the market. None = no line
    # (moneyline).
    line: Optional[float]
    model_prob: float
    book_odds: float
    implied_prob: float  # raw implied (vig included)
    fair_odds: int
    edge: float  # model_prob - implied_prob
    ev: float  # expected profit per 1u staked
    qualifies: bool


def _wager(market: str, side: str, label: str, model_prob: float, book_odds: float,
           line: Optional[float] = None) -> Wager:
    implied = odds_math.american_to_prob(book_odds)
    edge = model_prob - implied
    ev = odds_math.ev_per_dollar(model_prob, book_odds)
    is_dog = book_odds > 0
    min_edge = BET_RULES["MIN_UNDERDOG_EDGE"] if is_dog else BET_RULES["MIN_FAVORITE_EDGE"]
    qualifies = (
        market in BET_RULES["MARKETS"]
        and edge >= min_edge
        and ev > BET_RULES["MIN_EV"]
    )
    return Wager(
        market=market,
        side=side,
        label=label,
        line=line,
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


def _best_spread_quote(quotes, pred_margin: float, sigma: float, side: str,
                       fallback_line: float, fallback_odds: float):
    """Pick the (line, price) with the highest EV among the books on offer.

    A better number at worse juice is not automatically better -- CLE +9 at -118
    against +8.5 at -110 depends on where the margin distribution has its mass --
    so the two cannot be optimised separately. Evaluate each quote whole and take
    the best; with no usable quotes, fall back to the consensus.

    ``quotes`` are ``(line, price)`` in nflverse convention (positive = home
    favored), i.e. the same ``spread_line`` the consensus uses.
    """
    best = (fallback_line, fallback_odds)
    best_prob = _cover_prob(pred_margin, fallback_line, sigma, side)
    best_ev = odds_math.ev_per_dollar(best_prob, fallback_odds)

    for quote in quotes if quotes is not None else []:
        try:
            line, price = float(quote[0]), float(quote[1])
        except (TypeError, ValueError, IndexError):
            continue
        if not odds_math.is_valid_american(price):
            continue
        prob = _cover_prob(pred_margin, line, sigma, side)
        ev = odds_math.ev_per_dollar(prob, price)
        if ev > best_ev:
            best, best_prob, best_ev = (line, price), prob, ev
    return best[0], best[1], best_prob


def _cover_prob(pred_margin: float, line: float, sigma: float, side: str) -> float:
    home = dist.home_cover_prob(pred_margin, line, sigma)
    return home if side == "home" else 1.0 - home


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
    # The consensus number is what the model is measured against; the wager is
    # staked at the best number any book is actually offering. Shopping the nine
    # books on this feed was worth ~1.6 pts of EV per bet on a live slate --
    # more than the spread model's entire measured edge, and it costs nothing.
    home_odds = away_odds = None
    home_best = away_best = None
    if spread_line is not None:
        # Spreads are near-universally -110; fall back to it when a book's juice
        # is missing or unusable.
        home_odds = game.get("home_spread_odds")
        away_odds = game.get("away_spread_odds")
        home_odds = home_odds if odds_math.is_valid_american(home_odds) else -110
        away_odds = away_odds if odds_math.is_valid_american(away_odds) else -110

        home_line, home_price, home_cover = _best_spread_quote(
            game.get("home_spread_quotes"), pred_margin, sigma, "home", spread_line, home_odds
        )
        away_line, away_price, away_cover = _best_spread_quote(
            game.get("away_spread_quotes"), pred_margin, sigma, "away", spread_line, away_odds
        )
        home_best = {"line": home_line, "odds": home_price}
        away_best = {"line": away_line, "odds": away_price}
        # nflverse spread_line is the home number; the away team gets +spread_line.
        wagers.append(
            _wager("spread", "home", _spread_label(home, -home_line), home_cover, home_price,
                   line=home_line)
        )
        wagers.append(
            _wager("spread", "away", _spread_label(away, away_line), away_cover, away_price,
                   line=away_line)
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
        "homePartid": game.get("home_partid"),
        "awayPartid": game.get("away_partid"),
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
            # Best number on offer across books, vs the consensus above.
            "homeBestSpread": home_best,
            "awayBestSpread": away_best,
            "noVigHomeWin": market_home,
            "noVigAwayWin": market_away,
        },
        "moneyline": {"homeWinProb": home_win, "awayWinProb": away_win},
        "wagers": [asdict(w) for w in wagers],
        "valueBets": [asdict(w) for w in qualifying],
        "bestBet": asdict(qualifying[0]) if qualifying else None,
    }
