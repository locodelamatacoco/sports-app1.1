"""Grab live NFL moneylines & spreads from ESPN.

Same source the React ``ScoresPage`` already uses -- ESPN's public, key-free
scoreboard API (``site.api.espn.com``), which is exactly what powers the
https://www.espn.com/nfl/odds page. We pull each game's odds and normalize them
into the nflverse-style schema the model prices against:

    spread_line   -- positive = HOME favored by that many points
    home_moneyline / away_moneyline
    home_spread_odds / away_spread_odds (the juice, usually ~ -110)

``parse_espn_scoreboard`` is a pure function (dict in, rows out) so it is unit
tested against a captured payload with no network. ``fetch_espn_slate`` does the
HTTP call; it needs outbound access to ESPN (available from a browser or any
normal host -- your app already calls this endpoint client-side).

Note on OddsTrader (https://www.oddstrader.com/nfl/): it has no public API, so
programmatic access means scraping its HTML/undocumented endpoints -- fragile
and against most sites' terms. ESPN's API is the robust, sanctioned path; use it
unless you specifically need OddsTrader's multi-book comparison.
"""
from __future__ import annotations

import json
import urllib.request
from typing import List, Optional

import pandas as pd

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

# ESPN abbreviations that differ from nflverse's, so ratings join correctly.
ESPN_TO_NFLVERSE = {
    "WSH": "WAS",  # Washington
    "LAR": "LA",   # Rams (nflverse uses "LA")
}


def normalize_team(abbr: Optional[str]) -> Optional[str]:
    """Map an ESPN team abbreviation to the nflverse convention."""
    if abbr is None:
        return None
    return ESPN_TO_NFLVERSE.get(abbr.upper(), abbr.upper())


def _as_american(value) -> Optional[int]:
    """Coerce ESPN's moneyline/spread-odds values to an int, or None."""
    if value in (None, "", "EVEN", "even"):
        return 100 if value in ("EVEN", "even") else None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _select_odds(odds_list: List[dict], prefer_provider: Optional[str]) -> Optional[dict]:
    """Choose one book's odds block from ESPN's ``competition.odds`` array.

    Prefer a named provider if asked; otherwise take the highest-priority book
    (ESPN orders them with the lowest ``priority`` first), falling back to the
    first entry that actually carries a moneyline.
    """
    if not odds_list:
        return None
    if prefer_provider:
        for o in odds_list:
            name = (o.get("provider") or {}).get("name", "")
            if prefer_provider.lower() in name.lower():
                return o
    ordered = sorted(odds_list, key=lambda o: (o.get("provider") or {}).get("priority", 99))
    for o in ordered:
        if (o.get("homeTeamOdds") or {}).get("moneyLine") is not None:
            return o
    return ordered[0]


def _home_spread_line(odds: dict, home: str, away: str, hto: dict, ato: dict) -> Optional[float]:
    """Derive the home-perspective spread (nflverse convention) from ESPN odds.

    ESPN's ``details`` (e.g. ``"KC -3.5"``) is the most reliable field: it names
    the favorite and the number. Home favored -> positive; away favored ->
    negative; pick'em -> 0. Falls back to the ``spread`` field + favorite flags.
    """
    details = (odds.get("details") or "").strip()
    if details:
        upper = details.upper()
        if upper in ("EVEN", "PK", "PICK", "PICK'EM"):
            return 0.0
        parts = details.split()
        try:
            number = float(parts[-1])  # e.g. -3.5
            fav = normalize_team(parts[0])
            magnitude = abs(number)
            if fav == normalize_team(home):
                return magnitude
            if fav == normalize_team(away):
                return -magnitude
        except (ValueError, IndexError):
            pass

    spread = odds.get("spread")
    if spread is not None:
        try:
            magnitude = abs(float(spread))
        except (TypeError, ValueError):
            return None
        if hto.get("favorite"):
            return magnitude
        if ato.get("favorite"):
            return -magnitude
        return float(spread)
    return None


def parse_espn_scoreboard(payload: dict, prefer_provider: Optional[str] = None) -> List[dict]:
    """Convert an ESPN scoreboard JSON payload into model-ready game rows."""
    games: List[dict] = []
    for event in payload.get("events", []):
        comps = event.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]

        home = away = None
        home_score = away_score = None
        for c in comp.get("competitors", []):
            abbr = normalize_team((c.get("team") or {}).get("abbreviation"))
            score = _as_american(c.get("score"))
            if c.get("homeAway") == "home":
                home, home_score = abbr, score
            elif c.get("homeAway") == "away":
                away, away_score = abbr, score
        if not home or not away:
            continue

        odds = _select_odds(comp.get("odds") or [], prefer_provider)
        spread_line = total = home_ml = away_ml = None
        home_spread_odds = away_spread_odds = -110
        provider = None
        if odds:
            provider = (odds.get("provider") or {}).get("name")
            total = odds.get("overUnder")
            hto = odds.get("homeTeamOdds") or {}
            ato = odds.get("awayTeamOdds") or {}
            home_ml = _as_american(hto.get("moneyLine"))
            away_ml = _as_american(ato.get("moneyLine"))
            if hto.get("spreadOdds") is not None:
                home_spread_odds = _as_american(hto.get("spreadOdds")) or -110
            if ato.get("spreadOdds") is not None:
                away_spread_odds = _as_american(ato.get("spreadOdds")) or -110
            spread_line = _home_spread_line(odds, home, away, hto, ato)

        state = ((comp.get("status") or {}).get("type") or {}).get("state")
        games.append({
            "game_id": event.get("id"),
            "season": (event.get("season") or {}).get("year"),
            "week": (event.get("week") or {}).get("number"),
            "gameday": event.get("date"),
            "home_team": home,
            "away_team": away,
            # Only trust a score once the game is final; upcoming games are None.
            "home_score": home_score if state == "post" else None,
            "away_score": away_score if state == "post" else None,
            "spread_line": spread_line,
            "total_line": total,
            "home_moneyline": home_ml,
            "away_moneyline": away_ml,
            "home_spread_odds": home_spread_odds,
            "away_spread_odds": away_spread_odds,
            "status": state,
            "provider": provider,
        })
    return games


def fetch_espn_scoreboard(
    year: Optional[int] = None, week: Optional[int] = None, seasontype: int = 2, timeout: int = 30
) -> dict:
    """Fetch the raw ESPN scoreboard JSON.

    ``seasontype``: 1 = preseason, 2 = regular season, 3 = postseason. With no
    ``year``/``week``, ESPN returns the current week's slate.
    """
    params = []
    if year:
        params.append(f"dates={year}")
    if seasontype:
        params.append(f"seasontype={seasontype}")
    if week:
        params.append(f"week={week}")
    url = SCOREBOARD_URL + (("?" + "&".join(params)) if params else "")
    # A browser UA avoids the occasional bot filter; honors HTTPS_PROXY/SSL_CERT_FILE from env.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def fetch_espn_slate(
    year: Optional[int] = None,
    week: Optional[int] = None,
    seasontype: int = 2,
    prefer_provider: Optional[str] = None,
) -> pd.DataFrame:
    """Fetch and parse an NFL slate from ESPN into a games DataFrame."""
    payload = fetch_espn_scoreboard(year=year, week=week, seasontype=seasontype)
    return pd.DataFrame(parse_espn_scoreboard(payload, prefer_provider=prefer_provider))
