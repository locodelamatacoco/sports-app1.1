"""Data loading: real nflverse data, with a synthetic fallback.

``load_dataset`` tries ``nfl_data_py`` first (real play-by-play + schedules,
including the historical betting lines you train against and benchmark on). If
the package is missing or the download fails -- e.g. a sandbox with no network
-- it falls back to a synthetic season generator so the full pipeline still
runs end-to-end and produces correctly-shaped output.

The synthetic market is deliberately *efficient*: book lines are set from each
team's true latent strength plus tiny noise, while the model only ever sees
noisy rolling box-score proxies. That reproduces the real lesson -- edges are
small and hard-won, not free money.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd

from . import distribution as dist
from . import odds as odds_math


@dataclass
class Dataset:
    """A team-game table (for features) and a games table (targets + lines)."""

    team_game: pd.DataFrame
    games: pd.DataFrame
    source: str  # "nfl_data_py" | "synthetic"


# --------------------------------------------------------------------------- #
# Real data
# --------------------------------------------------------------------------- #
def load_real_data(seasons: List[int]) -> Dataset:
    """Pull play-by-play and schedules from nfl_data_py for ``seasons``."""
    import nfl_data_py as nfl  # imported lazily so the sandbox path needs no install

    pbp = nfl.import_pbp_data(seasons, downcast=True)
    schedules = nfl.import_schedules(seasons)

    from .features import aggregate_team_games

    team_game = aggregate_team_games(pbp)

    line_cols = [
        "game_id", "season", "week", "gameday", "home_team", "away_team",
        "home_score", "away_score", "spread_line", "total_line",
        "home_moneyline", "away_moneyline", "home_spread_odds", "away_spread_odds",
        "home_rest", "away_rest",
    ]
    present = [c for c in line_cols if c in schedules.columns]
    games = schedules[present].copy()
    return Dataset(team_game=team_game, games=games, source="nfl_data_py")


# --------------------------------------------------------------------------- #
# Synthetic data (offline fallback / demo)
# --------------------------------------------------------------------------- #
NFL_TEAMS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
    "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE",
    "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]

HOME_FIELD_PTS = 2.0
EPA_TO_POINTS = 60.0  # scales a team's net EPA/play into a points-per-game edge
GAME_NOISE_SD = 13.0  # irreducible game-to-game margin noise


def _synthetic_season(season: int, rng: np.random.Generator) -> Tuple[pd.DataFrame, pd.DataFrame]:
    n = len(NFL_TEAMS)
    # Latent, unobserved "true" team quality for the season.
    off_true = rng.normal(0.0, 0.09, n)
    def_true = rng.normal(0.0, 0.09, n)  # negative = stronger defense (allows less)
    power = (off_true - def_true) * EPA_TO_POINTS  # points-per-game strength

    team_game_rows, game_rows = [], []
    weeks = 17
    for week in range(1, weeks + 1):
        order = rng.permutation(n)
        for i in range(0, n - 1, 2):
            h, a = int(order[i]), int(order[i + 1])
            game_id = f"{season}_{week:02d}_{NFL_TEAMS[a]}_{NFL_TEAMS[h]}"

            # Noisy box-score observations the model is allowed to see.
            for t, is_home in ((h, True), (a, False)):
                team_game_rows.append({
                    "season": season, "week": week, "game_id": game_id,
                    "team": NFL_TEAMS[t],
                    "off_epa": off_true[t] + rng.normal(0, 0.12),
                    "def_epa": def_true[t] + rng.normal(0, 0.12),
                    "off_ypp": 5.4 + off_true[t] * 12 + rng.normal(0, 0.8),
                    "def_ypp": 5.4 + def_true[t] * 12 + rng.normal(0, 0.8),
                    "off_plays": int(rng.normal(63, 6)),
                })

            true_margin = power[h] - power[a] + HOME_FIELD_PTS
            actual_margin = true_margin + rng.normal(0, GAME_NOISE_SD)
            home_score = max(0, int(round(21 + actual_margin / 2)))
            away_score = max(0, int(round(21 - actual_margin / 2)))

            # Efficient book: knows true strength up to tiny noise.
            spread_line = round((true_margin + rng.normal(0, 0.4)) * 2) / 2
            home_win_p = dist.home_win_prob(spread_line, dist.DEFAULT_MARGIN_SD)
            game_rows.append({
                "game_id": game_id, "season": season, "week": week,
                "gameday": f"{season}-09-{(week % 28) + 1:02d}",
                "home_team": NFL_TEAMS[h], "away_team": NFL_TEAMS[a],
                "home_score": home_score, "away_score": away_score,
                "spread_line": spread_line,
                "total_line": round((44 + rng.normal(0, 3)) * 2) / 2,
                "home_moneyline": _vigged_moneyline(home_win_p),
                "away_moneyline": _vigged_moneyline(1 - home_win_p),
                "home_spread_odds": -110, "away_spread_odds": -110,
                "home_rest": 7, "away_rest": 7,
            })

    return pd.DataFrame(team_game_rows), pd.DataFrame(game_rows)


def _vigged_moneyline(prob: float, vig: float = 0.045) -> int:
    """Convert a true win prob into a book moneyline carrying ~4.5% vig."""
    return odds_math.prob_to_american(min(0.985, prob + vig))


def make_synthetic(seasons: List[int], seed: int = 7) -> Dataset:
    rng = np.random.default_rng(seed)
    tg_parts, g_parts = [], []
    for s in seasons:
        tg, g = _synthetic_season(s, rng)
        tg_parts.append(tg)
        g_parts.append(g)
    return Dataset(
        team_game=pd.concat(tg_parts, ignore_index=True),
        games=pd.concat(g_parts, ignore_index=True),
        source="synthetic",
    )


def load_dataset(seasons: List[int], synthetic: bool = False, seed: int = 7) -> Dataset:
    """Load real data, falling back to synthetic on any failure (or if forced)."""
    if synthetic:
        return make_synthetic(seasons, seed=seed)
    try:
        return load_real_data(seasons)
    except Exception as exc:  # ImportError, network error, schema drift, ...
        print(f"[data] real load failed ({type(exc).__name__}: {exc}); using synthetic data.")
        return make_synthetic(seasons, seed=seed)
