"""The margin->probability bridge and its internal consistency."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import distribution as dist  # noqa: E402


def test_pickem_is_a_coin_flip():
    assert dist.home_win_prob(0.0) == pytest.approx(0.5)
    assert dist.home_cover_prob(0.0, 0.0) == pytest.approx(0.5)


def test_favorite_has_higher_win_prob():
    assert dist.home_win_prob(7.0) > 0.5
    assert dist.home_win_prob(-7.0) < 0.5
    # Symmetry around zero.
    assert dist.home_win_prob(7.0) == pytest.approx(1 - dist.home_win_prob(-7.0))


def test_cover_prob_uses_the_line():
    # Projected to win by 6 but laying 3 -> still favored to cover.
    assert dist.home_cover_prob(6.0, 3.0) > 0.5
    # Projected to win by 3 but laying 7 -> underdog to cover.
    assert dist.home_cover_prob(3.0, 7.0) < 0.5
    # Betting exactly the projection is a coin flip on the cover.
    assert dist.home_cover_prob(6.0, 6.0) == pytest.approx(0.5)


def test_moneyline_and_spread_are_consistent():
    # A model that projects the home team winning by mu must agree that:
    # its moneyline win prob == its cover prob against the pick-em (0) line.
    mu, sigma = 4.5, 13.5
    assert dist.home_win_prob(mu, sigma) == pytest.approx(dist.home_cover_prob(mu, 0.0, sigma))


def test_fair_spread_snaps_to_half_points():
    assert dist.fair_spread_line(3.24) == 3.0
    assert dist.fair_spread_line(3.30) == 3.5
    assert dist.fair_spread_line(-6.9) == -7.0


# --------------------------------------------------------------------------- #
# Discrete margin distribution
# --------------------------------------------------------------------------- #
from nfl_model import simulation as sim  # noqa: E402


def test_key_numbers_match_reality():
    """A continuous distribution cannot do this; it is the reason this exists."""
    d = sim.margin_distribution(0.0)
    mass = lambda k: float(d.probs[abs(d.margins) == k].sum())
    # Real rates over 3,134 games: 14.93% at 3, 8.74% at 7.
    assert 0.13 < mass(3) < 0.17
    assert 0.07 < mass(7) < 0.11
    # ... and a margin of 3 must be far more likely than the neighbours it
    # would be smeared into.
    assert mass(3) > 2.5 * mass(2)
    assert mass(3) > 2.5 * mass(4)


def test_distribution_sums_to_one():
    d = sim.margin_distribution(7.5)
    assert abs(d.probs.sum() - 1.0) < 1e-9


def test_push_is_real_at_a_key_number_and_zero_at_a_half_point():
    assert sim.push_prob(3.0, 3.0) > 0.05
    assert sim.push_prob(3.0, 3.5) == 0.0


def test_cover_probabilities_exclude_pushes_and_sum_to_one():
    home, away, push = sim.margin_distribution(2.0).cover(3.0)
    assert push > 0
    assert abs(home + away - 1.0) < 1e-9


def test_projection_still_drives_the_answer():
    """The lumpiness must not swamp the model's actual opinion."""
    assert sim.home_win_prob(10.0) > sim.home_win_prob(0.0) > sim.home_win_prob(-10.0)


# --------------------------------------------------------------------------- #
# Per-game profile (every game, bet or not)
# --------------------------------------------------------------------------- #
def test_profile_buckets_cover_every_outcome():
    prof = sim.game_profile(4.0, 13.0, 3.5, 44.5)
    assert abs(sum(prof["buckets"].values()) - 1.0) < 1e-9


def test_profile_band_is_ordered_and_contains_the_projection():
    prof = sim.game_profile(4.0, 13.0, 3.5, 44.5)
    assert prof["p10"] <= prof["p50"] <= prof["p90"]
    assert prof["p10"] < 4.0 < prof["p90"]


def test_profile_win_probabilities_sum_to_one():
    prof = sim.game_profile(-6.5, 13.0, -7.0, 41.0)
    assert abs(prof["homeWin"] + prof["awayWin"] - 1.0) < 1e-9
    assert prof["awayWin"] > prof["homeWin"]        # away favoured by 6.5


def test_profile_splits_the_market_total_by_the_projection():
    prof = sim.game_profile(4.0, 13.0, 3.5, 44.0)
    assert prof["projHome"] == 24.0 and prof["projAway"] == 20.0


def test_profile_without_a_line_or_total_still_describes_the_game():
    prof = sim.game_profile(2.0, 13.0, None, None)
    assert "homeCover" not in prof and "projHome" not in prof
    assert 0.5 < prof["homeWin"] < 0.65


def test_profile_reports_a_push_only_where_one_can_happen():
    assert sim.game_profile(3.0, 13.0, 3.0, 44.0)["push"] > 0.05
    assert sim.game_profile(3.0, 13.0, 3.5, 44.0)["push"] == 0.0


def test_h2h_meetings_and_summary():
    import pandas as pd
    from nfl_model import h2h
    sched = pd.DataFrame([
        dict(season=2025, week=3, gameday="2025-09-21", home_team="SEA", away_team="CHI",
             home_score=27, away_score=20, spread_line=3.0),
        dict(season=2025, week=14, gameday="2025-12-07", home_team="CHI", away_team="SEA",
             home_score=17, away_score=20, spread_line=-2.5),
        dict(season=2026, week=8, gameday="2026-11-02", home_team="SEA", away_team="CHI",
             home_score=17, away_score=34, spread_line=3.0),
        dict(season=2026, week=9, gameday="2026-11-08", home_team="SEA", away_team="ARI",
             home_score=None, away_score=None, spread_line=11.0),
    ])
    past = h2h.meetings(sched, "SEA", "CHI", before="2026-11-02T20:00:00Z")
    assert [m["season"] for m in past] == [2025, 2025]          # newest first, 2026 excluded
    assert past[0]["winner"] == "SEA" and past[0]["covered"] == "SEA"  # newest: won at CHI by 3 as a 2.5-pt dog
    assert past[1]["covered"] == "SEA"                         # won by 7, laid 3
    s = h2h.summary(past, "SEA")
    assert (s["wins"], s["losses"], s["atsWins"], s["atsLosses"]) == (2, 0, 2, 0)
    assert h2h.summary(h2h.meetings(sched, "SEA", "CHI"), "CHI")["wins"] == 1
