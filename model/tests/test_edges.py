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
