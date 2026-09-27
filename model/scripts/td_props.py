#!/usr/bin/env python3
"""Anytime-touchdown scorer model -- BUILT, VALIDATED, AND NOT FIT TO BET.

Keep this file for the validation, not the predictions. It answers "can we
price anytime TD off the data we have?" and the answer is no, with numbers.

The construction is the standard one:

  1. Turn each team's implied total (from the market's spread + total) into an
     expected count of offensive touchdowns, using a fit on this season's own
     team-games: ``off_td = -0.236 + 0.0936 * points`` (R^2 0.58).
  2. Split that expectation across the team's players by a share that blends
     each player's observed touchdown share with his red-zone-weighted usage
     share, shrinking toward usage because three games of touchdowns is noise.
  3. ``P(anytime TD) = 1 - exp(-lambda)`` for that player's share of the count.

Why it fails, measured leave-one-game-out over 306 player-games:

  - Raw, the model is badly OVERCONFIDENT exactly where you would bet. The
    45%+ band predicts 60.3% and delivers 44.0% -- sixteen points hot. Overall
    calibration looks fine (21.5% vs 22.2%) but that is mechanical: shares sum
    to one, so the average is right by construction while the tails are wrong.
  - Flattening the shares (gamma < 1) and shrinking harder (k up to 40) cuts
    the top-band bias to +10.5% but no further, across an 18-point grid.
  - Recalibrating in logit space on the held-out predictions removes the bias
    and destroys the model: every player collapses to roughly 28%. The apparent
    ability to separate players WAS the overconfidence. Take it away and almost
    nothing is left -- Brier skill +0.07, and that figure is itself optimistic
    because the grid was chosen against the same validation data.

The root cause is data, not method. Three games per team, no snap counts, no
depth-chart position, no inactives list. Player roles are being inferred from a
handful of box scores, and a model cannot distinguish a goal-line back from a
committee back on that evidence.

What would make this work: several seasons of box scores rather than three
games, snap-share and route-participation data, and an inactives feed. Until
then the honest deliverables are the two descriptive things at the bottom --
implied team totals and red-zone touches per game -- which are facts rather
than forecasts.

Run:  python -m scripts.td_props --box output/box_scores.csv
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import oddstrader  # noqa: E402

# Chosen by the grid in ``_grid``; the best of a bad set, kept so the numbers in
# the docstring reproduce. Neither value rescues the top-band bias.
SHRINK_K = 40.0      # observed TD share is trusted as td/(td + K)
FLATTEN = 0.5        # shares are raised to this power, then renormalised
REDZONE_WEIGHT = 2.0  # a red-zone touch counts this much in the usage score


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="output/box_scores.csv",
                   help="Cached player box scores; fetched if absent.")
    p.add_argument("--projections", default="output/projections.csv")
    p.add_argument("--edges", default="output/nfl_edges.json")
    p.add_argument("--validate", action="store_true",
                   help="Run the leave-one-game-out calibration check and stop.")
    return p.parse_args()


def load_box(path: str, projections: pd.DataFrame) -> pd.DataFrame:
    """Player box scores for every completed game, cached to CSV."""
    if os.path.exists(path):
        box = pd.read_csv(path)
    else:
        eids = sorted({int(e) for e in projections.loc[
            projections["actual_margin"].notna(), "eid"]})
        parts = []
        for i in range(0, len(eids), 4):  # the feed 502s on large event lists
            try:
                parts.append(oddstrader.fetch_player_boxscore(eids[i:i + 4], timeout=90))
            except Exception as exc:
                print(f"[warn] box scores for {eids[i:i+4]} failed ({type(exc).__name__}).")
        box = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        if not box.empty:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            box.to_csv(path, index=False)
    box["value"] = pd.to_numeric(box["value"], errors="coerce")
    return box


def player_games(box: pd.DataFrame, projections: pd.DataFrame) -> pd.DataFrame:
    """One row per player-game with touchdowns and the usage behind them."""
    partid_to_team = {}
    for r in projections.itertuples():
        if pd.notna(r.home_partid):
            partid_to_team[int(r.home_partid)] = r.home
        if pd.notna(r.away_partid):
            partid_to_team[int(r.away_partid)] = r.away
    box = box.copy()
    box["team"] = box["team_partid"].map(partid_to_team)

    def stat(name: str, categories, out: str) -> pd.Series:
        sub = box[(box["stat"] == name) & (box["category"].isin(categories))]
        return sub.groupby(["eid", "pid", "player", "team"])["value"].sum().rename(out)

    # Offensive touchdowns only -- a kick return is not a scorer prop.
    frame = pd.concat([
        stat("touchdowns", ["rushing", "receiving"], "td"),
        stat("attempts", ["rushing"], "rush_att"),
        stat("targets", ["receiving"], "targets"),
        stat("redzone_attempts", ["rushing"], "rz_rush"),
        stat("redzone_targets", ["receiving"], "rz_tgt"),
    ], axis=1).fillna(0.0).reset_index()
    frame = frame[(frame["rush_att"] + frame["targets"]) > 0].copy()
    frame["usage"] = (frame["rush_att"] + frame["targets"]
                      + REDZONE_WEIGHT * (frame["rz_rush"] + frame["rz_tgt"]))
    return frame


def team_shares(games: pd.DataFrame) -> pd.Series:
    """Each player's share of his team's touchdowns, keyed by (pid, team).

    Observed touchdown share is what we want and cannot measure: at three games
    a single fluke score reads as the whole offence. So it is shrunk toward
    red-zone-weighted usage, which is far more stable, and the result flattened
    to pull the leaders back toward the field.
    """
    agg = games.groupby(["pid", "team"])[["td", "usage"]].sum().reset_index()
    agg["usage_share"] = agg.groupby("team")["usage"].transform(lambda s: s / s.sum())
    team_td = agg.groupby("team")["td"].transform("sum")
    observed = np.where(team_td > 0, agg["td"] / team_td, agg["usage_share"])
    weight = team_td / (team_td + SHRINK_K)
    share = (weight * observed + (1 - weight) * agg["usage_share"]) ** FLATTEN
    agg["share"] = share
    agg["share"] = agg.groupby("team")["share"].transform(lambda s: s / s.sum())
    return agg.set_index(["pid", "team"])["share"]


def points_to_touchdowns(games: pd.DataFrame, projections: pd.DataFrame):
    """Fit offensive touchdowns on points, from this season's own team-games."""
    per_team = games.groupby(["eid", "team"])["td"].sum().rename("off_td").reset_index()
    points = []
    for r in projections[projections["actual_margin"].notna()].itertuples():
        points.append({"eid": r.eid, "team": r.home, "pts": r.home_score})
        points.append({"eid": r.eid, "team": r.away, "pts": r.away_score})
    merged = per_team.merge(pd.DataFrame(points), on=["eid", "team"])
    slope, intercept = np.polyfit(merged["pts"], merged["off_td"], 1)
    r2 = np.corrcoef(merged["pts"], merged["off_td"])[0, 1] ** 2
    return float(intercept), float(slope), r2, len(merged)


