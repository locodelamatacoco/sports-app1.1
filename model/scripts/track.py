#!/usr/bin/env python3
"""Record each week's picks and grade them once the games are final.

The backtest says what the model *would have* done historically. This says what
it is actually doing now, on picks that were written down before kickoff — which
is the only record that can't be tuned after the fact.

Two steps, run in this order each week::

    # after pricing a slate, write its flagged bets into the ledger
    python -m scripts.track record --picks output/nfl_edges.json

    # any time later, grade whatever has finished and print the running record
    python -m scripts.track grade

Picks are keyed by (event, market, side), so re-recording the same slate is
harmless — a line already in the ledger is never duplicated or overwritten, and
its price is frozen at the moment it was recorded.

Results come from OddsTrader's per-quarter scores, summed to a final. Grading is
the same arithmetic the backtest uses: a spread pays on the cushion, a moneyline
on the winner, and a dead-on number is a push.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import oddstrader  # noqa: E402
from nfl_model import odds as odds_math  # noqa: E402

LEDGER = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output", "ledger.csv"
)
BREAK_EVEN_PCT = 52.38

COLUMNS = [
    "recorded_at", "eid", "season", "week", "kickoff", "away", "home",
    "home_partid", "away_partid", "market", "side", "label", "spread_line",
    "book_odds", "model_prob", "edge", "ev",
    "home_score", "away_score", "result", "profit",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    rec = sub.add_parser("record", help="Append a slate's flagged bets to the ledger.")
    rec.add_argument("--picks", default="output/nfl_edges.json",
                     help="Export JSON written by train_and_export.")
    rec.add_argument("--all-wagers", action="store_true",
                     help="Record every priced wager, not just the flagged ones "
                          "(useful for measuring the bet gate itself).")

    grd = sub.add_parser("grade", help="Grade finished games and report the record.")
    grd.add_argument("--ledger", default=LEDGER)
    return p.parse_args()


def _load_ledger(path: str) -> pd.DataFrame:
    ledger = pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=COLUMNS)
    # An all-empty ledger reads these back as float64, and pandas refuses to
    # write a label like "push" into a float column. Pin them to object up front.
    for col in ("result", "label", "market", "side"):
        if col in ledger.columns:
            ledger[col] = ledger[col].astype(object)
    return ledger


def record(args: argparse.Namespace) -> int:
    with open(args.picks) as fh:
        payload = json.load(fh)

    ledger = _load_ledger(LEDGER)
    existing = set(
        zip(ledger.get("eid", []), ledger.get("market", []), ledger.get("side", []))
    )

    rows = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for game in payload.get("games", []):
        eid = str(game.get("id", "")).replace("OT_", "")
        wagers = game["wagers"] if args.all_wagers else game["valueBets"]
        for w in wagers:
            if (_to_int(eid), w["market"], w["side"]) in existing:
                continue
            rows.append({
                "recorded_at": now, "eid": _to_int(eid),
                "season": game.get("season"), "week": game.get("week"),
                "kickoff": game.get("kickoff"), "away": game["away"], "home": game["home"],
                "home_partid": game.get("homePartid"), "away_partid": game.get("awayPartid"),
                "market": w["market"], "side": w["side"], "label": w["label"],
                "spread_line": game["market"].get("spreadLine"),
                "book_odds": w["book_odds"], "model_prob": w["model_prob"],
                "edge": w["edge"], "ev": w["ev"],
                "home_score": None, "away_score": None, "result": None, "profit": None,
            })

    if not rows:
        print("Nothing new to record — every pick in this slate is already in the ledger.")
        return 0

    out = pd.concat([ledger, pd.DataFrame(rows)], ignore_index=True)[COLUMNS]
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    out.to_csv(LEDGER, index=False)
    print(f"Recorded {len(rows)} new picks ({len(out)} total) -> {LEDGER}")
    for r in rows:
        print(f"  {r['away']} @ {r['home']:<4} {r['label']:<12} "
              f"{r['book_odds']:+.0f}  edge {r['edge']*100:+.1f}%")
    return 0


def _to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def grade(args: argparse.Namespace) -> int:
    ledger = _load_ledger(args.ledger)
    if ledger.empty:
        print("Ledger is empty — record a slate first.")
        return 0

    pending = ledger[ledger["profit"].isna()]
    if not pending.empty:
        eids = sorted({int(e) for e in pending["eid"].dropna()})
        try:
            scores = oddstrader.fetch_period_scores(eids)
        except Exception as exc:
            print(f"[warn] could not fetch results ({type(exc).__name__}: {exc}); "
                  "reporting what is already graded.")
            scores = pd.DataFrame()

        if not scores.empty:
            totals = oddstrader.half_scores(scores).set_index(["eid", "partid"])["final"]
            graded = 0
            for idx, row in pending.iterrows():
                hs = totals.get((row["eid"], row["home_partid"]))
                aws = totals.get((row["eid"], row["away_partid"]))
                if hs is None or aws is None or pd.isna(hs) or pd.isna(aws):
                    continue  # not final yet
                profit = _grade_one(row, float(hs) - float(aws))
                if profit is None:
                    continue
                _settle(ledger, idx, float(hs), float(aws), profit)
                graded += 1
            if graded:
                ledger.to_csv(args.ledger, index=False)
            print(f"Graded {graded} newly-final pick(s).")

    _report(ledger)
    return 0


def _settle(ledger: pd.DataFrame, idx, home_score: float, away_score: float,
            profit: float) -> None:
    """Write a settled result back into the ledger, one column at a time.

    Assigning a whole row at once mixes floats and a label, which pandas will
    reject against the float columns a freshly-created ledger starts with.
    """
    ledger.loc[idx, "home_score"] = home_score
    ledger.loc[idx, "away_score"] = away_score
    ledger.loc[idx, "profit"] = profit
    ledger.loc[idx, "result"] = "push" if profit == 0 else ("win" if profit > 0 else "loss")


def _grade_one(row, home_margin: float):
    """Profit per 1 unit staked, or None if the wager can't be settled."""
    if row["market"] == "spread":
        line = row["spread_line"]
        if pd.isna(line):
            return None
        cushion = (home_margin - line) if row["side"] == "home" else (line - home_margin)
        if cushion == 0:
            return 0.0
        won = cushion > 0
    else:
        if home_margin == 0:
            return 0.0
        won = (home_margin > 0) if row["side"] == "home" else (home_margin < 0)
    return (odds_math.american_to_decimal(row["book_odds"]) - 1.0) if won else -1.0


