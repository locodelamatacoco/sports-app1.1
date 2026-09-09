"""Opponent-adjusted ridge ratings: team strength, QB strength, HFA, leakage."""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import power as pw  # noqa: E402


def _game(season, week, home, away, margin, hqb=None, aqb=None, location="Home"):
    return dict(season=season, week=week, home_team=home, away_team=away,
                home_margin=margin, home_qb_id=hqb, away_qb_id=aqb, location=location)


def _round_robin(margin_map, season=2024, weeks=3):
    """Each listed pairing played `weeks` times, home and away.

    Both venues matter: if a pairing only ever plays at one site, home-field
    advantage alone can explain the results and the team ratings stay flat.
    ``margin_map`` gives the first team's winning margin, so the return fixture
    is recorded from the other side.
    """
    rows = []
    for w in range(1, weeks + 1):
        for (strong, weak), margin in margin_map.items():
            # strong at home, then strong on the road (a smaller but still a win)
            rows.append(_game(season, w, strong, weak, margin, f"QB_{strong}", f"QB_{weak}"))
            rows.append(_game(season, w, weak, strong, -margin, f"QB_{weak}", f"QB_{strong}"))
    return pd.DataFrame(rows)


def test_ratings_order_teams_by_strength():
    # A beats B home and away, B does the same to C -> A > B > C.
    games = _round_robin({("A", "B"): 10, ("B", "C"): 10})
    r = pw.fit_power_ratings(games, use_qb=False)
    assert r.team["A"] > r.team["B"] > r.team["C"]


def test_ratings_are_centered():
    games = _round_robin({("A", "B"): 10, ("B", "C"): 10})
    r = pw.fit_power_ratings(games, use_qb=False)
    assert sum(r.team.values()) == pytest.approx(0.0, abs=1e-6)
    assert max(r.team.values()) > 0  # and not the degenerate all-zero solution


def test_opponent_adjustment_beats_raw_margin():
    # A and D both win by 7, but A does it against strong B while D beats weak E.
    # An opponent-adjusted rating must rank A above D; raw margin cannot.
    rows = []
    for w in range(1, 5):
        rows += [
            _game(2024, w, "B", "E", 21),   # B is far better than E
            _game(2024, w, "A", "B", 7),    # A beats the strong team by 7
            _game(2024, w, "D", "E", 7),    # D beats the weak team by 7
        ]
    r = pw.fit_power_ratings(pd.DataFrame(rows), use_qb=False)
    assert r.team["A"] > r.team["D"]


def test_home_field_advantage_is_estimated():
    # Every home team wins by exactly 6 -> HFA should land near 6 and the
    # teams themselves should come out even.
    rows = []
    for w in range(1, 5):
        rows += [_game(2024, w, "A", "B", 6), _game(2024, w, "B", "A", 6)]
    r = pw.fit_power_ratings(pd.DataFrame(rows), use_qb=False)
    assert r.hfa == pytest.approx(6.0, abs=1.0)
    assert r.team["A"] == pytest.approx(r.team["B"], abs=1e-6)


def test_neutral_site_gets_no_home_edge():
    rows = []
    for w in range(1, 5):
        rows += [_game(2024, w, "A", "B", 6), _game(2024, w, "B", "A", 6)]
    # The same fixtures at neutral sites carry no home advantage to find.
    neutral = pd.DataFrame([{**g, "location": "Neutral"} for g in rows])
    assert pw.fit_power_ratings(neutral, use_qb=False).hfa == pytest.approx(0.0, abs=1.0)


def test_qb_rating_separates_from_team():
    # Team T wins big with its starter and loses with the backup; the QB terms
    # should carry that difference rather than the team rating alone.
    rows = []
    for w in range(1, 6):
        rows.append(_game(2024, w, "T", "O", 14, "STAR", "QB_O"))
    for w in range(6, 11):
        rows.append(_game(2024, w, "T", "O", -14, "BACKUP", "QB_O"))
    r = pw.fit_power_ratings(pd.DataFrame(rows), use_qb=True)
    assert r.qb["STAR"] > r.qb["BACKUP"]


def test_strength_combines_team_and_qb():
    games = _round_robin({("A", "B"): 10})
    r = pw.fit_power_ratings(games)
    assert r.strength("A", "QB_A") == pytest.approx(r.team["A"] + r.qb.get("QB_A", 0.0))
    assert r.strength("A") == pytest.approx(r.team["A"])  # no QB given


def test_power_features_are_leakage_safe():
    # Week 1 has no in-season history, so its rating cannot depend on results
    # from that same season -- it must come from the (empty) prior-season seed.
    games = _round_robin({("A", "B"): 30, ("C", "D"): 0}, weeks=4)
    feats = pw.build_power_features(games)
    w1 = feats[feats.week == 1]
    assert (w1.home_power == 0).all() and (w1.away_power == 0).all()


def test_primary_starter_beats_last_game_starter():
    # The real trap: a rested week-18 game started by a third-stringer must not
    # become next season's assumed starter.
    rows = [_game(2024, w, "KC", "O", 10, "MAHOMES", "QB_O") for w in range(1, 17)]
    rows.append(_game(2024, 18, "KC", "O", -3, "BACKUP", "QB_O"))
    starters = pw.last_known_starters(pd.DataFrame(rows))
    assert starters["KC"] == "MAHOMES"


def test_starters_use_the_latest_season_only():
    rows = [_game(2023, w, "T", "O", 3, "OLD_GUY", "QB_O") for w in range(1, 10)]
    rows += [_game(2024, w, "T", "O", 3, "NEW_GUY", "QB_O") for w in range(1, 10)]
    assert pw.last_known_starters(pd.DataFrame(rows))["T"] == "NEW_GUY"
