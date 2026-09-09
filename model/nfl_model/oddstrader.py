"""Grab NFL moneylines & spreads from OddsTrader.

OddsTrader has no public API, so this targets the same backend its own site
uses. Two pieces, both reverse-engineered from oddstrader.com/nfl:

1. The NFL page server-renders the game list into ``window.__INITIAL_STATE__``
   (teams, home/away, kickoff) but NOT the prices.
2. The prices come from a GraphQL "odds-v2-service" the page then calls. We hit
   the same endpoint for ``currentLines`` across all books and take the consensus
   (median) line per game.

Everything is normalized into the nflverse-style schema the model prices:

    spread_line   -- positive = HOME favored by that many points
    home_moneyline / away_moneyline
    home_spread_odds / away_spread_odds

Caveat: this is an undocumented private API. Field names, market-type IDs, the
category id, and the ``__INITIAL_STATE__`` shape can change without notice, and
scraping may be against the site's terms -- treat it as best-effort and be
gentle (cache, low request rates).
"""
from __future__ import annotations

import json
import statistics
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List, Optional

import pandas as pd

from . import odds as odds_math

NFL_PAGE_URL = "https://www.oddstrader.com/nfl/"
ODDS_V2_URL = "https://ms.virginia.us-east-1.oddstrader.com/odds-v2/odds-v2-service"

NFL_LID = 16          # OddsTrader league id for the NFL
DEFAULT_CATID = 506   # sportsbook "category" the public site reads

# Market-type ids for NFL full-game markets (from the site's market config).
MTID_MONEY = 83
MTID_SPREAD = 401
MTID_TOTAL = 402

# OddsTrader abbreviations that differ from nflverse's (most already match).
ODDSTRADER_TO_NFLVERSE = {
    "WSH": "WAS",
    "JAC": "JAX",
    "LAR": "LA",
}


def normalize_team(abbr: Optional[str]) -> Optional[str]:
    if abbr is None:
        return None
    a = abbr.upper()
    return ODDSTRADER_TO_NFLVERSE.get(a, a)


def _median(values: List[float]) -> Optional[float]:
    """Plain median -- for continuous quantities (point spreads, totals)."""
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


def _median_american(prices: List[float]) -> Optional[int]:
    """Consensus of American prices, computed in PROBABILITY space.

    American odds are discontinuous at +/-100: no price exists strictly between
    -100 and +100, so a naive median across books that straddle pick'em lands in
    the invalid gap. Real example from this feed: one book had CHI at -107 and
    another at +104; ``median`` returns -1.5, which implies a 98% win
    probability and manufactures a gigantic phantom edge.

    Converting each price to its implied probability makes the scale continuous,
    so the median is meaningful; converting back yields a legal price. Invalid
    inputs are dropped rather than propagated.
    """
    probs = [
        odds_math.american_to_prob(float(p))
        for p in prices
        if p is not None and odds_math.is_valid_american(p)
    ]
    if not probs:
        return None
    return odds_math.prob_to_american(statistics.median(probs))


