"""
fetch_data.py — automated statsapi pull for the v3.1 daily engine.
==================================================================
Replaces the Chrome-MCP fetch recipe in RUNBOOK.md: this environment has
direct outbound HTTPS (via the org egress proxy), so the four inputs are
pulled straight from statsapi.mlb.com and written into ./data/ in exactly
the shapes daily_run.py's parsers expect.

  data/schedule_today.json   RUNBOOK step 1 (schedule + probables + team hydrate)
  data/hitting.json          RUNBOOK step 2 (season team hitting)
  data/pitchers.json         RUNBOOK step 3 (probable-SP season pitching)
  data/recent_league.json    RUNBOOK step 4, league-wide variant (no linescore
                             hydrate — compute_l10() dedupes by gamePk)

Odds (RUNBOOK step 5) stay manual: drop data/odds_YYYY-MM-DD.csv before the
run for edges/tiers; without it daily_run.py runs lean-only.

Usage:
  python3 fetch_data.py                 # pull today's inputs (ET calendar date)
  python3 fetch_data.py --date 2026-07-08
  python3 fetch_data.py --grade 2026-07-07   # print F5 (innings 1-5) scores for
                                             # that slate, for grading the log

If statsapi.mlb.com is blocked by the environment's network policy the
requests fail with a proxy 403 — allow the domain in the environment
settings (see RUNBOOK-CLOUD.md).
"""
import argparse
import datetime
import json
import os
import sys
from zoneinfo import ZoneInfo

import requests

BASE = "https://statsapi.mlb.com/api/v1"
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
ET = ZoneInfo("America/New_York")


def get(path, **params):
    r = requests.get(f"{BASE}/{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, name)
    with open(path, "w") as f:
        json.dump(obj, f)
    print(f"wrote {path} ({os.path.getsize(path):,} bytes)")


def fetch_slate(date):
    season = date[:4]
    sched = get("schedule", sportId=1, date=date, hydrate="probablePitcher,team")
    save("schedule_today.json", sched)

    games = sched["dates"][0]["games"] if sched.get("dates") else []
    pids = sorted({
        g["teams"][side].get("probablePitcher", {}).get("id")
        for g in games for side in ("away", "home")
    } - {None})
    print(f"{len(games)} games, {len(pids)} probable SPs confirmed")

    hitting = get("teams/stats", season=season, group="hitting",
                  stats="season", sportId=1)
    save("hitting.json", hitting)

    if pids:
        pitchers = get("people", personIds=",".join(map(str, pids)),
                       hydrate=f"stats(group=[pitching],type=[season],season={season})")
    else:
        pitchers = {"people": []}
    save("pitchers.json", pitchers)

    d = datetime.date.fromisoformat(date)
    start, end = d - datetime.timedelta(days=13), d - datetime.timedelta(days=1)
    # league-wide, NO linescore hydrate (payload stays small; see RUNBOOK)
    recent = get("schedule", sportId=1, startDate=start.isoformat(),
                 endDate=end.isoformat())
    save("recent_league.json", recent)

    odds = os.path.join(DATA, f"odds_{date}.csv")
    if not os.path.exists(odds):
        print(f"[note] no {os.path.basename(odds)} — drop it in data/ before "
              f"daily_run.py for edges/tiers, else the run is lean-only")


def grade(date):
    """Print F5 (sum of innings 1-5) per game for the date — grading input."""
    sched = get("schedule", sportId=1, date=date, hydrate="linescore,team")
    for day in sched.get("dates", []):
        for g in day["games"]:
            a, h = g["teams"]["away"]["team"], g["teams"]["home"]["team"]
            aab = a.get("abbreviation", a["id"])
            hab = h.get("abbreviation", h["id"])
            state = g["status"]["detailedState"]
            innings = g.get("linescore", {}).get("innings", [])
            if state != "Final" or not innings:
                print(f"{aab}@{hab}: {state} — not gradeable")
                continue
            f5a = sum(i.get("away", {}).get("runs", 0) or 0 for i in innings[:5])
            f5h = sum(i.get("home", {}).get("runs", 0) or 0 for i in innings[:5])
            res = "away" if f5a > f5h else "home" if f5h > f5a else "PUSH"
            full_a = g["teams"]["away"].get("score")
            full_h = g["teams"]["home"].get("score")
            print(f"{aab}@{hab}: F5 {f5a}-{f5h} ({res}) | final {full_a}-{full_h}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="slate date YYYY-MM-DD (default: today ET)")
    ap.add_argument("--grade", default=None, metavar="DATE",
                    help="print F5 scores for DATE instead of fetching inputs")
    args = ap.parse_args()
    if args.grade:
        grade(args.grade)
        sys.exit(0)
    fetch_slate(args.date or datetime.datetime.now(ET).date().isoformat())
