"""Quarterback quality from play-level efficiency, leakage-safe per game.

The model already knew *whether* a team changed quarterbacks (a yes/no worth
about 1.4 points) and fit a per-QB term from game margins in ``power.py``. Both
are blind in exactly the case that matters most: a quarterback with no NFL
history. The margin-fit term defaults him to 0.0 -- an AVERAGE starter -- and
the yes/no cannot tell a healthy veteran backup from an undrafted rookie. Week 9
of 2026 is the example: Baltimore starting Joe Fagnano moved the projection by
0.2 points while the market moved about six.

This rates every quarterback by expected points added per play (passes, sacks
and his own runs), from nflverse's per-game player stats, shrunk toward a
**replacement-level** prior rather than toward average:

    rating = (decayed EPA + K * prior) / (decayed plays + K)

so a quarterback with a handful of snaps is rated near what first-time
starters actually produce, and one with thousands of plays is rated on his own
record. Older seasons count for less (``SEASON_DECAY``). Every rating is built
only from games played before the one being priced.

The constants were fixed before any walk-forward scoring and are not tuned on
it: K, the decay and the replacement prior are round values, and the prior is
measured from quarterbacks' own first plays, not fit to margins.
"""
from __future__ import annotations

import os
from typing import Dict, Iterable, Optional, Tuple

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(HERE, "output", "qb_cache")
RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"
# player_stats.csv covers 1999-2024 in the old schema; stats_player_week_YYYY
# covers 2024 onward in the new one.
LEGACY_URL = f"{RELEASE}/player_stats/player_stats.csv"
WEEKLY_URL = f"{RELEASE}/stats_player/stats_player_week_{{season}}.csv"
FIRST_WEEKLY_SEASON = 2024

SHRINK_PLAYS = 250.0       # plays of evidence the prior is worth
SEASON_DECAY = 0.7         # weight of each older season relative to the next
ROOKIE_PLAYS = 150.0       # "first plays" window used to measure the prior


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #
def _read(url: str, name: str, refresh: bool) -> pd.DataFrame:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if refresh or not os.path.exists(path):
        frame = pd.read_csv(url, low_memory=False)
        frame.to_csv(path, index=False)
        return frame
    return pd.read_csv(path, low_memory=False)


def load_qb_games(last_season: int, refresh_current: bool = True) -> pd.DataFrame:
    """One row per quarterback per game: plays and EPA.

    The current season's file is re-downloaded each run (it grows weekly);
    finished seasons come from the cache.
    """
    legacy = _read(LEGACY_URL, "player_stats.csv", refresh=False)
    legacy = legacy[legacy["season"] < FIRST_WEEKLY_SEASON].rename(
        columns={"sacks": "sacks_suffered", "recent_team": "team"})
    parts = [legacy]
    for season in range(FIRST_WEEKLY_SEASON, last_season + 1):
        try:
            parts.append(_read(WEEKLY_URL.format(season=season),
                               f"stats_player_week_{season}.csv",
                               refresh=refresh_current and season == last_season))
        except Exception as exc:  # a missing future season is not an error
            print(f"[qb] no player stats for {season} ({type(exc).__name__}).")
    raw = pd.concat(parts, ignore_index=True, sort=False)
    raw = raw[raw["position"] == "QB"]
    raw = raw[raw["season_type"].isin(["REG", "POST"])]

    num = lambda c: pd.to_numeric(raw.get(c), errors="coerce").fillna(0.0)
    out = pd.DataFrame({
        "player_id": raw["player_id"], "name": raw["player_display_name"],
        "season": raw["season"].astype(int), "week": raw["week"].astype(int),
        "plays": num("attempts") + num("sacks_suffered") + num("carries"),
        "epa": num("passing_epa") + num("rushing_epa"),
    })
    out = out[out["plays"] > 0]
    return out.groupby(["player_id", "season", "week"], as_index=False).agg(
        name=("name", "first"), plays=("plays", "sum"), epa=("epa", "sum"))


def replacement_prior(qb_games: pd.DataFrame) -> float:
    """EPA per play quarterbacks produce in their first ``ROOKIE_PLAYS`` plays.

    Measured, not fit: this is what a quarterback the league has barely seen
    has actually delivered, on average, which is where an unknown should start.
    """
    g = qb_games.sort_values(["player_id", "season", "week"])
    before = g.groupby("player_id")["plays"].cumsum() - g["plays"]
    early = g[before < ROOKIE_PLAYS]
    return float(early["epa"].sum() / max(early["plays"].sum(), 1.0))


