"""Head-to-head history between two teams, for context on the sim board.

Shown, not modelled. Tested over 4,824 games (2006-2026) with at least two
prior meetings: the average margin of the last four meetings moves the result
against the closing line by +0.04 points per point (95% CI -0.005 to +0.081),
and backing the side with a strong head-to-head cover record (average 7+ points
against the number) covered 50.1% of 1,496 decided games. The market already
prices whatever head-to-head history knows, so it stays out of the projection
and is shown only so every game's picture is complete.
"""
from __future__ import annotations

from typing import List, Optional

import pandas as pd


def meetings(schedule: pd.DataFrame, team_a: str, team_b: str,
             before: Optional[str] = None, n: int = 5) -> List[dict]:
    """The last ``n`` completed meetings of two teams, newest first.

    ``schedule`` is the nflverse games table (``result`` = home margin,
    ``spread_line`` positive = home favoured). ``before`` is an ISO date; only
    games played before it count.
    """
    s = schedule
    pair = (((s.home_team == team_a) & (s.away_team == team_b))
            | ((s.home_team == team_b) & (s.away_team == team_a)))
    done = s[pair & s.home_score.notna() & s.away_score.notna()]
    if before:
        done = done[done.gameday.astype(str) < str(before)[:10]]
    done = done.sort_values("gameday", ascending=False).head(n)

    out = []
    for r in done.itertuples():
        hs, as_ = int(r.home_score), int(r.away_score)
        margin = hs - as_
        winner = r.home_team if margin > 0 else r.away_team if margin < 0 else None
        line = None if pd.isna(r.spread_line) else float(r.spread_line)
        if line is None:
            covered = None
        elif margin - line > 0:
            covered = r.home_team
        elif margin - line < 0:
            covered = r.away_team
        else:
            covered = "push"
        out.append({"season": int(r.season), "week": int(r.week), "date": str(r.gameday)[:10],
                    "home": r.home_team, "away": r.away_team,
                    "homeScore": hs, "awayScore": as_, "winner": winner,
                    "line": line, "covered": covered})
    return out


def summary(games: List[dict], team: str) -> dict:
    """Straight-up and against-the-spread record for ``team`` over ``games``."""
    su = [g["winner"] for g in games]
    ats = [g["covered"] for g in games if g["covered"] not in (None, "push")]
    return {"n": len(games),
            "wins": sum(w == team for w in su),
            "losses": sum(w is not None and w != team for w in su),
            "atsWins": sum(c == team for c in ats),
            "atsLosses": sum(c != team for c in ats)}


def load_schedule() -> pd.DataFrame:
    from . import data
    return pd.read_csv(data.SCHEDULES_URL)
