"""QB ratings: leakage-safe, shrunk to replacement level, decayed by season."""
import pandas as pd
import pytest

from nfl_model import qb_quality as qbq


def _games(rows):
    return pd.DataFrame(rows, columns=["player_id", "name", "season", "week", "plays", "epa"])


BOOK = qbq.QbBook(_games([
    ("vet", "Vet Starter", 2024, 1, 600, 120.0),     # +0.20 per play
    ("vet", "Vet Starter", 2025, 1, 60, 12.0),
    ("kid", "Kid Rookie", 2026, 8, 25, -10.0),
]), prior=-0.10)


def test_unknown_quarterback_is_replacement_level():
    assert BOOK.rating("nobody", 2026, 9) == pytest.approx(-0.10)
    assert BOOK.rating(None, 2026, 9) == pytest.approx(-0.10)


def test_only_games_before_the_week_count():
    # Rookie's only game is week 8: invisible in week 8, visible in week 9.
    assert BOOK.rating("kid", 2026, 8) == pytest.approx(-0.10)
    r9 = BOOK.rating("kid", 2026, 9)
    assert r9 == pytest.approx((-10.0 + 250 * -0.10) / (25 + 250))
    assert r9 < -0.10


def test_older_seasons_decay():
    plays, epa = BOOK.evidence("vet", 2026, 1)
    # 2024 decays twice, 2025 once, into 2026.
    assert plays == pytest.approx(600 * 0.7 ** 2 + 60 * 0.7)
    assert epa == pytest.approx(120 * 0.7 ** 2 + 12 * 0.7)
    # (67.2 + 250 * -0.10) / (336 + 250)
    assert BOOK.rating("vet", 2026, 1) == pytest.approx(42.2 / 586)


def test_name_lookup_and_features():
    assert BOOK.id_for_name("Kid Rookie") == "kid"
    games = pd.DataFrame({
        "season": [2026, 2026], "week": [8, 9],
        "home_team": ["BAL", "BAL"], "away_team": ["BUF", "JAX"],
        "home_qb_id": ["vet", "kid"], "away_qb_id": [None, None],
    })
    f = qbq.add_qb_features(games.iloc[[1]].reset_index(drop=True), games, BOOK)
    # Kid replaces the vet his team used last week: a large negative delta.
    assert f["home_qb_delta"].iloc[0] < -0.15
    assert f["qb_delta_diff"].iloc[0] < -0.15
    assert f["qb_epa_diff"].iloc[0] == pytest.approx(f["home_qb_rating"].iloc[0] + 0.10)
