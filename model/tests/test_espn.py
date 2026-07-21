"""Parse ESPN scoreboard odds without hitting the network.

The fixture mirrors the shape of ``site.api.espn.com/.../nfl/scoreboard`` --
the same endpoint the React ScoresPage uses and that powers espn.com/nfl/odds.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import espn  # noqa: E402


def _event(event_id, season, week, home, away, details, ou, home_ml, away_ml,
           home_fav, away_fav, state="pre"):
    return {
        "id": event_id,
        "season": {"year": season},
        "week": {"number": week},
        "date": f"{season}-10-06T17:00Z",
        "competitions": [{
            "status": {"type": {"state": state}},
            "competitors": [
                {"homeAway": "home", "team": {"abbreviation": home}, "score": "0"},
                {"homeAway": "away", "team": {"abbreviation": away}, "score": "0"},
            ],
            "odds": [{
                "provider": {"name": "ESPN BET", "priority": 1},
                "details": details,
                "overUnder": ou,
                "spread": -abs(float(details.split()[-1])) if details not in ("EVEN",) else 0,
                "homeTeamOdds": {"moneyLine": home_ml, "spreadOdds": -110, "favorite": home_fav},
                "awayTeamOdds": {"moneyLine": away_ml, "spreadOdds": -110, "favorite": away_fav},
            }],
        }],
    }


FIXTURE = {
    "events": [
        # Home favorite: KC -3.5 -> spread_line +3.5
        _event("401", 2024, 5, "KC", "NO", "KC -3.5", 44.5, -180, 150, True, False),
        # Away favorite: GB -6.5 at CHI -> spread_line -6.5
        _event("402", 2024, 5, "CHI", "GB", "GB -6.5", 41.5, 240, -290, False, True),
        # Washington abbreviation WSH must normalize to WAS
        _event("403", 2024, 5, "WSH", "DAL", "WSH -1.5", 47.5, -120, 100, True, False),
    ]
}


def test_parses_all_games():
    rows = espn.parse_espn_scoreboard(FIXTURE)
    assert len(rows) == 3


def test_home_favorite_spread_sign():
    kc = espn.parse_espn_scoreboard(FIXTURE)[0]
    assert kc["home_team"] == "KC" and kc["away_team"] == "NO"
    assert kc["spread_line"] == 3.5  # home favored -> positive
    assert kc["home_moneyline"] == -180
    assert kc["away_moneyline"] == 150
    assert kc["total_line"] == 44.5


def test_away_favorite_spread_sign():
    chi = espn.parse_espn_scoreboard(FIXTURE)[1]
    assert chi["spread_line"] == -6.5  # away (GB) favored -> negative for home
    assert chi["away_moneyline"] == -290


def test_team_abbreviation_normalized():
    was = espn.parse_espn_scoreboard(FIXTURE)[2]
    assert was["home_team"] == "WAS"  # WSH -> WAS


def test_upcoming_games_have_no_score():
    for row in espn.parse_espn_scoreboard(FIXTURE):
        assert row["home_score"] is None and row["away_score"] is None


def test_pickem_is_zero():
    payload = {"events": [_event("404", 2024, 5, "SF", "SEA", "EVEN", 45.5, -110, -110, False, False)]}
    row = espn.parse_espn_scoreboard(payload)[0]
    assert row["spread_line"] == 0.0


def test_provider_preference():
    payload = {"events": [{
        "id": "405", "season": {"year": 2024}, "week": {"number": 5},
        "competitions": [{
            "status": {"type": {"state": "pre"}},
            "competitors": [
                {"homeAway": "home", "team": {"abbreviation": "BUF"}},
                {"homeAway": "away", "team": {"abbreviation": "NYJ"}},
            ],
            "odds": [
                {"provider": {"name": "ESPN BET", "priority": 1}, "details": "BUF -7.5",
                 "overUnder": 43.5, "homeTeamOdds": {"moneyLine": -360}, "awayTeamOdds": {"moneyLine": 280}},
                {"provider": {"name": "DraftKings", "priority": 2}, "details": "BUF -7",
                 "overUnder": 43.0, "homeTeamOdds": {"moneyLine": -350}, "awayTeamOdds": {"moneyLine": 270}},
            ],
        }],
    }]}
    dk = espn.parse_espn_scoreboard(payload, prefer_provider="DraftKings")[0]
    assert dk["provider"] == "DraftKings"
    assert dk["spread_line"] == 7.0