def _summary(df: pd.DataFrame, label: str) -> None:
    settled = df[df["profit"].notna()]
    if settled.empty:
        print(f"{label:<22} (nothing settled yet)")
        return
    profit = settled["profit"].to_numpy(dtype=float)
    decided = profit[profit != 0]
    win_pct = 100.0 * (decided > 0).sum() / max(len(decided), 1)
    roi = 100.0 * profit.mean()
    n = len(profit)
    # Same discipline as the backtest: never show a rate without its uncertainty.
    stderr = (profit.std(ddof=1) / np.sqrt(n)) if n > 1 else float("nan")
    ci = f"[{roi - 196 * stderr:>+6.2f}%,{roi + 196 * stderr:>+6.2f}%]" if n > 1 else "[n/a]"
    print(f"{label:<22} {n:>3} settled | win% {win_pct:>5.1f} | "
          f"units {profit.sum():>+6.2f} | ROI {roi:>+6.2f}% | 95% CI {ci}")


def _report(ledger: pd.DataFrame) -> None:
    settled = ledger[ledger["profit"].notna()]
    pending = ledger[ledger["profit"].isna()]
    print(f"\nPick ledger — {len(ledger)} recorded, {len(settled)} settled, "
          f"{len(pending)} awaiting results.\n")

    _summary(ledger, "ALL")
    _summary(ledger[ledger["market"] == "spread"], "  spreads")
    _summary(ledger[ledger["market"] == "moneyline"], "  moneylines")
    if "week" in ledger.columns:
        for week in sorted(ledger["week"].dropna().unique()):
            _summary(ledger[ledger["week"] == week], f"  week {int(week)}")

    if not settled.empty:
        print("\nSettled picks:")
        for _, r in settled.sort_values("kickoff").iterrows():
            mark = {"win": "W", "loss": "L", "push": "P"}.get(r["result"], "?")
            print(f"  [{mark}] {r['away']} @ {r['home']:<4} {r['label']:<12} "
                  f"{r['book_odds']:+.0f}  final {int(r['away_score'])}-{int(r['home_score'])}"
                  f"  {r['profit']:+.2f}u")

    n = len(settled)
    if 0 < n < 100:
        print(f"\n  Note: {n} settled bets is far too few to mean anything. It takes "
              "hundreds\n  before a win rate separates from luck — read the CI, not the record.")
    print(f"\nBreak-even at -110 juice is {BREAK_EVEN_PCT}% (ROI 0%).")


def main() -> int:
    args = parse_args()
    return record(args) if args.cmd == "record" else grade(args)


if __name__ == "__main__":
    raise SystemExit(main())