# --------------------------------------------------------------------------- #
# Ratings
# --------------------------------------------------------------------------- #
class QbBook:
    """Leakage-safe ratings: ``rating(player, season, week)`` uses only games
    strictly before that week."""

    def __init__(self, qb_games: pd.DataFrame, prior: Optional[float] = None):
        self.prior = replacement_prior(qb_games) if prior is None else float(prior)
        self.names: Dict[str, str] = {}
        # Per player: sorted keys (season*100+week) and the decayed running
        # sums AFTER each game, so a lookup is one binary search.
        self._keys: Dict[str, np.ndarray] = {}
        self._sums: Dict[str, Tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
        for pid, g in qb_games.sort_values(["season", "week"]).groupby("player_id"):
            self.names[pid] = str(g["name"].iloc[-1])
            seasons = g["season"].to_numpy()
            plays, epa = g["plays"].to_numpy(float), g["epa"].to_numpy(float)
            cp, ce = np.empty(len(g)), np.empty(len(g))
            sp = se = 0.0
            last = None
            for i, s in enumerate(seasons):
                if last is not None and s != last:
                    factor = SEASON_DECAY ** (s - last)
                    sp, se = sp * factor, se * factor
                sp, se, last = sp + plays[i], se + epa[i], s
                cp[i], ce[i] = sp, se
            self._keys[pid] = seasons * 100 + g["week"].to_numpy()
            self._sums[pid] = (seasons, cp, ce)

    def evidence(self, pid, season: int, week: int) -> Tuple[float, float]:
        """(decayed plays, decayed EPA) from games before (season, week)."""
        if pid is None or (isinstance(pid, float) and np.isnan(pid)) or pid not in self._keys:
            return 0.0, 0.0
        keys = self._keys[pid]
        i = int(np.searchsorted(keys, season * 100 + week, side="left")) - 1
        if i < 0:
            return 0.0, 0.0
        seasons, cp, ce = self._sums[pid]
        factor = SEASON_DECAY ** max(season - seasons[i], 0)
        return cp[i] * factor, ce[i] * factor

    def rating(self, pid, season: int, week: int) -> float:
        plays, epa = self.evidence(pid, season, week)
        return (epa + SHRINK_PLAYS * self.prior) / (plays + SHRINK_PLAYS)

    def id_for_name(self, name: str) -> Optional[str]:
        target = _norm(name)
        hits = [pid for pid, n in self.names.items() if _norm(n) == target]
        return hits[0] if len(hits) == 1 else None


def _norm(name) -> str:
    import re
    s = re.sub(r"[^a-z ]", "", str(name).lower())
    return " ".join(w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv"})


# --------------------------------------------------------------------------- #
# Features
# --------------------------------------------------------------------------- #
QB_COLUMNS = ["qb_epa_diff", "qb_delta_diff"]


def team_recent_qb(games: pd.DataFrame, book: QbBook, n: int = 4) -> Dict[tuple, float]:
    """Rating of the quarterbacks a team actually used over its last ``n``
    games, keyed by (team, season, week) of the NEXT game.

    The team's form features were earned with these quarterbacks, so the gap
    between today's starter and this is what the form features cannot see.
    """
    rows = []
    for side in ("home", "away"):
        rows.append(games[["season", "week", f"{side}_team", f"{side}_qb_id"]].set_axis(
            ["season", "week", "team", "qb"], axis=1))
    starts = pd.concat(rows).sort_values(["season", "week"])
    out: Dict[tuple, float] = {}
    for team, g in starts.groupby("team"):
        hist = []
        for s, w, qb in zip(g["season"], g["week"], g["qb"]):
            if hist:
                recent = hist[-n:]
                out[(team, s, w)] = float(np.mean([book.rating(q, s, w) for q in recent]))
            if isinstance(qb, str):
                hist.append(qb)
    return out


def add_qb_features(frame: pd.DataFrame, games: pd.DataFrame, book: QbBook,
                    qb_ids: Optional[Dict[str, Iterable]] = None) -> pd.DataFrame:
    """Attach per-side QB ratings and the two difference features.

    - ``qb_epa_diff``: home starter's rating minus away starter's (EPA/play).
    - ``qb_delta_diff``: how much better each starter is than the quarterbacks
      his team used recently, home minus away. Zero for an unchanged starter;
      strongly negative for a team down to its third string.

    ``qb_ids`` overrides the frame's own ``{side}_qb_id`` columns (the live
    slate, where the starter comes from the depth chart and overrides).
    """
    out = frame.copy()
    recent = team_recent_qb(games, book)
    for side in ("home", "away"):
        ids = (list(qb_ids[side]) if qb_ids and side in qb_ids
               else list(out.get(f"{side}_qb_id", [None] * len(out))))
        r = [book.rating(q, s, w) for q, s, w in zip(ids, out["season"], out["week"])]
        base = [recent.get((t, s, w), rr)
                for t, s, w, rr in zip(out[f"{side}_team"], out["season"], out["week"], r)]
        out[f"{side}_qb_rating"] = r
        out[f"{side}_qb_delta"] = np.array(r) - np.array(base)
    out["qb_epa_diff"] = out["home_qb_rating"] - out["away_qb_rating"]
    out["qb_delta_diff"] = out["home_qb_delta"] - out["away_qb_delta"]
    return out
