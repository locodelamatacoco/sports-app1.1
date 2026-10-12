"""End-to-end pricing of a single game, plus the value gate."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import edges  # noqa: E402


def _base_game():
    return {
        "game_id": "2024_05_NO_KC",
        "season": 2024,
        "week": 5,
        "home_team": "KC",
        "away_team": "NO",
        "spread_line": 3.0,  # KC favored by 3 (KC -3)
        "total_line": 44.5,
        "home_moneyline": -160,
        "away_moneyline": 140,
        "home_spread_odds": -110,
        "away_spread_odds": -110,
    }


def test_prices_both_markets_for_both_sides():
    result = edges.analyze_game(_base_game(), pred_margin=3.0, sigma=13.5)
    markets = {(w["market"], w["side"]) for w in result["wagers"]}
    assert markets == {
        ("moneyline", "home"), ("moneyline", "away"),
        ("spread", "home"), ("spread", "away"),
    }


def test_win_probs_sum_to_one():
    result = edges.analyze_game(_base_game(), pred_margin=3.0, sigma=13.5)
    ml = result["moneyline"]
    assert ml["homeWinProb"] + ml["awayWinProb"] == pytest.approx(1.0)


def test_spread_label_uses_home_number():
    # spread_line=3 (home favored) -> home lays -3, away gets +3.
    result = edges.analyze_game(_base_game(), pred_margin=3.0, sigma=13.5)
    home_spread = next(w for w in result["wagers"] if w["market"] == "spread" and w["side"] == "home")
    away_spread = next(w for w in result["wagers"] if w["market"] == "spread" and w["side"] == "away")
    assert home_spread["label"] == "KC -3"
    assert away_spread["label"] == "NO +3"


def test_value_bet_flagged_when_model_disagrees_with_book():
    # Model loves the home team far more than the -160 price implies.
    result = edges.analyze_game(_base_game(), pred_margin=13.0, sigma=13.5)
    assert result["bestBet"] is not None
    assert result["bestBet"]["edge"] > 0
    assert result["bestBet"]["ev"] > 0


def test_no_value_when_model_agrees_with_book():
    # Projection roughly matches the line -> nothing should clear the gate.
    result = edges.analyze_game(_base_game(), pred_margin=3.2, sigma=13.5)
    assert result["bestBet"] is None
    assert result["valueBets"] == []


# --------------------------------------------------------------------------- #
# Best-price shopping
# --------------------------------------------------------------------------- #
def _game_with_quotes(home_quotes, away_quotes):
    return {
        "game_id": "T", "home_team": "KC", "away_team": "DEN",
        "spread_line": 3.0, "home_spread_odds": -110, "away_spread_odds": -110,
        "home_spread_quotes": home_quotes, "away_spread_quotes": away_quotes,
    }


def _spread(out, side):
    return next(w for w in out["wagers"] if w["market"] == "spread" and w["side"] == side)


def test_shopping_takes_the_better_price_at_the_same_number():
    out = edges.analyze_game(_game_with_quotes([(3.0, -110), (3.0, -104)], []), 6.0, 13.2)
    home = _spread(out, "home")
    assert home["book_odds"] == -104
    assert home["line"] == 3.0
    # Consensus is reported untouched -- shopping changes the bet, not the read.
    assert out["market"]["spreadLine"] == 3.0
    assert out["market"]["homeBestSpread"] == {"line": 3.0, "odds": -104}


def test_shopping_weighs_the_number_against_the_juice():
    # A half point cheaper, but 14 cents more juice: the gate must compare whole
    # quotes, not pick the best line and the best price separately.
    out = edges.analyze_game(_game_with_quotes([(2.5, -124), (3.0, -110)], []), 6.0, 13.2)
    home = _spread(out, "home")
    assert (home["line"], home["book_odds"]) == (3.0, -110)


def test_away_side_shops_its_own_book():
    out = edges.analyze_game(_game_with_quotes([], [(3.0, -110), (3.5, -108)]), 6.0, 13.2)
    away = _spread(out, "away")
    assert away["line"] == 3.5          # nflverse convention: DEN getting 3.5
    assert away["label"] == "DEN +3.5"
    assert away["book_odds"] == -108


def test_shopping_falls_back_to_consensus_without_quotes():
    out = edges.analyze_game(_game_with_quotes(None, None), 6.0, 13.2)
    home = _spread(out, "home")
    assert (home["line"], home["book_odds"]) == (3.0, -110)


def test_shopping_ignores_illegal_prices():
    out = edges.analyze_game(_game_with_quotes([(3.0, -110), (3.0, -2)], []), 6.0, 13.2)
    # -2 implies a 98% win probability; it is not a real price.
    assert _spread(out, "home")["book_odds"] == -110


# --------------------------------------------------------------------------- #
# The edge requirement must be continuous in the price
# --------------------------------------------------------------------------- #
def test_no_step_across_the_even_money_boundary():
    # The old rule jumped 3% -> 5% at +/-100, so a price improving from -101 to
    # +100 raised the bar two points. Nothing about the economics changes there.
    just_under = edges.required_edge(-101)
    just_over = edges.required_edge(100)
    assert abs(just_over - just_under) < 0.005


def test_requirement_rises_as_the_price_lengthens():
    prices = [-200, -130, -110, 100, 150, 300]
    req = [edges.required_edge(p) for p in prices]
    assert req == sorted(req)


def test_reference_price_keeps_its_historical_threshold():
    # -110 is where most spread prices sit; it must still ask for 3%.
    assert abs(edges.required_edge(-110) - 0.03) < 1e-9


def test_requirement_is_clipped_at_both_ends():
    assert edges.required_edge(-5000) == edges.BET_RULES["MIN_EDGE_FLOOR"]
    assert edges.required_edge(5000) == edges.BET_RULES["MIN_EDGE_CEILING"]


def test_a_better_price_never_disqualifies_a_bet():
    """The bug this replaced: same side, same number, better price, rejected.

    Walk a bet's price up through the old boundary and check that a wager which
    qualifies at a worse price still qualifies at a better one.
    """
    game = {"game_id": "T", "home_team": "KC", "away_team": "DEN",
            "spread_line": 3.0, "home_spread_odds": -105, "away_spread_odds": -105}
    worse = edges.analyze_game(dict(game, home_spread_odds=-105), 6.0, 13.2)
    better = edges.analyze_game(dict(game, home_spread_odds=100), 6.0, 13.2)
    w = next(x for x in worse["wagers"] if x["market"] == "spread" and x["side"] == "home")
    b = next(x for x in better["wagers"] if x["market"] == "spread" and x["side"] == "home")
    assert b["edge"] > w["edge"]          # the better price is a bigger edge
    assert not (w["qualifies"] and not b["qualifies"])
