"""Data loading: real nflverse schedules, with a synthetic fallback.

``load_dataset`` reads real nflverse *schedules* -- game scores plus historical
closing lines -- from a plain-file host, and builds a points-margin team rating
from them (see ``load_schedule_data``). If the download fails -- e.g. no network
-- it falls back to a synthetic season generator so the full pipeline still runs
end-to-end and produces correctly-shaped output.

(A richer play-by-play / EPA source was dropped: its data lives only on a host
this project can't reach. Schedules give real scores + real lines, which is
enough for a scores-margin model.)

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
    source: str  # "nflverse-schedules (points proxy)" | "synthetic"


# --------------------------------------------------------------------------- #
# Schedules-only real data (no play-by-play / EPA)
# --------------------------------------------------------------------------- #
# nflverse schedules (scores + historical closing lines) live on a plain-file
# host, unlike the play-by-play parquet which is a GitHub release asset. When
# the release host is unreachable (some sandboxes block it) this is the way to
# still train on REAL data -- at the cost of using points as the efficiency
# proxy instead of EPA.
SCHEDULES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"


def _schedules_to_team_game(sched: pd.DataFrame) -> pd.DataFrame:
    """Build the team-game table from completed games, using POINTS as the proxy.

    Without play-by-play there is no EPA, so each team-game's "efficiency"
    columns are filled with points scored (offense) and points allowed
    (defense). Rolled forward, these become a legitimate scores-margin power
    rating -- cruder than EPA, but real. The column names stay ``off_epa`` etc.
    so the downstream feature/model code is unchanged.
    """
    played = sched.dropna(subset=["home_score", "away_score"]).copy()
    gid = (
        played["game_id"] if "game_id" in played.columns
        else played["season"].astype(str) + "_" + played["week"].astype(str)
        + "_" + played["away_team"] + "_" + played["home_team"]
    )
    base = {"season": played["season"], "week": played["week"], "game_id": gid}
    home = pd.DataFrame({**base, "team": played["home_team"],
                         "off_epa": played["home_score"], "def_epa": played["away_score"],
                         "off_ypp": played["home_score"], "def_ypp": played["away_score"]})
    away = pd.DataFrame({**base, "team": played["away_team"],
                         "off_epa": played["away_score"], "def_epa": played["home_score"],
                         "off_ypp": played["away_score"], "def_ypp": played["home_score"]})
    return pd.concat([home, away], ignore_index=True)


def load_schedule_data(seasons: List[int]) -> Dataset:
    """Load REAL schedules (scores + closing lines) and a points-margin team table."""
    sched = pd.read_csv(SCHEDULES_URL)
    sched = sched[sched["season"].isin(seasons)].copy()
    if sched.empty:
        raise ValueError(f"No nflverse schedule rows for seasons {seasons}.")

    team_game = _schedules_to_team_game(sched)

    line_cols = [
        "game_id", "season", "week", "gameday", "home_team", "away_team",
        "home_score", "away_score", "spread_line", "total_line",
        "home_moneyline", "away_moneyline", "home_spread_odds", "away_spread_odds",
        "home_rest", "away_rest",
        # Context the model uses: neutral sites, divisional games, and the
        # starting quarterbacks (who get their own ratings in power.py).
        "location", "div_game", "roof",
        "home_qb_id", "away_qb_id", "home_qb_name", "away_qb_name",
    ]
    present = [c for c in line_cols if c in sched.columns]
    games = sched[present].copy()
    games["home_margin"] = games["home_score"] - games["away_score"]
    return Dataset(team_game=team_game, games=games, source="nflverse-schedules (points proxy)")


# --------------------------------------------------------------------------- #
# Synthetic data (offline fallback / demo)
# --------------------------------------------------------------------------- #
# nflverse abbreviations (match the schedules data and the OddsTrader
# normalizer), so a scraped slate joins cleanly even in the synthetic demo.
NFL_TEAMS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
    "GB", "HOU", "IND", "JAX", "KC", "LAC", "LA", "LV", "MIA", "MIN", "NE",
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
    """Load real schedule data, falling back to synthetic on failure (or if forced)."""
    if synthetic:
        return make_synthetic(seasons, seed=seed)
    try:
        return load_schedule_data(seasons)
    except Exception as exc:  # network error, schema drift, ...
        print(f"[data] real load failed ({type(exc).__name__}: {exc}); using synthetic data.")
        return make_synthetic(seasons, seed=seed)
