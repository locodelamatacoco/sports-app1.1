"""Grading arithmetic for the live pick ledger."""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from scripts.track import _grade_one  # noqa: E402


def _pick(market, side, odds=-110, line=3.0):
    return pd.Series({"market": market, "side": side, "book_odds": odds, "spread_line": line})


def test_home_spread_wins_when_margin_beats_the_line():
    # Home laying 3 wins by 7 -> covers.
    assert _grade_one(_pick("spread", "home"), 7.0) == pytest.approx(100 / 110)


def test_home_spread_loses_inside_the_number():
    assert _grade_one(_pick("spread", "home"), 1.0) == -1.0


def test_away_spread_is_the_mirror():
    # Same game from the other side: away +3 with home winning by 1 -> covers.
    assert _grade_one(_pick("spread", "away"), 1.0) == pytest.approx(100 / 110)


def test_exact_number_is_a_push():
    assert _grade_one(_pick("spread", "home"), 3.0) == 0.0
    assert _grade_one(_pick("spread", "away"), 3.0) == 0.0


def test_moneyline_pays_the_price():
    assert _grade_one(_pick("moneyline", "away", odds=160), -6.0) == pytest.approx(1.6)
    assert _grade_one(_pick("moneyline", "away", odds=160), 6.0) == -1.0


def test_moneyline_tie_is_a_push():
    assert _grade_one(_pick("moneyline", "home", odds=-120), 0.0) == 0.0


def test_spread_without_a_line_cannot_be_settled():
    assert _grade_one(_pick("spread", "home", line=float("nan")), 7.0) is None
