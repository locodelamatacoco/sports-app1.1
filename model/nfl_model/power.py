"""Opponent-adjusted team ratings (a ridge power rating).

Rolling point margins have a blind spot: a team that scored well against three
bad defenses looks identical to one that did it against three good ones. Strength
of schedule is the single biggest confounder in the raw ratings, so this module
replaces "how many points did they score" with "how good are they, given who they
played".

Every game contributes one equation::

    rating(home) - rating(away) + HFA = final margin

Solving that system for all teams at once is exactly an opponent adjustment --
each team's rating is only as good as the opponents it is measured against. The
system is ridge-regularized because early in a season it is badly under-determined
(a 1-0 team has one equation), and the penalty pulls thin evidence toward average
instead of letting it explode. Home-field advantage is fit as its own term and is
left unpenalized; neutral-site games simply don't get it.

Ratings are built strictly leakage-safe: the rating a team carries into week N is
fit only on games played before week N, blended with a regressed prior-season
rating exactly like the rolling features in ``features.py``.
"""
from __future__ import annotations

from typing import Dict, List, NamedTuple, Optional, Tuple

import numpy as np
import pandas as pd

# L2 penalty on team ratings. Tuned against out-of-sample CV; the surface is
# flat, so this is a round value from the middle of the good region.
POWER_ALPHA = 8.0

# Quarterback play is the largest single swing factor in an NFL game, and the
# schedules name the starter for every game, so QBs get their own rating in the
# same system: (team + QB) home - (team + QB) away + HFA = margin. There are far
# more QBs than teams and most have few starts, so their ratings are shrunk much
# harder. Swept out-of-sample; 20 was the clear optimum.
QB_ALPHA = 20.0

# Fraction of last season's rating that survives the offseason, and how many
# in-season games it is worth. Mirrors features.PRIOR_SEASON_CARRYOVER.
POWER_CARRYOVER = 0.55
POWER_GAMES_EQUIV = 6.0

# Below this many games we don't even try to fit; the seed carries the rating.
MIN_GAMES_TO_FIT = 8


class Ratings(NamedTuple):
    """Fitted ratings: points better than average, plus home-field advantage."""

    team: Dict[str, float]
    qb: Dict[str, float]
    hfa: float

    def strength(self, team: str, qb: Optional[str] = None) -> float:
        """Combined strength of a team fielding a given starting quarterback."""
        return self.team.get(team, 0.0) + (self.qb.get(qb, 0.0) if qb else 0.0)


