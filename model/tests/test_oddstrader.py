"""Parse OddsTrader's embedded state + currentLines rows without the network.

Fixtures mirror the real shapes captured from oddstrader.com/nfl and the
odds-v2-service GraphQL ``currentLines`` response.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import oddstrader as ot  # noqa: E402


def _event(eid, home_partid, home_abbr, away_partid, away_abbr):
    return {
        "eid": eid, "lid": 16, "dt": 1789086900000, "seid": 42,
        "participants": {
            str(home_partid): {"partid": home_partid, "ih": True,
                               "source": {"abbr": home_abbr, "senam": "2026"}},
            str(away_partid): {"partid": away_partid, "ih": False,
                               "source": {"abbr": away_abbr, "senam": "2026"}},
        },
    }


STATE = {"events": {"events": {
    # Game 1: home LA favored by 3.5
    "100": _event(100, 1550, "LA", 1547, "SF"),
    # Game 2: home NYG a 2.5-point underdog (away DAL favored)
    "200": _event(200, 2, "NYG", 1, "DAL"),
    # Game 3: exercise team normalization (WSH -> WAS)
    "300": _event(300, 5, "WSH", 6, "PHI"),
}}}


def _line(eid, mtid, partid, adj, ap):
    return {"eid": eid, "mtid": mtid, "partid": partid, "adj": adj, "ap": ap}


LINES = [
    # --- Game 1 (LA home -3.5) ---
    _line(100, ot.MTID_SPREAD, 1550, -3.5, -110), _line(100, ot.MTID_SPREAD, 1550, -3.5, -108),  # two books
    _line(100, ot.MTID_SPREAD, 1547, 3.5, -110),
    _line(100, ot.MTID_MONEY, 1550, 0, -185), _line(100, ot.MTID_MONEY, 1547, 0, 161),
    _line(100, ot.MTID_TOTAL, 15143, 48.5, -110), _line(100, ot.MTID_TOTAL, 15144, 48.5, -110),
    # --- Game 2 (NYG home +2.5) ---
    _line(200, ot.MTID_SPREAD, 2, 2.5, -108), _line(200, ot.MTID_SPREAD, 1, -2.5, -112),
    _line(200, ot.MTID_MONEY, 2, 0, 120), _line(200, ot.MTID_MONEY, 1, 0, -144),
    _line(200, ot.MTID_TOTAL, 999, 48.0, -110),
    # --- Game 3 (WSH home -1.5) ---
    _line(300, ot.MTID_SPREAD, 5, -1.5, -110), _line(300, ot.MTID_MONEY, 5, 0, -120),
    _line(300, ot.MTID_MONEY, 6, 0, 100),
]


def test_extract_initial_state():
    html = 'foo<script>window.__INITIAL_STATE__ = {"a":{"b":1},"c":"}"};</script>bar'
    state = ot.extract_initial_state(html)
    assert state == {"a": {"b": 1}, "c": "}"}  # string brace must not break parsing


def test_parse_events_home_away():
    events = ot.parse_events(STATE)
    assert set(events) == {100, 200, 300}
    assert events[100]["home"]["abbr"] == "LA"
    assert events[100]["away"]["abbr"] == "SF"


def test_team_normalization():
    events = ot.parse_events(STATE)
    assert events[300]["home"]["abbr"] == "WAS"  # WSH -> WAS


def _rows_by_home(rows):
    return {r["home_team"]: r for r in rows}


def test_home_favorite_spread_and_moneyline():
    rows = _rows_by_home(ot.parse_current_lines(ot.parse_events(STATE), LINES))
    la = rows["LA"]
    assert la["spread_line"] == 3.5           # home favored -> positive (negate OddsTrader -3.5)
    assert la["home_moneyline"] == -185
    assert la["away_moneyline"] == 161
    assert la["total_line"] == 48.5


def test_home_underdog_spread_sign():
    rows = _rows_by_home(ot.parse_current_lines(ot.parse_events(STATE), LINES))
    nyg = rows["NYG"]
    assert nyg["spread_line"] == -2.5         # home getting points -> negative
    assert nyg["home_moneyline"] == 120       # and priced as an underdog
    assert nyg["total_line"] == 48.0


def test_median_across_books():
    # Game 1 home spread odds: median(-110, -108) == -109.
    rows = _rows_by_home(ot.parse_current_lines(ot.parse_events(STATE), LINES))
    assert rows["LA"]["home_spread_odds"] == -109


def test_schema_matches_espn_rows():
    rows = ot.parse_current_lines(ot.parse_events(STATE), LINES)
    required = {"game_id", "home_team", "away_team", "spread_line", "total_line",
               "home_moneyline", "away_moneyline", "home_spread_odds", "away_spread_odds"}
    assert required.issubset(rows[0].keys())
