"""Grading arithmetic for the live pick ledger."""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from scripts import track  # noqa: E402
from scripts.track import _grade_one  # noqa: E402


def _pick(market, side, odds=-110, line=3.0):
    return pd.Series({"market": market, "side": side, "book_odds": odds, "spread_line": line})


def test_home_spread_wins_when_margin_beats_the_line():
    # Home laying 3 wins by 7 -> covers.
    assert _grade_one(_pick("spread", "home"), 7.0) == pytest.approx(100 / 110)


def test_home_spread_loses_inside_the_number():
    assert _grade_one(_pick("spread", "home"), 1.0) == -1.0


def test_away_spread_is_the_mirror():
    # Same game from the other side: away +3 with home winning by 1 -> covers.
    assert _grade_one(_pick("spread", "away"), 1.0) == pytest.approx(100 / 110)


def test_exact_number_is_a_push():
    assert _grade_one(_pick("spread", "home"), 3.0) == 0.0
    assert _grade_one(_pick("spread", "away"), 3.0) == 0.0


def test_moneyline_pays_the_price():
    assert _grade_one(_pick("moneyline", "away", odds=160), -6.0) == pytest.approx(1.6)
    assert _grade_one(_pick("moneyline", "away", odds=160), 6.0) == -1.0


def test_moneyline_tie_is_a_push():
    assert _grade_one(_pick("moneyline", "home", odds=-120), 0.0) == 0.0


def test_spread_without_a_line_cannot_be_settled():
    assert _grade_one(_pick("spread", "home", line=float("nan")), 7.0) is None


def test_settle_writes_a_label_into_a_fresh_ledger():
    # Regression: a ledger with no settled rows starts with float columns, and
    # writing the string "push" into one used to raise.
    from scripts.track import COLUMNS, _settle
    ledger = pd.DataFrame([{c: None for c in COLUMNS}])
    ledger["result"] = ledger["result"].astype(object)
    for profit, expected in ((0.0, "push"), (0.91, "win"), (-1.0, "loss")):
        _settle(ledger, 0, 24.0, 17.0, profit)
        assert ledger.loc[0, "result"] == expected
        assert ledger.loc[0, "home_score"] == 24.0
        assert ledger.loc[0, "profit"] == profit


# --------------------------------------------------------------------------- #
# Closing-line value
# --------------------------------------------------------------------------- #
_SCHED_CLV = pd.DataFrame([
    # played: the line closed
    {"season": 2026, "home_team": "LAC", "away_team": "ARI",
     "spread_line": 8.5, "home_score": 26.0, "away_score": 14.0},
    {"season": 2026, "home_team": "NYG", "away_team": "DAL",
     "spread_line": -3.0, "home_score": 28.0, "away_score": 20.0},
    # scheduled: spread_line here is the CURRENT number, not a close
    {"season": 2026, "home_team": "CHI", "away_team": "MIN",
     "spread_line": 6.5, "home_score": None, "away_score": None},
])

_PICKS_CLV = pd.DataFrame([
    # took ARI +9.5, closed at 8.5 -> a full point better than the close
    {"season": 2026, "home": "LAC", "away": "ARI", "market": "spread",
     "side": "away", "spread_line": 9.5},
    # took NYG +3 (home), closed at -3.0 -> flat
    {"season": 2026, "home": "NYG", "away": "DAL", "market": "spread",
     "side": "home", "spread_line": -3.0},
    # took MIN +5.5 on a game that has not been played
    {"season": 2026, "home": "CHI", "away": "MIN", "market": "spread",
     "side": "away", "spread_line": 5.5},
])


def test_clv_only_counts_games_whose_line_actually_closed(monkeypatch, capsys):
    monkeypatch.setattr(track.pd, "read_csv", lambda *a, **k: _SCHED_CLV.copy())
    track._clv_report(_PICKS_CLV.copy())
    out = capsys.readouterr().out
    # The unplayed CHI/MIN game must not be scored against its live number.
    assert "2 spread pick(s)" in out
    assert "+0.50 pts" in out          # (+1.0 and 0.0) / 2


def test_clv_reports_nothing_when_no_game_has_closed(monkeypatch, capsys):
    unplayed = _SCHED_CLV[_SCHED_CLV["home_score"].isna()].copy()
    monkeypatch.setattr(track.pd, "read_csv", lambda *a, **k: unplayed)
    track._clv_report(_PICKS_CLV.copy())
    assert "no picks on a game that has closed yet" in capsys.readouterr().out


def test_clv_sign_is_taken_from_the_bettor_side(monkeypatch, capsys):
    # Home side laying points: the line closing HIGHER than we took it is good.
    picks = pd.DataFrame([{"season": 2026, "home": "LAC", "away": "ARI",
                           "market": "spread", "side": "home", "spread_line": 7.5}])
    monkeypatch.setattr(track.pd, "read_csv", lambda *a, **k: _SCHED_CLV.copy())
    track._clv_report(picks)
    assert "+1.00 pts" in capsys.readouterr().out   # took -7.5, closed -8.5
