"""Leakage-safe feature engineering.

Two hard rules drive everything here:

1. **Only pre-kickoff information.** Every feature for a given game is built
   from that team's games *strictly before* it. We do this with an expanding
   mean that is ``shift(1)``-ed one game back, so a team's rating entering week
   N never contains anything from week N onward. Get this wrong and your
   backtest looks brilliant and your real bets lose.

2. **Ratings are opponent-agnostic proxies, not truth.** The rating columns are
   a team's rolling offensive/defensive output, a cheap, honest starting point.
   They are populated from real schedule scores (points for / against -- see
   ``data.load_schedule_data``); the column names keep an ``epa`` prefix so the
   model code is source-agnostic if a richer per-play feed is added later.
   Swapping in a proper opponent-adjusted rating (SRS / a ridge power rating) is
   the natural next upgrade -- see the README.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Team-strength columns we roll forward: offensive and defensive output, plus a
# second "yards" proxy. Defensive columns are output *allowed*, so lower is
# better. (Names keep the ``epa`` prefix for source-agnosticism; in this build
# they are fed by points scored/allowed from the schedules.)
ROLL_COLUMNS = ["off_epa", "def_epa", "off_ypp", "def_ypp"]

# The rolled (season-to-date, leakage-safe) version of each strength column.
ROLL_COLS = [f"{c}_roll" for c in ROLL_COLUMNS]

# How much of a team's prior-season form survives the offseason. Roster churn,
# the draft, and coaching turnover mean last year's rating is a weak-to-moderate
# predictor, so it is shrunk toward the league average before seeding a season.
PRIOR_SEASON_CARRYOVER = 0.55

# The seeded prior-season rating is worth this many in-season games. At week 1
# it is the whole rating; by week ~6 the current season dominates.
PRIOR_GAMES_EQUIV = 6.0

# Both constants were swept against out-of-sample (time-series CV) RMSE on
# 2010-2025. The surface is deliberately flat -- anything in carryover 0.45-0.65
# with K 4-9 scores within ~0.01 points -- so these are round values from the
# middle of that region rather than a precisely-fitted optimum.


def build_rolling_features(
    team_game: pd.DataFrame, min_games: int = 1, carryover: bool = True
) -> pd.DataFrame:
    """Add ``*_roll`` columns: each team's rating ENTERING the game.

    Two ingredients, both strictly pre-kickoff:

    1. **In-season form** -- ``expanding().mean().shift(1)`` within each
       (team, season), so the value on a row reflects only prior weeks.
    2. **Prior-season seed** (``carryover``) -- last season's average, shrunk
       toward the league mean by :data:`PRIOR_SEASON_CARRYOVER`.

    They are blended by how much of the current season has actually happened::

        rating = (n * in_season + K * seed) / (n + K)

    where ``n`` is games played so far and ``K`` is :data:`PRIOR_GAMES_EQUIV`.
    Without this, week-1 rows have no in-season history at all and collapse to
    an identical league-mean value for every team -- the model then learns
    nothing about season openers, yet gets fed real ratings when predicting one.
    """
    tg = team_game.sort_values(["team", "season", "week"]).reset_index(drop=True).copy()
    league = {c: tg[c].mean() for c in ROLL_COLUMNS}

    grouped = tg.groupby(["team", "season"])
    n_prior = grouped.cumcount()  # games this team has already played this season
    for col in ROLL_COLUMNS:
        # transform aligns to tg's own index, which is robust across pandas
        # versions (unlike apply, whose index nesting varies with the data).
        tg[f"{col}_roll"] = grouped[col].transform(
            lambda s: s.expanding(min_periods=min_games).mean().shift(1)
        )

    if not carryover:
        return tg

    # A season's average seeds the FOLLOWING season, so shift the season key up.
    seeds = tg.groupby(["team", "season"], as_index=False)[ROLL_COLUMNS].mean()
    seeds["season"] = seeds["season"] + 1
    seeds = seeds.rename(columns={c: f"__seed_{c}" for c in ROLL_COLUMNS})
    tg = tg.merge(seeds, on=["team", "season"], how="left")

    for col in ROLL_COLUMNS:
        seed = regress_to_mean(tg[f"__seed_{col}"], league[col])
        seed = seed.fillna(league[col])  # no prior season on record (expansion, first year)
        in_season = tg[f"{col}_roll"]
        tg[f"{col}_roll"] = (
            n_prior * in_season.fillna(0.0) + PRIOR_GAMES_EQUIV * seed
        ) / (n_prior + PRIOR_GAMES_EQUIV)

    return tg.drop(columns=[f"__seed_{c}" for c in ROLL_COLUMNS])


def regress_to_mean(values, league_mean: float):
    """Shrink a prior-season rating toward the league average for the offseason."""
    return league_mean + PRIOR_SEASON_CARRYOVER * (values - league_mean)


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


def latest_team_ratings(team_game_roll: pd.DataFrame, new_season: bool = False) -> pd.DataFrame:
    """Each team's rating for pricing an upcoming slate.

    Games not yet played have no ``(season, week)`` row in ``team_game_roll``, so
    an exact join returns nothing. Instead:

    - mid-season (``new_season=False``): take the last available rating per team,
      i.e. their current in-season form entering the games.
    - a season opener (``new_season=True``): the last in-season value is *last
      season's* full-strength form, which no longer applies. Rebuild the same
      regressed seed :func:`build_rolling_features` would use for week 1, so
      training and prediction see ratings on the same scale.
    """
    if not new_season:
        valid = team_game_roll.dropna(subset=ROLL_COLS, how="all")
        return (
            valid.sort_values(["team", "season", "week"])
            .groupby("team")
            .tail(1)[["team", *ROLL_COLS]]
            .reset_index(drop=True)
        )

    league = {c: team_game_roll[c].mean() for c in ROLL_COLUMNS}
    last_season = team_game_roll.groupby("team")["season"].transform("max")
    recent = team_game_roll[team_game_roll["season"] == last_season]
    means = recent.groupby("team", as_index=False)[ROLL_COLUMNS].mean()

    out = pd.DataFrame({"team": means["team"]})
    for col in ROLL_COLUMNS:
        out[f"{col}_roll"] = regress_to_mean(means[col], league[col])
    return out


def build_slate_frame(
    slate_games: pd.DataFrame, team_game_roll: pd.DataFrame, new_season: bool = False
) -> pd.DataFrame:
    """Attach each team's latest rating to an upcoming slate (e.g. from OddsTrader).

    Same feature columns as :func:`build_matchup_frame`, but joined on team
    only (using :func:`latest_team_ratings`) rather than an exact week that does
    not exist yet. Teams the model has never seen fall back to league priors.
    Set ``new_season`` when the slate opens a season the training data has not
    reached, so prior-season form is regressed rather than taken at face value.
    """
    ratings = latest_team_ratings(team_game_roll, new_season=new_season)
    df = slate_games.copy()
    df = df.merge(ratings.add_prefix("home_"), on="home_team", how="left")
    df = df.merge(ratings.add_prefix("away_"), on="away_team", how="left")
    return _add_derived_features(df, _league_means(team_game_roll))


def attach_slate_power(
    slate: pd.DataFrame, games: pd.DataFrame, new_season: bool = False
) -> pd.DataFrame:
    """Add opponent-adjusted ratings to an upcoming slate.

    Upcoming-game feeds don't name a starting quarterback, so each team is
    assumed to field its most recent starter. The assumption is recorded in
    ``home_qb_name``/``away_qb_name`` so it can be eyeballed (and it is printed
    by the CLI) -- an offseason quarterback move is exactly the kind of thing
    this will get wrong.
    """
    from . import power as power_mod

    ratings, team_strength = power_mod.current_ratings(games, new_season=new_season)
    starters = power_mod.last_known_starters(games)
    names = {}
    if "home_qb_id" in games.columns and "home_qb_name" in games.columns:
        for side in ("home", "away"):
            pairs = games[[f"{side}_qb_id", f"{side}_qb_name"]].dropna().values
            names.update({qid: qname for qid, qname in pairs})

    out = slate.copy()
    for side in ("home", "away"):
        teams = out[f"{side}_team"]
        qb_ids = teams.map(starters)
        out[f"{side}_power"] = [
            team_strength.get(t, 0.0) + ratings.qb.get(q, 0.0)
            for t, q in zip(teams, qb_ids)
        ]
        out[f"{side}_qb_name"] = qb_ids.map(names)
    out["power_diff"] = out["home_power"] - out["away_power"]
    return out


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


# Raw form: rolling offensive/defensive output for each side.
FORM_COLUMNS = [
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

# Opponent-adjusted strength (team + starting QB) from ``power.py``.
POWER_COLUMNS = ["home_power", "away_power", "power_diff"]

# Game context the schedules hand us for free.
CONTEXT_COLUMNS = ["neutral", "div_game", "qb_change_diff"]

# The exact feature vector fed to the model, in a fixed order.
FEATURE_COLUMNS = FORM_COLUMNS + POWER_COLUMNS + CONTEXT_COLUMNS


def add_context_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add the schedule-context features, tolerating missing source columns.

    - ``neutral``: no home-field advantage at a neutral site (77 such games since
      2010 were previously being handed a home edge they never had).
    - ``div_game``: divisional matchups play tighter than ratings imply.
    - ``qb_change_diff``: whether each side's starter changed from its last game.
      Positive favours the home team (the *away* side is the disrupted one).
    """
    out = df.copy()
    out["neutral"] = (
        out["location"].astype(str).str.lower().eq("neutral").astype(float)
        if "location" in out.columns else 0.0
    )
    out["div_game"] = (
        pd.to_numeric(out["div_game"], errors="coerce").fillna(0.0).astype(float)
        if "div_game" in out.columns else 0.0
    )

    for side in ("home", "away"):
        col = f"{side}_qb_id"
        if col in out.columns and "season" in out.columns:
            qb = out[col]
            previous = qb.groupby([out[f"{side}_team"], out["season"]]).shift(1)
            out[f"{side}_qb_change"] = ((previous.notna()) & (qb != previous)).astype(float)
        else:
            out[f"{side}_qb_change"] = 0.0
    out["qb_change_diff"] = out["away_qb_change"] - out["home_qb_change"]
    return out


def attach_power_features(df: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    """Merge leakage-safe opponent-adjusted ratings onto a matchup frame."""
    from . import power as power_mod

    ratings = power_mod.build_power_features(games)
    out = df.merge(ratings, on=["season", "week", "home_team", "away_team"], how="left")
    for col in ("home_power", "away_power"):
        out[col] = out[col].fillna(0.0)
    out["power_diff"] = out["home_power"] - out["away_power"]
    return out
