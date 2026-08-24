"""
f5_offense.py — SHADOW STAT: real first-five runs per game, per team.
=====================================================================
The live model's offense_score() is built on FULL-GAME runs/game. But F5 is
the only market we bet, and teams score differently in innings 1-5 (facing a
starter) than 6-9 (facing bullpens). This computes each team's ACTUAL F5
runs/game from linescores — the target variable itself instead of a proxy.

SHADOW ONLY. Nothing here feeds daily_run.py. It writes data/f5_offense.json
and prints a comparison so we can see whether F5 offense would reorder the
board before anyone proposes changing the live model (rules FROZEN v3.1.4).

Usage:
  python3 f5_offense.py                 # trailing 30d window ending yesterday
  python3 f5_offense.py --days 45
  python3 f5_offense.py --date 2026-08-24 --days 30
"""
import argparse
import datetime
import json
import os
from zoneinfo import ZoneInfo

import requests

BASE = "https://statsapi.mlb.com/api/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
ET = ZoneInfo("America/New_York")


def fetch_f5(start, end):
    """team_id -> list[(date, gamePk, f5_runs)] over the window, Final games only."""
    r = requests.get(f"{BASE}/schedule", timeout=90, params={
        "sportId": 1, "startDate": start, "endDate": end,
        "hydrate": "linescore,team"})
    r.raise_for_status()
    seen, out = {}, {}
    for day in r.json().get("dates", []):
        for g in day["games"]:
            if g.get("status", {}).get("detailedState") != "Final":
                continue
            seen[g["gamePk"]] = (day["date"], g)      # dedupe by gamePk
    for pk, (date, g) in seen.items():
        innings = g.get("linescore", {}).get("innings", [])
        if len(innings) < 5:
            continue                                  # shortened/suspended
        for side in ("away", "home"):
            tid = g["teams"][side]["team"]["id"]
            f5 = sum(i.get(side, {}).get("runs", 0) or 0 for i in innings[:5])
            out.setdefault(tid, []).append((date, pk, f5))
    return out


def summarize(raw):
    """team_id -> {f5_rpg, f5_l10, games}."""
    res = {}
    for tid, lst in raw.items():
        lst = sorted(lst)
        allg = [f for _, _, f in lst]
        last10 = [f for _, _, f in lst[-10:]]
        res[tid] = {"f5_rpg": round(sum(allg) / len(allg), 3),
                    "f5_l10": round(sum(last10) / len(last10), 3),
                    "games": len(allg)}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--date", default=None, help="window ends the day before this")
    a = ap.parse_args()

    end_ref = (datetime.date.fromisoformat(a.date) if a.date
               else datetime.datetime.now(ET).date())
    end = end_ref - datetime.timedelta(days=1)
    start = end - datetime.timedelta(days=a.days - 1)
    print(f"F5 offense window: {start} .. {end} ({a.days}d)")

    stats = summarize(fetch_f5(start.isoformat(), end.isoformat()))
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "f5_offense.json")
    with open(path, "w") as f:
        json.dump({"window": [start.isoformat(), end.isoformat()], "teams": stats}, f)
    print(f"wrote {path} ({len(stats)} teams)")

    # comparison vs the full-game R/G the live model actually uses
    try:
        import sys
        sys.path.insert(0, HERE)
        from daily_run import parse_hitting, _load
        full = parse_hitting(_load("hitting.json"))
        sched = _load("schedule_today.json")
    except Exception as e:
        print(f"[skip comparison] {e}")
        return

    id2ab = {}
    for g in sched.get("dates", [{}])[0].get("games", []):
        for s in ("away", "home"):
            t = g["teams"][s]["team"]
            id2ab[t["id"]] = t.get("abbreviation", str(t["id"]))

    print("\n=== F5 offense vs FULL-GAME offense (teams on today's slate) ===")
    print(f"{'TM':4} {'full R/G':>9} {'F5 R/G':>8} {'F5 share':>9} {'F5 L10':>8}  read")
    rows = []
    for tid, ab in sorted(id2ab.items(), key=lambda kv: kv[1]):
        if tid not in stats or tid not in full:
            continue
        fg = full[tid][0]
        s = stats[tid]
        share = s["f5_rpg"] / fg if fg else 0
        rows.append((ab, fg, s["f5_rpg"], share, s["f5_l10"]))
    if not rows:
        print("(no overlap)"); return
    med = sorted(r[3] for r in rows)[len(rows) // 2]
    for ab, fg, f5, share, l10 in rows:
        read = "F5-HEAVY (front-loaded)" if share > med + 0.04 else \
               "F5-LIGHT (late-scoring)" if share < med - 0.04 else ""
        print(f"{ab:4} {fg:9.2f} {f5:8.2f} {share:8.1%} {l10:8.2f}  {read}")
    print(f"\nmedian F5 share of full-game runs: {med:.1%}")
    print("Teams far from the median are the ones a full-game proxy misprices.")


if __name__ == "__main__":
    main()
