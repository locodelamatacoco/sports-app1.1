"""Odds math must stay 1:1 with the JS helpers in ufcSimulator.js."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import odds  # noqa: E402


def test_american_to_prob_matches_js():
    assert odds.american_to_prob(-110) == pytest.approx(110 / 210)
    assert odds.american_to_prob(150) == pytest.approx(100 / 250)
    assert odds.american_to_prob(100) == pytest.approx(0.5)


def test_prob_to_american_roundtrips():
    for p in (0.25, 0.4, 0.5, 0.55, 0.75, 0.9):
        american = odds.prob_to_american(p)
        assert odds.american_to_prob(american) == pytest.approx(p, abs=0.01)


def test_prob_to_american_sign():
    assert odds.prob_to_american(0.7) < 0  # favorite -> negative
    assert odds.prob_to_american(0.3) > 0  # underdog -> positive


def test_decimal_conversion():
    assert odds.american_to_decimal(100) == pytest.approx(2.0)
    assert odds.american_to_decimal(-200) == pytest.approx(1.5)
    assert odds.american_to_decimal(150) == pytest.approx(2.5)


def test_remove_vig_sums_to_one():
    probs = odds.remove_vig([odds.american_to_prob(-150), odds.american_to_prob(130)])
    assert sum(probs) == pytest.approx(1.0)
    assert probs[0] > probs[1]  # the favorite keeps the larger share


def test_ev_positive_when_model_beats_price():
    # Model says 60% on a +100 (even-money) bet -> clearly +EV.
    assert odds.ev_per_dollar(0.60, 100) == pytest.approx(0.20, abs=1e-9)
    # Fair coin on -110 juice -> negative EV.
    assert odds.ev_per_dollar(0.50, -110) < 0


def test_is_valid_american_rejects_the_impossible_gap():
    # No American price exists strictly between -100 and +100.
    for bad in (-99, -50, -8, -2, 0, 1.5, 50, 99):
        assert not odds.is_valid_american(bad), bad
    for good in (-100, 100, -110, 150, -1270, 434):
        assert odds.is_valid_american(good), good


def test_is_valid_american_rejects_junk():
    assert not odds.is_valid_american(None)
    assert not odds.is_valid_american("abc")
    assert not odds.is_valid_american(float("nan"))
