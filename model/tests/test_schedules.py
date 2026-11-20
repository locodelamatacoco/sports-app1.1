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


# --------------------------------------------------------------------------- #
# Slate week stamping
# --------------------------------------------------------------------------- #
from nfl_model import features as feat  # noqa: E402

# A full week as a book posts it: a Thursday opener, the Sunday slate, and a
# Monday-nighter that falls in the NEXT calendar week.
_WEEK2 = pd.DataFrame([
    {"season": 2026, "week": 2, "home_team": "BUF", "away_team": "DET"},   # Thu
    {"season": 2026, "week": 2, "home_team": "CHI", "away_team": "MIN"},   # Sun
    {"season": 2026, "week": 2, "home_team": "KC", "away_team": "IND"},    # Sun night
    {"season": 2026, "week": 2, "home_team": "LA", "away_team": "NYG"},    # Mon
    {"season": 2026, "week": 3, "home_team": "SEA", "away_team": "NO"},
])


def test_schedule_week_keeps_a_week_together_across_calendar_weeks():
    slate = pd.DataFrame([
        {"season": 2026, "home_team": "BUF", "away_team": "DET"},
        {"season": 2026, "home_team": "CHI", "away_team": "MIN"},
        {"season": 2026, "home_team": "LA", "away_team": "NYG"},
    ])
    out = feat.attach_schedule_week(slate, _WEEK2)
    # The Monday game belongs to week 2, not a phantom week of its own.
    assert list(out["week"]) == [2, 2, 2]


def test_schedule_week_leaves_unmatched_games_alone():
    slate = pd.DataFrame([
        {"season": 2026, "home_team": "CHI", "away_team": "MIN"},
        {"season": 2026, "home_team": "XXX", "away_team": "YYY"},
    ])
    out = feat.attach_schedule_week(slate, _WEEK2)
    assert out.loc[0, "week"] == 2
    assert pd.isna(out.loc[1, "week"])  # never guess a week we can't verify


def test_schedule_week_is_season_aware():
    slate = pd.DataFrame([{"season": 2025, "home_team": "CHI", "away_team": "MIN"}])
    out = feat.attach_schedule_week(slate, _WEEK2)
    assert pd.isna(out.loc[0, "week"])  # same matchup, different season


def test_slate_gets_neutral_site_division_and_rest_from_schedule():
    import pandas as pd
    from nfl_model import features as feat
    games = pd.DataFrame({
        "season": [2026, 2026], "week": [11, 11],
        "home_team": ["SF", "DEN"], "away_team": ["MIN", "LV"],
        "location": ["Neutral", "Home"], "div_game": [0, 1],
        "home_rest": [7, 14], "away_rest": [7, 7],
    })
    slate = pd.DataFrame({"season": [2026.0, 2026.0, 2026.0],
                          "home_team": ["SF", "DEN", "KC"], "away_team": ["MIN", "LV", "ARI"]})
    out = feat.add_context_features(feat.attach_schedule_context(slate, games))
    assert list(out["neutral"]) == [1.0, 0.0, 0.0]
    assert list(out["div_game"]) == [0.0, 1.0, 0.0]
    assert list(out["home_rest"].fillna(-1)) == [7, 14, -1]   # unmatched game keeps the old default