def validate(games: pd.DataFrame) -> None:
    """Leave-one-game-out calibration -- the check that sank this model.

    A game's own result must not inform its prediction, so every held-out game
    is scored by shares rebuilt from the other games alone. Team touchdown
    counts are taken as ACTUAL, which isolates the share allocation: this is the
    most generous test available, and the allocation still fails it.
    """
    rows = []
    for eid in games["eid"].unique():
        shares = team_shares(games[games["eid"] != eid])
        held = games[games["eid"] == eid]
        for team in held["team"].unique():
            actual_td = held.loc[held["team"] == team, "td"].sum()
            for r in held[held["team"] == team].itertuples():
                share = shares.get((r.pid, team))
                if share is None or not np.isfinite(share):
                    continue
                lam = max(actual_td * share, 0.0)
                rows.append({"p": 1 - np.exp(-lam), "hit": int(r.td > 0)})

    v = pd.DataFrame(rows)
    base = v["hit"].mean()
    brier = ((v["p"] - v["hit"]) ** 2).mean()
    baseline = ((base - v["hit"]) ** 2).mean()
    print(f"\nLeave-one-game-out over {len(v)} player-games\n")
    print(f"{'predicted band':<18}{'n':>6}{'predicted':>11}{'actual':>9}")
    for lo, hi in [(0, .1), (.1, .2), (.2, .3), (.3, .45), (.45, 1.01)]:
        band = v[(v["p"] >= lo) & (v["p"] < hi)]
        if len(band) < 20:
            continue
        print(f"{f'{lo:.0%}-{hi:.0%}':<18}{len(band):>6}"
              f"{band['p'].mean()*100:>10.1f}%{band['hit'].mean()*100:>8.1f}%")
    top = v[v["p"] >= .45]
    print(f"\noverall predicted {v['p'].mean()*100:.1f}%  actual {base*100:.1f}%")
    print(f"Brier {brier:.4f} vs base rate {baseline:.4f} -> skill {1 - brier/baseline:+.3f}")
    if len(top) > 15:
        bias = (top['p'].mean() - top['hit'].mean()) * 100
        print(f"top band ({len(top)} picks): {bias:+.1f} pts of overconfidence")
        print("\nThat bias is the whole story. It dwarfs any edge worth betting,")
        print("and removing it by recalibration collapses every player to ~28%.")


def main() -> int:
    args = parse_args()
    projections = pd.read_csv(args.projections)
    box = load_box(args.box, projections)
    if box.empty:
        print("[error] no box scores available.")
        return 1
    games = player_games(box, projections)
    print(f"{len(games)} player-games from {games['eid'].nunique()} completed games.")

    intercept, slope, r2, n = points_to_touchdowns(games, projections)
    print(f"points -> offensive TDs: {intercept:+.3f} + {slope:.4f}*pts  "
          f"(R^2 {r2:.2f}, n={n})")

    if args.validate:
        validate(games)
        return 0

    with open(args.edges) as fh:
        slate = json.load(fh)
    expected = {}
    for g in slate["games"]:
        total, spread = g["market"].get("total"), g["market"].get("spreadLine")
        if total is None or spread is None:
            continue
        expected[g["home"]] = (intercept + slope * ((total + spread) / 2), g["away"])
        expected[g["away"]] = (intercept + slope * ((total - spread) / 2), g["home"])

    shares = team_shares(games)
    live = games.groupby(["pid", "player", "team"])[["td", "usage"]].sum().reset_index()
    live = live[live["team"].isin(expected)].copy()
    live["share"] = [shares.get((p, t), 0.0) for p, t in zip(live["pid"], live["team"])]
    live["lam"] = [expected[t][0] * s for t, s in zip(live["team"], live["share"])]
    live["prob"] = 1 - np.exp(-live["lam"].clip(lower=0))
    live["opp"] = live["team"].map(lambda t: expected[t][1])

    print("\n*** UNCALIBRATED. The 45%+ band runs ~10 pts hot out of sample. ***")
    print("*** Run --validate before believing any number below.          ***\n")
    print(f"{'PLAYER':<22}{'TM':<4}{'OPP':<5}{'P(TD)':>7}")
    for r in live.sort_values("prob", ascending=False).head(25).itertuples():
        print(f"{r.player:<22}{r.team:<4}{r.opp:<5}{r.prob*100:>6.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
