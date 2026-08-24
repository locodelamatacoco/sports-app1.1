"""Prior-season carryover: week 1 must carry real, regressed team information."""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import features as feat  # noqa: E402


def _team_games():
    """Two seasons: STRONG scores a lot, WEAK scores little; plus an average team."""
    rows = []
    for season in (2023, 2024):
        for week in range(1, 6):
            rows.append(dict(season=season, week=week, game_id=f"{season}_{week}_S",
                             team="STRONG", off_epa=30, def_epa=10, off_ypp=30, def_ypp=10))
            rows.append(dict(season=season, week=week, game_id=f"{season}_{week}_W",
                             team="WEAK", off_epa=10, def_epa=30, off_ypp=10, def_ypp=30))
            rows.append(dict(season=season, week=week, game_id=f"{season}_{week}_A",
                             team="AVG", off_epa=20, def_epa=20, off_ypp=20, def_ypp=20))
    return pd.DataFrame(rows)


def test_week1_is_no_longer_information_free():
    rolled = feat.build_rolling_features(_team_games())
    # 2024 week 1 has no in-season history, but should now be seeded from 2023.
    w1 = rolled[(rolled.season == 2024) & (rolled.week == 1)].set_index("team")
    assert w1.loc["STRONG", "off_epa_roll"] > w1.loc["AVG", "off_epa_roll"]
    assert w1.loc["WEAK", "off_epa_roll"] < w1.loc["AVG", "off_epa_roll"]


def test_carryover_is_regressed_toward_the_mean():
    rolled = feat.build_rolling_features(_team_games())
    w1 = rolled[(rolled.season == 2024) & (rolled.week == 1)].set_index("team")
    league = _team_games()["off_epa"].mean()  # 20
    # STRONG averaged 30 last season; the seed must sit strictly between the
    # league mean and last season's full-strength number.
    assert league < w1.loc["STRONG", "off_epa_roll"] < 30


def test_first_season_falls_back_to_league_mean():
    rolled = feat.build_rolling_features(_team_games())
    w1 = rolled[(rolled.season == 2023) & (rolled.week == 1)].set_index("team")
    # No prior season on record -> every team gets the same neutral prior.
    assert w1["off_epa_roll"].nunique() == 1


def test_carryover_can_be_disabled():
    rolled = feat.build_rolling_features(_team_games(), carryover=False)
    w1 = rolled[(rolled.season == 2024) & (rolled.week == 1)]
    assert w1["off_epa_roll"].isna().all()  # old behavior: NaN, filled downstream


def test_in_season_form_takes_over_later():
    rolled = feat.build_rolling_features(_team_games())
    strong = rolled[(rolled.season == 2024) & (rolled.team == "STRONG")]
    # By the last week the rating should be close to actual in-season output (30),
    # i.e. the seed's pull has faded.
    assert strong.sort_values("week")["off_epa_roll"].iloc[-1] > strong.sort_values("week")["off_epa_roll"].iloc[0]


def test_new_season_ratings_match_the_week1_seed():
    tg = _team_games()
    rolled = feat.build_rolling_features(tg)
    seeded = feat.latest_team_ratings(rolled, new_season=True).set_index("team")
    # Pricing a 2025 opener should reuse the same regressed-seed construction,
    # not 2024's full-strength end-of-season value.
    league = tg["off_epa"].mean()
    assert league < seeded.loc["STRONG", "off_epa_roll"] < 30
    assert 10 < seeded.loc["WEAK", "off_epa_roll"] < league