# --------------------------------------------------------------------------- #
# Pure parsing (unit-tested against fixtures, no network)
# --------------------------------------------------------------------------- #
def extract_initial_state(html: str) -> dict:
    """Pull the ``window.__INITIAL_STATE__ = {...};`` JSON out of the page HTML."""
    marker = "window.__INITIAL_STATE__"
    idx = html.find(marker)
    if idx == -1:
        raise ValueError("window.__INITIAL_STATE__ not found in page")
    start = html.index("{", idx)
    depth = 0
    in_str = False
    esc = False
    for j in range(start, len(html)):
        c = html[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(html[start:j + 1])
    raise ValueError("unbalanced braces while extracting __INITIAL_STATE__")


def parse_events(state: dict) -> Dict[int, dict]:
    """Map each NFL event in the state to teams, participant ids, and kickoff."""
    events = state.get("events", {}).get("events", {}) or {}
    out: Dict[int, dict] = {}
    for eid_str, ev in events.items():
        if ev.get("lid") != NFL_LID:
            continue
        home = away = None
        for pdata in (ev.get("participants") or {}).values():
            src = pdata.get("source") or {}
            side = {
                "partid": pdata.get("partid"),
                "abbr": normalize_team(src.get("abbr")),
                "season": src.get("senam"),
            }
            if pdata.get("ih"):  # ih == "is home"
                home = side
            else:
                away = side
        if not home or not away:
            continue
        out[int(ev["eid"])] = {
            "eid": int(ev["eid"]),
            "home": home,
            "away": away,
            "kickoff_ms": ev.get("dt"),
            "seid": ev.get("seid"),
        }
    return out


def _kickoff_iso(ms) -> Optional[str]:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def parse_current_lines(events: Dict[int, dict], line_rows: List[dict]) -> List[dict]:
    """Reduce raw ``currentLines`` rows to one nflverse-style row per game.

    Multiple books quote each market; we take the **median** across books as the
    consensus line (robust to any single outlier book), matching how OddsTrader
    presents a consensus number.
    """
    # Bucket prices/lines by (eid, mtid, partid).
    buckets: Dict[tuple, Dict[str, List[float]]] = {}
    totals: Dict[int, List[float]] = {}
    for r in line_rows:
        eid, mtid = r.get("eid"), r.get("mtid")
        if mtid == MTID_TOTAL:
            totals.setdefault(eid, []).append(r.get("adj"))
            continue
        key = (eid, mtid, r.get("partid"))
        b = buckets.setdefault(key, {"ap": [], "adj": []})
        b["ap"].append(r.get("ap"))
        b["adj"].append(r.get("adj"))

    rows: List[dict] = []
    for eid, ev in events.items():
        hp, ap = ev["home"]["partid"], ev["away"]["partid"]

        # Prices aggregate in probability space; the point spread itself is a
        # continuous quantity and medians directly.
        home_ml = _median_american(buckets.get((eid, MTID_MONEY, hp), {}).get("ap", []))
        away_ml = _median_american(buckets.get((eid, MTID_MONEY, ap), {}).get("ap", []))

        home_spread_adj = _median(buckets.get((eid, MTID_SPREAD, hp), {}).get("adj", []))
        home_spread_odds = _median_american(buckets.get((eid, MTID_SPREAD, hp), {}).get("ap", []))
        away_spread_odds = _median_american(buckets.get((eid, MTID_SPREAD, ap), {}).get("ap", []))
        # OddsTrader stores the home team's handicap (e.g. -3.5 when home favored).
        # nflverse convention is the negation: positive = home favored.
        spread_line = None if home_spread_adj is None else _round_half(-home_spread_adj)

        total_line = _median(totals.get(eid, []))

        rows.append({
            "game_id": f"OT_{eid}",
            "season": _season_int(ev["home"].get("season")),
            "week": None,
            "gameday": _kickoff_iso(ev.get("kickoff_ms")),
            "home_team": ev["home"]["abbr"],
            "away_team": ev["away"]["abbr"],
            # Carried so results can be mapped back to a side when grading.
            "home_partid": hp,
            "away_partid": ap,
            "home_score": None,
            "away_score": None,
            "spread_line": spread_line,
            "total_line": None if total_line is None else _round_half(total_line),
            "home_moneyline": None if home_ml is None else int(round(home_ml)),
            "away_moneyline": None if away_ml is None else int(round(away_ml)),
            "home_spread_odds": -110 if home_spread_odds is None else int(round(home_spread_odds)),
            "away_spread_odds": -110 if away_spread_odds is None else int(round(away_spread_odds)),
            "status": "pre",
            "provider": "OddsTrader (consensus)",
        })
    return rows


def _round_half(x: float) -> float:
    return round(x * 2) / 2


def _season_int(senam) -> Optional[int]:
    try:
        return int(senam)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Network
# --------------------------------------------------------------------------- #
def _http_get(url: str, timeout: int) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _graphql(query: str, timeout: int) -> dict:
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        ODDS_V2_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)",
            "Origin": "https://www.oddstrader.com",
            "Referer": "https://www.oddstrader.com/",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    if payload.get("errors"):
        raise RuntimeError(f"OddsTrader GraphQL error: {payload['errors']}")
    return payload.get("data", {})


