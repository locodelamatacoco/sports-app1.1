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
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


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

        home_ml = _median(buckets.get((eid, MTID_MONEY, hp), {}).get("ap", []))
        away_ml = _median(buckets.get((eid, MTID_MONEY, ap), {}).get("ap", []))

        home_spread_adj = _median(buckets.get((eid, MTID_SPREAD, hp), {}).get("adj", []))
        home_spread_odds = _median(buckets.get((eid, MTID_SPREAD, hp), {}).get("ap", []))
        away_spread_odds = _median(buckets.get((eid, MTID_SPREAD, ap), {}).get("ap", []))
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
