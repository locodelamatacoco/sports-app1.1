#!/usr/bin/env python3
"""Does play-level quarterback quality make the projections better?

Same discipline as eval_efficiency.py: both variants use the same ridge, the
same alpha search, the same walk-forward split and the same games. The only
difference is whether the two QB-quality features (see nfl_model/qb_quality.py)
are in the feature set. Scored on mean absolute error, paired per game, and
against the closing line -- the bar that matters.

    python -m scripts.eval_qb --start 2018 --end 2026
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data as data_mod  # noqa: E402
from nfl_model import features as feat  # noqa: E402
from nfl_model import qb_quality as qbq  # noqa: E402
from nfl_model.model import train_margin_model  # noqa: E402


def walk_forward(m: pd.DataFrame, cols: list, start: int, end: int) -> pd.DataFrame:
    rows = []
    for season in range(start, end + 1):
        train = m[(m["season"] < season) & m["home_margin"].notna()]
        test = m[(m["season"] == season) & m["home_margin"].notna() & m["spread_line"].notna()]
        test = test.dropna(subset=cols)
        if test.empty:
            continue
        model = train_margin_model(train, feature_columns=cols)
        pred = model.predict_margin(test)
        rows.append(pd.DataFrame({
            "game_id": test["game_id"].to_numpy(), "season": season,
            "pred": pred, "margin": test["home_margin"].to_numpy(),
            "line": test["spread_line"].to_numpy(),
            "qb_shift": (test["home_qb_delta"].abs() + test["away_qb_delta"].abs()).to_numpy(),
        }))
    out = pd.concat(rows, ignore_index=True)
    out["err"] = (out["pred"] - out["margin"]).abs()
    out["mkt_err"] = (out["line"] - out["margin"]).abs()
    return out


def ci(x: np.ndarray) -> str:
    se = x.std(ddof=1) / np.sqrt(len(x))
    return f"{x.mean():+.3f} [{x.mean() - 1.96 * se:+.3f}, {x.mean() + 1.96 * se:+.3f}]"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--first", type=int, default=2006)
    ap.add_argument("--start", type=int, default=2018)
    ap.add_argument("--end", type=int, default=2026)
    args = ap.parse_args()

    ds = data_mod.load_dataset(list(range(args.first, args.end + 1)))
    book = qbq.QbBook(qbq.load_qb_games(args.end))
    print(f"replacement prior: {book.prior:+.3f} EPA/play over first {qbq.ROOKIE_PLAYS:.0f} plays")

    rolled = feat.build_rolling_features(ds.team_game)
    m = feat.build_matchup_frame(ds.games, rolled)
    m = feat.attach_power_features(m, ds.games)
    m = feat.add_context_features(m)
    m = m.merge(ds.games[["game_id", "home_qb_id", "away_qb_id"]], on="game_id",
                how="left", suffixes=("", "_g"))
    for side in ("home", "away"):
        if f"{side}_qb_id" not in m.columns:
            m[f"{side}_qb_id"] = m[f"{side}_qb_id_g"]
    m = qbq.add_qb_features(m, ds.games, book)

    with_qb = list(feat.FEATURE_COLUMNS)
    base = [c for c in with_qb if c not in qbq.QB_COLUMNS]
    a = walk_forward(m, base, args.start, args.end).set_index("game_id")
    b = walk_forward(m, with_qb, args.start, args.end).set_index("game_id")
    shared = a.index.intersection(b.index)
    a, b = a.loc[shared], b.loc[shared]

    print(f"\nWalk-forward {args.start}-{args.end}, {len(shared)} games, identical model and games.\n")
    print(f"{'variant':<22}{'model MAE':>10}{'line MAE':>10}   gap to line, 95% CI")
    for label, f in (("current", a), ("+ QB quality", b)):
        print(f"{label:<22}{f['err'].mean():>10.3f}{f['mkt_err'].mean():>10.3f}   "
              f"{ci((f['err'] - f['mkt_err']).to_numpy())}")
    print(f"\nQB quality minus current, paired: {ci((b['err'] - a['err']).to_numpy())} pts")

    big = a["qb_shift"] >= 0.08
    print(f"\nGames where a starter differs sharply from his team's recent QBs "
          f"({int(big.sum())} games):")
    for label, f in (("current", a[big]), ("+ QB quality", b[big])):
        print(f"  {label:<20}{f['err'].mean():>10.3f}{f['mkt_err'].mean():>10.3f}   "
              f"{ci((f['err'] - f['mkt_err']).to_numpy())}")
    print(f"  paired improvement: {ci((b[big]['err'] - a[big]['err']).to_numpy())}")

    print("\nBy season (QB quality minus current, MAE):")
    for s, g in b.groupby("season"):
        d = g["err"] - a.loc[g.index, "err"]
        print(f"  {s}: {d.mean():+.3f}  ({len(g)} games)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