def fetch_current_lines(eids: List[int], catid: int, timeout: int) -> List[dict]:
    if not eids:
        return []
    eid_list = ",".join(str(e) for e in eids)
    query = (
        "{currentLines("
        f"eid:[{eid_list}], mtid:[{MTID_MONEY},{MTID_SPREAD},{MTID_TOTAL}], catid:{catid})"
        "}"
    )
    return _graphql(query, timeout) .get("currentLines", []) or []


def fetch_oddstrader_slate(catid: int = DEFAULT_CATID, timeout: int = 30) -> pd.DataFrame:
    """Scrape the current NFL slate + consensus odds from OddsTrader."""
    state = extract_initial_state(_http_get(NFL_PAGE_URL, timeout))
    events = parse_events(state)
    line_rows = fetch_current_lines(list(events.keys()), catid=catid, timeout=timeout)
    return pd.DataFrame(parse_current_lines(events, line_rows))


# --------------------------------------------------------------------------- #
# Historical results: per-period scores and player box scores
# --------------------------------------------------------------------------- #
# The nflverse schedules give only final scores and no player rows, which is what
# blocked first-half markets and player props. OddsTrader's own backend carries
# both for completed games, on the same reachable endpoint as the odds:
#
#   scores(eid)            -> one row per (participant, period): pn=quarter, val=points
#   statisticsByEvent(eids) -> player box scores, keyed by (pid, idty, stat)
#
# ``idty`` is the stat category ('passing', 'rushing', 'receiving', 'defense',
# 'field-goals', ...), so a player's receiving yards is (idty='receiving',
# stat='yards'). That is enough to both build a projection and grade it.
MTID_1H_MONEY = 91     # first-half moneyline
MTID_1H_SPREAD = 397   # first-half spread
MTID_1H_TOTAL = 398    # first-half total


def fetch_completed_events(
    start_ms: int, hours_range: int = 72, lid: int = NFL_LID, timeout: int = 30
) -> pd.DataFrame:
    """Games in a window, with status -- use to walk historical weeks."""
    query = (
        f"{{eventsByDateNew(startDate:{int(start_ms)}, hoursRange:{int(hours_range)}, "
        f"lid:[{lid}]){{events{{eid des es dt}}}}}}"
    )
    payload = _graphql(query, timeout)
    events = (payload.get("eventsByDateNew") or {}).get("events") or []
    return pd.DataFrame(events)


def fetch_period_scores(eids: List[int], timeout: int = 30) -> pd.DataFrame:
    """Per-quarter scoring for completed games: eid, partid, pn (period), val."""
    if not eids:
        return pd.DataFrame(columns=["eid", "partid", "pn", "val"])
    ids = ",".join(str(int(e)) for e in eids)
    payload = _graphql(f"{{scores(eid:[{ids}]){{eid partid pn val}}}}", timeout)
    return pd.DataFrame(payload.get("scores") or [])


def half_scores(score_rows: pd.DataFrame) -> pd.DataFrame:
    """Collapse per-quarter rows into first-half and final totals per side.

    Periods 1 and 2 are the first half; everything else adds to the final. A
    game missing either opening quarter is dropped rather than guessed at.
    """
    if score_rows.empty:
        return pd.DataFrame(columns=["eid", "partid", "first_half", "final"])
    df = score_rows.copy()
    df["pn"] = pd.to_numeric(df["pn"], errors="coerce")
    df["val"] = pd.to_numeric(df["val"], errors="coerce").fillna(0.0)
    first = (
        df[df["pn"].isin([1, 2])].groupby(["eid", "partid"])["val"].sum().rename("first_half")
    )
    final = df.groupby(["eid", "partid"])["val"].sum().rename("final")
    complete = df[df["pn"].isin([1, 2])].groupby(["eid", "partid"])["pn"].nunique().eq(2)
    out = pd.concat([first, final], axis=1).reset_index()
    return out[out.set_index(["eid", "partid"]).index.map(complete).fillna(False)]