def fit_power_ratings(
    games: pd.DataFrame,
    alpha: float = POWER_ALPHA,
    qb_alpha: float = QB_ALPHA,
    use_qb: bool = True,
) -> Ratings:
    """Solve the ridge system for team ratings, QB ratings, and home-field edge.

    ``games`` needs ``home_team``, ``away_team``, ``home_margin``; optionally
    ``location`` ('Neutral' suppresses the home-field term) and
    ``home_qb_id``/``away_qb_id``. Ratings are centered on zero, so a rating is
    "points better than an average team".
    """
    if games.empty:
        return Ratings({}, {}, 0.0)

    teams = sorted(set(games["home_team"]) | set(games["away_team"]))
    t_index = {t: i for i, t in enumerate(teams)}
    n_teams = len(teams)

    has_qb = use_qb and {"home_qb_id", "away_qb_id"}.issubset(games.columns)
    if has_qb:
        qbs = sorted(set(games["home_qb_id"].dropna()) | set(games["away_qb_id"].dropna()))
    else:
        qbs = []
    q_index = {q: i for i, q in enumerate(qbs)}
    n_qbs = len(qbs)

    # One row per game; last column is the home-field term.
    width = n_teams + n_qbs + 1
    X = np.zeros((len(games), width))
    y = games["home_margin"].to_numpy(dtype=float)
    neutral = (
        games["location"].astype(str).str.lower().eq("neutral").to_numpy()
        if "location" in games.columns
        else np.zeros(len(games), dtype=bool)
    )
    home_qbs = games["home_qb_id"] if has_qb else [None] * len(games)
    away_qbs = games["away_qb_id"] if has_qb else [None] * len(games)

    for row, (home, away, hq, aq) in enumerate(
        zip(games["home_team"], games["away_team"], home_qbs, away_qbs)
    ):
        X[row, t_index[home]] = 1.0
        X[row, t_index[away]] = -1.0
        if has_qb:
            if hq in q_index:
                X[row, n_teams + q_index[hq]] = 1.0
            if aq in q_index:
                X[row, n_teams + q_index[aq]] = -1.0
        X[row, width - 1] = 0.0 if neutral[row] else 1.0

    # Ridge normal equations. Teams and QBs get separate penalties (QBs are many
    # and thinly observed, so they shrink harder); HFA is a real quantity we want
    # estimated, so it is left unpenalized.
    penalty = np.eye(width) * alpha
    if n_qbs:
        penalty[n_teams:n_teams + n_qbs, n_teams:n_teams + n_qbs] = np.eye(n_qbs) * qb_alpha
    penalty[width - 1, width - 1] = 0.0

    # Team ratings are only identified up to a constant, so pin their mean to zero.
    center = np.zeros((1, width))
    center[0, :n_teams] = 1.0
    X_aug = np.vstack([X, center])
    y_aug = np.concatenate([y, [0.0]])

    try:
        weights = np.linalg.solve(X_aug.T @ X_aug + penalty, X_aug.T @ y_aug)
    except np.linalg.LinAlgError:
        weights, *_ = np.linalg.lstsq(X_aug.T @ X_aug + penalty, X_aug.T @ y_aug, rcond=None)

    team_r = {t: float(weights[i]) for t, i in t_index.items()}
    mean = float(np.mean(list(team_r.values()))) if team_r else 0.0
    team_r = {t: r - mean for t, r in team_r.items()}
    qb_r = {q: float(weights[n_teams + i]) for q, i in q_index.items()}
    return Ratings(team_r, qb_r, float(weights[width - 1]))


def _blend(in_season: float, n_games: int, seed: float) -> float:
    """Weight a freshly-fit rating against the prior-season seed by sample size."""
    return (n_games * in_season + POWER_GAMES_EQUIV * seed) / (n_games + POWER_GAMES_EQUIV)


def build_power_features(games: pd.DataFrame, use_qb: bool = True) -> pd.DataFrame:
    """Per-game opponent-adjusted strength for both sides -- leakage-safe.

    Returns ``season``, ``week``, ``home_team``, ``away_team``, ``home_power``,
    ``away_power``. For week W of season S the ratings are fit only on season-S
    games before week W, blended with season S-1's final ratings (regressed for
    the offseason). Each side's value is team rating + that game's starting-QB
    rating, so a backup starting shows up directly in the number.

    Ratings are fit cumulatively across seasons (so QBs accumulate evidence over
    their careers) while the team component is blended toward the current season.
    """
    played = games.dropna(subset=["home_margin"]).copy()
    rows: List[dict] = []
    seed: Dict[str, float] = {}  # prior season's team ratings, already regressed
    career: Ratings = Ratings({}, {}, 0.0)  # everything before the current season

    for season in sorted(played["season"].unique()):
        season_games = played[played["season"] == season]
        history = played[played["season"] < season]
        if len(history) >= MIN_GAMES_TO_FIT:
            career = fit_power_ratings(history, use_qb=use_qb)

        for week in sorted(season_games["week"].unique()):
            past = season_games[season_games["week"] < week]
            in_season = (
                fit_power_ratings(past, use_qb=use_qb)
                if len(past) >= MIN_GAMES_TO_FIT else Ratings({}, {}, 0.0)
            )
            counts = (
                pd.concat([past["home_team"], past["away_team"]]).value_counts().to_dict()
                if not past.empty else {}
            )

            for _, g in season_games[season_games["week"] == week].iterrows():
                row = {"season": season, "week": week,
                       "home_team": g["home_team"], "away_team": g["away_team"]}
                for side in ("home", "away"):
                    team = g[f"{side}_team"]
                    qb = g.get(f"{side}_qb_id")
                    # Team strength: this season's evidence, backed by last season's seed.
                    team_r = _blend(
                        in_season.team.get(team, 0.0), counts.get(team, 0), seed.get(team, 0.0)
                    )
                    # QB rating leans on the full career fit -- a starter's value
                    # is not re-learned from scratch every September.
                    qb_r = career.qb.get(qb, in_season.qb.get(qb, 0.0)) if qb is not None else 0.0
                    row[f"{side}_power"] = team_r + qb_r
                rows.append(row)

        final = fit_power_ratings(season_games, use_qb=use_qb)
        seed = {t: POWER_CARRYOVER * r for t, r in final.team.items()}

    return pd.DataFrame(rows)


