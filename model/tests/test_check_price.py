"""The hand-entered price check must agree with the model's own gate."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_price  # noqa: E402
from nfl_model import edges  # noqa: E402

GAME = {"id": "x", "home": "SEA", "away": "CHI", "projectedMargin": 5.33}
SIGMA = 12.9175


def test_matches_analyze_game_on_the_same_quote():
    game = {"home_team": "SEA", "away_team": "CHI", "spread_line": 3.0,
            "home_spread_odds": -117, "away_spread_odds": -103,
            "home_spread_quotes": [(3.5, 105)], "away_spread_quotes": []}
    best = edges.analyze_game(game, 5.33, SIGMA)["bestBet"]
    mine = check_price.check(GAME, SIGMA, "SEA", -3.5, 105)["wager"]
    assert mine.label == best["label"] == "SEA -3.5"
    assert mine.ev == pytest.approx(best["ev"], abs=1e-9)
    assert mine.qualifies == best["qualifies"]


def test_line_is_read_from_the_teams_side():
    home = check_price.check(GAME, SIGMA, "SEA", -3, -110)
    away = check_price.check(GAME, SIGMA, "chi", 3, -110)
    # Same number from both sides: complementary cover, same push.
    assert home["wager"].model_prob + away["wager"].model_prob == pytest.approx(1.0)
    assert home["push"] == pytest.approx(away["push"])
    assert home["push"] > 0.05
    assert check_price.check(GAME, SIGMA, "SEA", -3.5, -110)["push"] == 0.0


def test_rejects_bad_input():
    with pytest.raises(SystemExit):
        check_price.parse_checks(["SEA", "-3"])
    with pytest.raises(SystemExit):
        check_price.parse_checks(["SEA", "-3", "-50"])
    with pytest.raises(SystemExit):
        check_price.find_game([GAME], "KC")