def fetch_player_boxscore(eids: List[int], timeout: int = 60, limit: int = 8000) -> pd.DataFrame:
    """Player box scores for completed games.

    Returns one row per (player, category, stat): ``pid``, ``player`` (name),
    ``team_partid``, ``category`` (``idty``: passing / rushing / receiving / ...),
    ``stat`` and numeric ``value`` -- the raw material for a props projection.
    """
    if not eids:
        return pd.DataFrame(columns=["eid", "pid", "player", "category", "stat", "value"])
    ids = ",".join(str(int(e)) for e in eids)
    query = (
        f"{{statisticsByEvent(eids:[{ids}], limit:{int(limit)})"
        "{eid pid pfn pln partid idty stat val}}"
    )
    rows = _graphql(query, timeout).get("statisticsByEvent") or []
    df = pd.DataFrame([r for r in rows if r.get("pid")])
    if df.empty:
        return pd.DataFrame(columns=["eid", "pid", "player", "category", "stat", "value"])
    df["player"] = (df["pfn"].fillna("") + " " + df["pln"].fillna("")).str.strip()
    df["value"] = pd.to_numeric(df["val"], errors="coerce")
    return df.rename(columns={"idty": "category", "partid": "team_partid"})[
        ["eid", "pid", "player", "team_partid", "category", "stat", "value"]
    ]


def fetch_depth_chart_starters(timeout: int = 45) -> Dict[str, str]:
    """Current QB1 for every team, from OddsTrader's live depth charts.

    The historical fallback (last season's primary starter) cannot see offseason
    moves -- a team that released its quarterback still shows the old name. The
    depth chart is the live answer, so it overrides the assumption wherever the
    two disagree.

    Returns ``{team_abbr: "First Last"}`` for the quarterback listed at order 1.
    """
    state = extract_initial_state(_http_get(NFL_PAGE_URL, timeout))
    events = (state.get("events", {}) or {}).get("events", {}) or {}

    team_ids: Dict[str, int] = {}
    season_id = None
    for ev in events.values():
        if ev.get("lid") != NFL_LID:
            continue
        season_id = ev.get("seid") or season_id
        for pdata in (ev.get("participants") or {}).values():
            src = pdata.get("source") or {}
            abbr, tmid = normalize_team(src.get("abbr")), src.get("tmid")
            if abbr and tmid:
                team_ids[abbr] = int(tmid)
    if not team_ids or season_id is None:
        return {}

    ids = ",".join(str(t) for t in sorted(set(team_ids.values())))
    charts = _graphql(
        f"{{getTeamDepthChart(teamId:[{ids}], seasonId:{int(season_id)})}}", timeout
    ).get("getTeamDepthChart") or {}

    starters: Dict[str, str] = {}
    for abbr, tmid in team_ids.items():
        chart = charts.get(str(tmid)) or {}
        qbs = ((chart.get("roles") or {}).get("OFFENSE") or {}).get("QUARTERBACK") or []
        # The QUARTERBACK slot is not always clean -- one team currently lists a
        # running back at order 1 -- so trust the player's own listed position
        # over the slot it was filed under.
        real_qbs = [
            q for q in qbs
            if "quarterback" in str((q.get("player") or {}).get("ppnam", "")).lower()
            or str((q.get("player") or {}).get("ppnam", "")).strip().upper() == "QB"
        ]
        qbs = real_qbs or qbs
        if not qbs:
            continue
        top = min(qbs, key=lambda q: (q.get("player") or {}).get("order", 99))
        player = top.get("player") or {}
        name = f"{player.get('fn', '')} {player.get('lnam', '')}".strip()
        if name:
            starters[abbr] = name
    return starters
