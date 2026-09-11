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

PROJECTIONS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output", "projections.csv"
)
PROJ_COLUMNS = [
    "recorded_at", "eid", "season", "week", "kickoff", "away", "home",
    "home_partid", "away_partid", "model_margin", "market_line",
    "home_score", "away_score", "actual_margin", "model_error", "market_error",
]

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

    _record_projections(payload)

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


def _record_projections(payload: dict) -> None:
    """Log every game's projection, bet or not.

    Bet results are a weak scoreboard: a dozen binary outcomes a week, each
    mostly noise. Every game, however, yields a continuous score -- how far the
    projection landed from the actual margin, against how far the closing line
    landed. That is the comparison that actually matters, and with ~16 games a
    week it accumulates far faster than a win rate ever could.
    """
    existing_proj = _load_projections()
    seen = set(existing_proj.get("eid", []))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    rows = []
    for game in payload.get("games", []):
        eid = _to_int(str(game.get("id", "")).replace("OT_", ""))
        if eid is None or eid in seen:
            continue
        rows.append({
            "recorded_at": now, "eid": eid,
            "season": game.get("season"), "week": game.get("week"),
            "kickoff": game.get("kickoff"), "away": game["away"], "home": game["home"],
            "home_partid": game.get("homePartid"), "away_partid": game.get("awayPartid"),
            "model_margin": game.get("projectedMargin"),
            "market_line": game["market"].get("spreadLine"),
            "home_score": None, "away_score": None, "actual_margin": None,
            "model_error": None, "market_error": None,
        })
    if rows:
        out = pd.concat([existing_proj, pd.DataFrame(rows)], ignore_index=True)[PROJ_COLUMNS]
        out.to_csv(PROJECTIONS, index=False)
        print(f"Logged {len(rows)} game projections ({len(out)} total).")


def _load_projections() -> pd.DataFrame:
    if os.path.exists(PROJECTIONS):
        return pd.read_csv(PROJECTIONS)
    return pd.DataFrame(columns=PROJ_COLUMNS)


def _grade_projections() -> None:
    """Settle logged projections and score the model against the closing line."""
    proj = _load_projections()
    if proj.empty:
        return
    pending = proj[proj["actual_margin"].isna()]
    totals = {}
    if not pending.empty:
        try:
            scores = oddstrader.fetch_period_scores(
                sorted({int(e) for e in pending["eid"].dropna()})
            )
            if not scores.empty:
                totals = oddstrader.half_scores(scores).set_index(["eid", "partid"])["final"]
        except Exception as exc:
            print(f"[warn] could not fetch results for projections "
                  f"({type(exc).__name__}: {exc}).")
    graded = 0
    for idx, row in pending.iterrows():
        hs = totals.get((row["eid"], row["home_partid"]))
        aws = totals.get((row["eid"], row["away_partid"]))
        if hs is None or aws is None or pd.isna(hs) or pd.isna(aws):
            continue
        actual = float(hs) - float(aws)
        proj.loc[idx, "home_score"] = float(hs)
        proj.loc[idx, "away_score"] = float(aws)
        proj.loc[idx, "actual_margin"] = actual
        proj.loc[idx, "model_error"] = abs(float(row["model_margin"]) - actual)
        if pd.notna(row["market_line"]):
            proj.loc[idx, "market_error"] = abs(float(row["market_line"]) - actual)
        graded += 1
    if graded:
        proj.to_csv(PROJECTIONS, index=False)
    _report_projections(proj, graded)


def _report_projections(proj: pd.DataFrame, newly: int) -> None:
    done = proj[proj["actual_margin"].notna() & proj["market_error"].notna()]
    print(f"\nProjection accuracy — {len(proj)} games logged, {len(done)} final"
          f"{f' ({newly} new)' if newly else ''}.")
    if done.empty:
        return

    model_mae = done["model_error"].mean()
    market_mae = done["market_error"].mean()
    # Paired difference: per game, how much worse was the model than the line?
    # Pairing cancels the shared game-to-game variance, so it resolves a real
    # gap in a fraction of the sample an unpaired comparison would need.
    diff = (done["model_error"] - done["market_error"]).to_numpy(dtype=float)
    n = len(diff)
    mean = diff.mean()
    stderr = diff.std(ddof=1) / np.sqrt(n) if n > 1 else float("nan")
    print(f"  model  MAE {model_mae:>5.2f} pts")
    print(f"  market MAE {market_mae:>5.2f} pts")
    if n > 1:
        lo, hi = mean - 1.96 * stderr, mean + 1.96 * stderr
        verdict = ("model is BETTER" if hi < 0 else
                   "market is better" if lo > 0 else "no separation yet")
        print(f"  model - market: {mean:>+5.2f} pts  95% CI [{lo:+.2f}, {hi:+.2f}]  -> {verdict}")
        print("  (negative means the model beat the closing line; beating it is the "
              "whole\n   ballgame, and almost nothing does)")


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
    # Projections cover every game, including ones we passed on, so they are
    # graded independently of whatever the ledger happens to be waiting for.
    _grade_projections()
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
