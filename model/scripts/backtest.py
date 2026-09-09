#!/usr/bin/env python3
"""Walk-forward backtest: do the flagged value bets actually win?

This is the guard rail against fooling yourself. The model always *produces* an
edge list; the only way to know whether that list is worth anything is to replay
it against real closing lines on games the model never trained on.

Method: for each season S, train on every game before S, price all of season S
using the real posted lines, and grade every wager the bet gate flagged. No
peeking -- the model for season S has never seen a single game from S onward.

The headline diagnostic is the **edge-bucket table**. A model with genuine skill
shows ROI *rising* with the size of its claimed edge. If ROI instead falls as the
claimed edge grows, the "edges" are the model's own error: the further it strays
from the market, the more wrong it is. That inversion means do not bet the list.

Run from the ``model/`` directory::

    python -m scripts.backtest
    python -m scripts.backtest --start 2015 --end 2025 --week 1
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data as data_mod  # noqa: E402
from nfl_model import edges as edge_mod  # noqa: E402
from nfl_model import features as feat  # noqa: E402
from nfl_model import odds as odds_math  # noqa: E402
from nfl_model.model import train_margin_model  # noqa: E402

# Flat-betting break-even at standard -110 juice.
BREAK_EVEN_PCT = 52.38


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--first-season", type=int, default=2006,
                   help="Earliest season to load as training history (default 2006).")
    p.add_argument("--start", type=int, default=2012, help="First season to bet (default 2012).")
    p.add_argument("--end", type=int, default=2025, help="Last season to bet (default 2025).")
    p.add_argument("--week", type=int, default=None, help="Restrict grading to one week.")
    p.add_argument("--min-train", type=int, default=500,
                   help="Skip a season unless this many prior games exist (default 500).")
    return p.parse_args()


def grade(wager: dict, game: pd.Series) -> float | None:
    """Profit per 1 unit staked: +payout on a win, -1 on a loss, 0 on a push."""
    margin = game["home_margin"]

    if wager["market"] == "spread":
        line = game.get("spread_line")
        if pd.isna(line):
            return None
        # Home covers when the margin beats the line; away covers when it doesn't.
        cushion = (margin - line) if wager["side"] == "home" else (line - margin)
        if cushion == 0:
            return 0.0
        won = cushion > 0
    else:  # moneyline
        if margin == 0:
            return 0.0  # tie -> push
        won = (margin > 0) if wager["side"] == "home" else (margin < 0)

    return (odds_math.american_to_decimal(wager["book_odds"]) - 1.0) if won else -1.0


def run_backtest(args: argparse.Namespace) -> pd.DataFrame:
    seasons = list(range(args.first_season, args.end + 1))
    ds = data_mod.load_dataset(seasons)
    rolled = feat.build_rolling_features(ds.team_game)
    matchups = feat.build_matchup_frame(ds.games, rolled)
    matchups = feat.attach_power_features(matchups, ds.games)
    matchups = feat.add_context_features(matchups)
    matchups = matchups[matchups["home_margin"].notna()]

    graded = []
    for season in range(args.start, args.end + 1):
        train = matchups[matchups["season"] < season]
        test = matchups[matchups["season"] == season]
        if args.week is not None:
            test = test[test["week"] == args.week]
        if len(train) < args.min_train or test.empty:
            continue

        model = train_margin_model(train)
        preds = model.predict_margin(test)
        for pred, (_, row) in zip(preds, test.iterrows()):
            analysis = edge_mod.analyze_game(row.to_dict(), float(pred), model.sigma)
            for wager in analysis["valueBets"]:
                profit = grade(wager, row)
                if profit is None:
                    continue
                graded.append({
                    "season": season, "week": row["week"], "market": wager["market"],
                    "edge": wager["edge"], "profit": profit, "push": profit == 0.0,
                })

    return pd.DataFrame(graded)


def _line(df: pd.DataFrame, label: str) -> None:
    """One row of the report, with a 95% CI so noise can't be read as skill.

    Betting results are extremely high-variance: a few hundred wagers simply
    cannot resolve a couple of percent of edge. Printing the interval next to the
    point estimate is what stops a lucky bucket from being mistaken for a system.
    """
    if df.empty:
        print(f"{label:<26} (no bets)")
        return
    decided = df[~df["push"]]
    win_pct = 100.0 * (decided["profit"] > 0).sum() / max(len(decided), 1)

    profit = df["profit"].to_numpy(dtype=float)
    roi = 100.0 * profit.mean()
    n = len(profit)
    stderr = (profit.std(ddof=1) / np.sqrt(n)) if n > 1 else float("nan")
    lo, hi = roi - 196.0 * stderr, roi + 196.0 * stderr  # 1.96 * 100
    verdict = "signif." if (lo > 0 or hi < 0) else "noise"
    print(f"{label:<26} bets {n:>5} | win% {win_pct:>5.1f} | ROI {roi:>+6.2f}% "
          f"| 95% CI [{lo:>+6.2f}%,{hi:>+6.2f}%] {verdict}")


def report(bt: pd.DataFrame, args: argparse.Namespace) -> None:
    scope = f"weeks: {args.week}" if args.week is not None else "all weeks"
    print(f"\nWalk-forward {args.start}-{args.end} ({scope}); each season is priced by a "
          f"model trained only on earlier seasons.\n")
    if bt.empty:
        print("No wagers were flagged in this window.")
        return

    _line(bt, "ALL flagged bets")
    _line(bt[bt["market"] == "spread"], "  spreads")
    _line(bt[bt["market"] == "moneyline"], "  moneylines")

    print("\nBy claimed edge — ROI should RISE with edge if the model has real skill:")
    for lo, hi in ((0.03, 0.06), (0.06, 0.10), (0.10, 0.20), (0.20, 1.01)):
        _line(bt[(bt["edge"] >= lo) & (bt["edge"] < hi)], f"  edge {lo:.0%}-{hi:.0%}")

    profit = bt["profit"].to_numpy(dtype=float)
    stderr = profit.std(ddof=1) / np.sqrt(len(profit))
    lo, hi = profit.mean() - 1.96 * stderr, profit.mean() + 1.96 * stderr
    print()
    if lo > 0:
        print("  Overall ROI is significantly POSITIVE — the rare case worth acting on.")
    elif hi < 0:
        print("  ⚠ Overall ROI is significantly NEGATIVE. This list loses money; do not bet it.")
    else:
        print("  ⚠ Overall ROI is statistically indistinguishable from break-even.\n"
              "    There is no evidence this beats the market — and none that it loses to it.\n"
              "    Do NOT tune the bet gate on the buckets above: at these sample sizes\n"
              "    they are noise, and fitting them is how a model gets fooled.")

    print(f"\nBreak-even at -110 juice is {BREAK_EVEN_PCT}% (ROI 0%). "
          "Sharp bettors live at ~53-55%.")


def main() -> int:
    args = parse_args()
    report(run_backtest(args), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
