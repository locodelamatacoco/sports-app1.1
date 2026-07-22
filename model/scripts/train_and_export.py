#!/usr/bin/env python3
"""Train the margin model and export value bets for one slate of games.

Data sources are the ones reachable without special access:
  - training: real nflverse *schedules* (scores + closing lines), or ``--synthetic``
  - slate to price: a week from the training data (``--slate auto``), or the live
    ``--slate oddstrader`` board

Examples
--------
Real data, price the live OddsTrader slate (this season's upcoming week)::

    python -m scripts.train_and_export \
        --train-seasons 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 \
        --slate oddstrader --out output/nfl_edges.json

Offline demo on synthetic data (no downloads)::

    python -m scripts.train_and_export --synthetic --out output/nfl_edges.json

Run from the ``model/`` directory.
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

# Allow ``python scripts/train_and_export.py`` as well as ``-m``.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data as data_mod  # noqa: E402
from nfl_model import export as export_mod  # noqa: E402
from nfl_model import features as feat  # noqa: E402
from nfl_model.model import train_margin_model  # noqa: E402
from nfl_model.odds import format_american  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--train-seasons", type=int, nargs="+", default=[2021, 2022, 2023, 2024])
    p.add_argument("--predict-season", type=int, default=None,
                   help="Season of the slate to price (default: last train season).")
    p.add_argument("--predict-week", type=int, default=None,
                   help="Week of the slate to price (default: last week present).")
    p.add_argument("--synthetic", action="store_true",
                   help="Force the offline synthetic dataset instead of real schedules.")
    p.add_argument("--alpha", type=float, default=None, help="Fix Ridge alpha (default: auto-tune via CV).")
    p.add_argument("--seed", type=int, default=7, help="Synthetic-data seed.")
    p.add_argument("--out", type=str, default="output/nfl_edges.json", help="Output JSON path.")
    p.add_argument("--slate", choices=["auto", "oddstrader"], default="auto",
                   help="Where the games to PRICE come from. 'auto' uses a week from the "
                        "training data; 'oddstrader' scrapes the consensus slate + odds "
                        "from OddsTrader.")
    p.add_argument("--oddstrader-catid", type=int, default=506,
                   help="OddsTrader sportsbook category id (default 506, the public site's).")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    # 1. Load data (real schedules, or synthetic fallback/force).
    ds = data_mod.load_dataset(args.train_seasons, synthetic=args.synthetic, seed=args.seed)
    print(f"[1/5] Loaded {len(ds.games)} games / {len(ds.team_game)} team-games from {ds.source}.")

    # 2. Engineer leakage-safe rolling features and join onto games.
    rolled = feat.build_rolling_features(ds.team_game)
    matchups = feat.build_matchup_frame(ds.games, rolled)
    print(f"[2/5] Built matchup frame: {len(matchups)} rows, {len(feat.FEATURE_COLUMNS)} features.")

    # 3. Split into training games (played) and the slate to price.
    if args.slate == "oddstrader":
        slate, train, slate_source = _oddstrader_slate(args, rolled, matchups)
    else:
        slate, train, slate_source = _auto_slate(args, matchups)
    if slate is None:
        return 1
    print(f"[3/5] Training on {len(train)} games; pricing {len(slate)} games ({slate_source}).")

    # 4. Fit the Ridge margin model.
    model = train_margin_model(train, alpha=args.alpha)
    print(f"[4/5] Ridge fit: alpha={model.alpha:g}, sigma={model.sigma:.2f} pts, "
          f"train RMSE={model.train_rmse:.2f}, CV RMSE={model.cv_rmse:.2f}.")

    # 5. Price the slate and export.
    payload = export_mod.build_payload(model, slate, f"train:{ds.source} | slate:{slate_source}")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    export_mod.write_json(payload, args.out)
    print(f"[5/5] Wrote {payload['summary']['games']} games "
          f"({payload['summary']['valueBets']} value bets) -> {args.out}\n")

    _print_slate(payload)
    return 0


def _auto_slate(args, matchups):
    """Pick a week from the training data as the slate (offline-friendly)."""
    pred_season = args.predict_season or max(args.train_seasons)
    pred_week = args.predict_week
    if pred_week is None:
        pred_week = int(matchups.loc[matchups["season"] == pred_season, "week"].max())

    slate_mask = (matchups["season"] == pred_season) & (matchups["week"] == pred_week)
    slate = matchups[slate_mask].copy()
    if slate.empty:
        print(f"[error] No games found for {pred_season} week {pred_week}.")
        return None, None, None
    # Train only on games strictly before the slate to avoid leaking the future.
    train = matchups[
        ~slate_mask
        & matchups["home_margin"].notna()
        & ~((matchups["season"] == pred_season) & (matchups["week"] >= pred_week))
    ].copy()
    return slate, train, f"{pred_season} week {pred_week}"


def _oddstrader_slate(args, rolled, matchups):
    """Scrape the live OddsTrader NFL slate + consensus odds and attach ratings."""
    from nfl_model import oddstrader
    from nfl_model.features import build_slate_frame

    try:
        raw = oddstrader.fetch_oddstrader_slate(catid=args.oddstrader_catid)
    except Exception as exc:  # network blocked, HTML/schema drift, GraphQL change
        print(f"[error] Could not scrape OddsTrader ({type(exc).__name__}: {exc}).")
        print("        OddsTrader must be reachable from where this runs. This is an "
              "undocumented private API, so a failure may also mean their page or "
              "GraphQL schema changed.")
        return None, None, None

    if raw.empty:
        print("[error] OddsTrader returned no NFL games (off-week?).")
        return None, None, None

    priced = raw[raw["home_moneyline"].notna() | raw["spread_line"].notna()].copy()
    if priced.empty:
        print("[warn] OddsTrader games found but no odds posted yet for this slate.")
        return None, None, None

    slate = build_slate_frame(priced, rolled)
    train = matchups[matchups["home_margin"].notna()].copy()
    return slate, train, "OddsTrader (consensus)"


def _print_slate(payload: dict) -> None:
    """Readable console summary of the priced slate."""
    print(f"{'MATCHUP':<15}{'PROJ':>7}  {'SPREAD':>8}  {'HOME ML':>8}  BEST VALUE BET")
    print("-" * 72)
    for g in payload["games"]:
        proj = f"{g['projectedMargin']:+.1f}"
        spread = g["market"]["spreadLine"]
        spread_s = f"{spread:+g}" if spread is not None else "-"
        hml = g["market"]["homeMoneyline"]
        hml_s = format_american(hml) if hml is not None else "-"
        if g["bestBet"]:
            b = g["bestBet"]
            bet = f"{b['label']} {format_american(b['book_odds'])} (edge {b['edge']*100:+.1f}%, EV {b['ev']*100:+.1f}%)"
        else:
            bet = "— pass (no qualifying edge)"
        print(f"{g['away']+' @ '+g['home']:<15}{proj:>7}  {spread_s:>8}  {hml_s:>8}  {bet}")


if __name__ == "__main__":
    raise SystemExit(main())
