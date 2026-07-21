"""Leakage-safe feature engineering.

Two hard rules drive everything here:

1. **Only pre-kickoff information.** Every feature for a given game is built
   from that team's games *strictly before* it. We do this with an expanding
   mean that is ``shift(1)``-ed one game back, so a team's rating entering week
   N never contains anything from week N onward. Get this wrong and your
   backtest looks brilliant and your real bets lose.

2. **Ratings are opponent-agnostic proxies, not truth.** Raw season EPA is
   confounded by strength of schedule; rolling team EPA is a cheap, honest
   starting point. Swapping in a proper opponent-adjusted rating (SRS / a
   ridge power rating) is the natural next upgrade -- see the README.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Team-strength columns we roll forward. EPA per play is the headline modern
# efficiency metric; yards per play (YPP) is the classic one. Defensive columns
# are EPA/YPP *allowed*, so lower is better.
ROLL_COLUMNS = ["off_epa", "def_epa", "off_ypp", "def_ypp"]

# The rolled (season-to-date, leakage-safe) version of each strength column.
ROLL_COLS = [f"{c}_roll" for c in ROLL_COLUMNS]


def aggregate_team_games(pbp: pd.DataFrame) -> pd.DataFrame:
    """Collapse play-by-play into one row per team per game.

    Expects the nflfastR / nfl_data_py schema: ``season``, ``week``,
    ``game_id``, ``posteam`` (offense), ``defteam`` (defense), ``epa``, and
    ``yards_gained``. Offensive rows are aggregated by ``posteam``; the same
    plays become the *defensive* rows of ``defteam`` (EPA/YPP allowed).
    """
    plays = pbp.dropna(subset=["posteam", "defteam", "epa"]).copy()

    offense = (
        plays.groupby(["season", "week", "game_id", "posteam"])
        .agg(off_epa=("epa", "mean"), off_ypp=("yards_gained", "mean"), off_plays=("epa", "size"))
        .reset_index()
        .rename(columns={"posteam": "team"})
    )
    defense = (
        plays.groupby(["season", "week", "game_id", "defteam"])
        .agg(def_epa=("epa", "mean"), def_ypp=("yards_gained", "mean"))
        .reset_index()
        .rename(columns={"defteam": "team"})
    )
    team_game = offense.merge(defense, on=["season", "week", "game_id", "team"], how="inner")
    return team_game.sort_values(["team", "season", "week"]).reset_index(drop=True)


def build_rolling_features(team_game: pd.DataFrame, min_games: int = 1) -> pd.DataFrame:
    """Add ``*_roll`` columns: each team's season-to-date average ENTERING the game.

    Uses ``expanding().mean().shift(1)`` within each (team, season), so the value
    on a given row reflects only prior weeks of that season. Early-season rows
    with fewer than ``min_games`` of history are left NaN and filled with the
    league mean by the caller (a neutral prior).
    """
    tg = team_game.sort_values(["team", "season", "week"]).copy()

    for col in ROLL_COLUMNS:
        grouped = tg.groupby(["team", "season"])[col]
        rolled = grouped.apply(lambda s: s.expanding(min_periods=min_games).mean().shift(1))
        # ``apply`` on a groupby returns a multi-indexed series; align back by position.
        tg[f"{col}_roll"] = rolled.reset_index(level=[0, 1], drop=True)

    return tg


def build_matchup_frame(games: pd.DataFrame, team_game_roll: pd.DataFrame) -> pd.DataFrame:
    """Join rolling team ratings onto each game as home/away feature columns.

    ``games`` must carry: ``season``, ``week``, ``home_team``, ``away_team`` and
    (for training) ``home_score`` / ``away_score`` and the market lines. Returns
    one row per game with the engineered feature columns plus the regression
    target ``home_margin`` (NaN for games not yet played).
    """
    ratings = team_game_roll[["season", "week", "team", *ROLL_COLS]]

    df = games.copy()
    df = df.merge(
        ratings.add_prefix("home_"),
        left_on=["season", "week", "home_team"],
        right_on=["home_season", "home_week", "home_team"],
        how="left",
    )
    df = df.merge(
        ratings.add_prefix("away_"),
        left_on=["season", "week", "away_team"],
        right_on=["away_season", "away_week", "away_team"],
        how="left",
    )
    return _add_derived_features(df, _league_means(team_game_roll))


def latest_team_ratings(team_game_roll: pd.DataFrame) -> pd.DataFrame:
    """Each team's most recent rolling rating, for pricing an upcoming slate.

    Games not yet played have no ``(season, week)`` row in ``team_game_roll``, so
    an exact join returns nothing. To price this week's slate we instead grab the
    last available rating per team -- their current form entering the games.
    """
    valid = team_game_roll.dropna(subset=ROLL_COLS, how="all")
    return (
        valid.sort_values(["team", "season", "week"])
        .groupby("team")
        .tail(1)[["team", *ROLL_COLS]]
        .reset_index(drop=True)
    )


def build_slate_frame(slate_games: pd.DataFrame, team_game_roll: pd.DataFrame) -> pd.DataFrame:
    """Attach each team's latest rating to an upcoming slate (e.g. from ESPN).

    Same feature columns as :func:`build_matchup_frame`, but joined on team
    only (using :func:`latest_team_ratings`) rather than an exact week that does
    not exist yet. Teams the model has never seen fall back to league priors.
    """
    ratings = latest_team_ratings(team_game_roll)
    df = slate_games.copy()
    df = df.merge(ratings.add_prefix("home_"), on="home_team", how="left")
    df = df.merge(ratings.add_prefix("away_"), on="away_team", how="left")
    return _add_derived_features(df, _league_means(team_game_roll))


def _league_means(team_game_roll: pd.DataFrame) -> dict:
    return {c: team_game_roll[c].mean() for c in ROLL_COLS}


def _add_derived_features(df: pd.DataFrame, league_means: dict) -> pd.DataFrame:
    """Fill priors, build matchup differentials, and (if scored) the target.

    Shared by the training path (exact-week join) and the slate path
    (latest-rating join) so both produce an identical feature vector.
    """
    # Neutral prior for any team with no prior games (season openers / unknowns).
    for side in ("home", "away"):
        for c in ROLL_COLS:
            df[f"{side}_{c}"] = df[f"{side}_{c}"].fillna(league_means[c])

    # Convenience nets; signs left for Ridge to learn from the raw components.
    df["home_net_epa"] = df["home_off_epa_roll"] - df["home_def_epa_roll"]
    df["away_net_epa"] = df["away_off_epa_roll"] - df["away_def_epa_roll"]
    df["net_epa_diff"] = df["home_net_epa"] - df["away_net_epa"]

    if "home_rest" in df.columns and "away_rest" in df.columns:
        df["rest_diff"] = df["home_rest"].fillna(7) - df["away_rest"].fillna(7)
    else:
        df["rest_diff"] = 0.0

    if {"home_score", "away_score"}.issubset(df.columns):
        df["home_margin"] = df["home_score"] - df["away_score"]
    else:
        df["home_margin"] = np.nan

    return df


# The exact feature vector fed to the model, in a fixed order.
FEATURE_COLUMNS = [
    "home_off_epa_roll",
    "home_def_epa_roll",
    "away_off_epa_roll",
    "away_def_epa_roll",
    "home_off_ypp_roll",
    "home_def_ypp_roll",
    "away_off_ypp_roll",
    "away_def_ypp_roll",
    "net_epa_diff",
    "rest_diff",
]