def current_ratings(games: pd.DataFrame, new_season: bool = False) -> Tuple[Ratings, Dict[str, float]]:
    """Ratings for pricing an upcoming slate.

    Returns the fitted :class:`Ratings` (for QB lookups) and a team-strength map.
    ``new_season=True`` applies the offseason regression, matching what a week-1
    row gets in :func:`build_power_features`.
    """
    played = games.dropna(subset=["home_margin"])
    if played.empty:
        return Ratings({}, {}, 0.0), {}

    career = fit_power_ratings(played)  # QB ratings over all available history
    last_season = played["season"].max()
    season_games = played[played["season"] == last_season]
    final = fit_power_ratings(season_games)

    if new_season:
        return career, {t: POWER_CARRYOVER * r for t, r in final.team.items()}

    prior = played[played["season"] == last_season - 1]
    seed = {}
    if not prior.empty:
        seed = {t: POWER_CARRYOVER * r for t, r in fit_power_ratings(prior).team.items()}
    counts = (
        pd.concat([season_games["home_team"], season_games["away_team"]]).value_counts().to_dict()
    )
    return career, {
        t: _blend(r, counts.get(t, 0), seed.get(t, 0.0)) for t, r in final.team.items()
    }


def last_known_starters(games: pd.DataFrame) -> Dict[str, str]:
    """Each team's likely starting QB -- the default assumption for a slate.

    Upcoming-game feeds don't name a starter, so a future slate has to assume
    one. Taking the *most recent* starter is a trap: week 18 is often a
    meaningless game rested by the real starter, which would have us pricing
    Kansas City with a third-stringer. So this takes each team's **primary**
    starter -- the quarterback with the most starts in the latest season they
    played -- which is far more often the one who actually opens the next season.

    It still misses offseason moves (trades, the draft, free agency), so the CLI
    prints the assumption for every game and it should be eyeballed.
    """
    played = games.dropna(subset=["home_margin"])
    if played.empty or "home_qb_id" not in played.columns:
        return {}

    # One row per (team, qb) start.
    starts = pd.concat([
        played[["season", "home_team", "home_qb_id"]].rename(
            columns={"home_team": "team", "home_qb_id": "qb"}),
        played[["season", "away_team", "away_qb_id"]].rename(
            columns={"away_team": "team", "away_qb_id": "qb"}),
    ]).dropna(subset=["qb"])
    if starts.empty:
        return {}

    # Only the latest season each team appears in, then the most-used starter.
    latest = starts.groupby("team")["season"].transform("max")
    recent = starts[starts["season"] == latest]
    counts = recent.groupby(["team", "qb"]).size().reset_index(name="starts")
    best = counts.sort_values(["team", "starts"]).groupby("team").tail(1)
    return dict(zip(best["team"], best["qb"]))
