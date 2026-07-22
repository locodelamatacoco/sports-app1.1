"""Schedules -> team-game transform (points proxy for EPA), no network."""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data  # noqa: E402


SCHED = pd.DataFrame([
    # completed game: KC beat BAL 27-20 at home
    {"game_id": "2024_01_BAL_KC", "season": 2024, "week": 1,
     "home_team": "KC", "away_team": "BAL", "home_score": 27, "away_score": 20},
    # a future/unplayed game (no scores) must be dropped from team-games
    {"game_id": "2024_01_NYG_DAL", "season": 2024, "week": 1,
     "home_team": "DAL", "away_team": "NYG", "home_score": None, "away_score": None},
])


def test_only_completed_games_become_team_rows():
    tg = data._schedules_to_team_game(SCHED)
    # one completed game -> exactly two team rows
    assert len(tg) == 2
    assert set(tg["team"]) == {"KC", "BAL"}


def test_points_proxy_offense_and_defense():
    tg = data._schedules_to_team_game(SCHED).set_index("team")
    # home team KC: scored 27, allowed 20
    assert tg.loc["KC", "off_epa"] == 27 and tg.loc["KC", "def_epa"] == 20
    # away team BAL: scored 20, allowed 27
    assert tg.loc["BAL", "off_epa"] == 20 and tg.loc["BAL", "def_epa"] == 27
    # ypp mirrors points so every rolled feature carries signal
    assert tg.loc["KC", "off_ypp"] == 27 and tg.loc["KC", "def_ypp"] == 20


def test_schema_feeds_rolling_features():
    from nfl_model.features import build_rolling_features, ROLL_COLS
    tg = data._schedules_to_team_game(SCHED)
    rolled = build_rolling_features(tg)
    assert set(ROLL_COLS).issubset(rolled.columns)
