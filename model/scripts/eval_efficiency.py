#!/usr/bin/env python3
"""Does box-score efficiency beat points as the model's team rating?

The model rates teams on POINTS scored and allowed, because the play-by-play
host that would give EPA is unreachable (see data.py). Points are noisy: they
carry field position, special teams and defensive scores, none of which say
much about how well a team actually moved the ball. Box scores give yards,
plays, red-zone work and interceptions -- most of what EPA would have given.

This asks whether that is worth anything, and refuses to answer it the easy
way. Both variants are fit and scored identically -- same ridge, same alpha
search, same rolling-feature machinery, same walk-forward split, and crucially
the same games -- so the only thing that differs is what feeds the team rating.
Scoring them on different game sets would compare two changes at once.

    python -m scripts.eval_efficiency --box output/box_history.csv \
        --events output/event_map.csv

The bar is what the whole project is measured against: mean absolute error
against the closing line, paired per game. Beating POINTS is necessary and not
sufficient -- the number that decides anything is whether the gap to the
closing line closes, because the market is what has to be beaten to make money.
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
from nfl_model.model import train_margin_model  # noqa: E402
from scripts.collect_box import team_game_efficiency  # noqa: E402
from scripts.map_events import partid_to_team  # noqa: E402

# A turnover is worth roughly four points, and a team runs about sixty plays a
# game, so charging half a yard per play per turnover puts the two on a
# comparable scale. This is a judgement call, not a fitted constant; it is
# deliberately crude because fitting it on the same data used to judge the
# result would be circular.
TURNOVER_YARDS_PER_PLAY = 0.5


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="output/box_history.csv")
    p.add_argument("--events", default="output/event_map.csv")
    p.add_argument("--projections", default="output/projections.csv")
    p.add_argument("--start", type=int, default=2025,
                   help="First season to score; earlier seasons train it.")
    p.add_argument("--end", type=int, default=2026)
    return p.parse_args()


def efficiency_team_game(box: pd.DataFrame, events: pd.DataFrame,
                         teams: dict) -> pd.DataFrame:
    """Build the team-game table the feature pipeline wants, from efficiency.

    ``build_rolling_features`` expects off_epa / def_epa / off_ypp / def_ypp per
    team-game. The points variant fills all four with points scored and allowed.
    Here they carry real efficiency: yards per play for and against, and the
    same adjusted for turnovers. Keeping the column names means nothing
    downstream changes, which is the whole point -- only the inputs differ.
    """
    eff = team_game_efficiency(box)
    eff["team"] = eff["team_partid"].map(lambda p: teams.get(int(p)))
    eff = eff.dropna(subset=["team"])

    # Pair each team-game with its opponent in the same game, for the defensive
    # side: what a team allowed is just what the other team gained.
    opp = eff[["eid", "team", "ypp", "turnovers"]].rename(columns={
        "team": "opp_team", "ypp": "opp_ypp", "turnovers": "opp_turnovers"})
    paired = eff.merge(opp, on="eid")
    paired = paired[paired["team"] != paired["opp_team"]]

    merged = paired.merge(events[["eid", "season", "week", "game_id"]], on="eid")
    return pd.DataFrame({
        "season": merged["season"], "week": merged["week"],
        "game_id": merged["game_id"], "team": merged["team"],
        "off_epa": merged["ypp"],
        "def_epa": merged["opp_ypp"],
        "off_ypp": merged["ypp"] - merged["turnovers"] * TURNOVER_YARDS_PER_PLAY,
        "def_ypp": merged["opp_ypp"] - merged["opp_turnovers"] * TURNOVER_YARDS_PER_PLAY,
    })


def walk_forward(matchups: pd.DataFrame, keep_ids: set, start: int, end: int) -> pd.DataFrame:
    """Score a feature set season by season, training only on the past.

    ``keep_ids`` restricts scoring to games both variants can price, so the
    comparison is paired on identical games.
    """
    rows = []
    for season in range(start, end + 1):
        train = matchups[(matchups["season"] < season) & matchups["home_margin"].notna()]
        test = matchups[(matchups["season"] == season)
                        & matchups["home_margin"].notna()
                        & matchups["spread_line"].notna()
                        & matchups["game_id"].isin(keep_ids)]
        if len(test) == 0 or len(train) < 200:
            continue
        model = train_margin_model(train)
        pred = model.predict_margin(test)
        rows.append(pd.DataFrame({
            "game_id": test["game_id"].to_numpy(),
            "season": test["season"].to_numpy(),
            "model_err": np.abs(pred - test["home_margin"].to_numpy()),
            "market_err": np.abs(test["spread_line"].to_numpy()
                                 - test["home_margin"].to_numpy()),
        }))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def summarise(frame: pd.DataFrame, label: str) -> np.ndarray:
    gap = (frame["model_err"] - frame["market_err"]).to_numpy(dtype=float)
    se = gap.std(ddof=1) / np.sqrt(len(gap))
    print(f"{label:<20}{len(frame):>7}{frame['model_err'].mean():>11.3f}"
          f"{frame['market_err'].mean():>11.3f}{gap.mean():>+9.3f}"
          f"   [{gap.mean()-1.96*se:+.3f}, {gap.mean()+1.96*se:+.3f}]")
    return gap


def main() -> int:
    args = parse_args()
    for path in (args.box, args.events):
        if not os.path.exists(path):
            print(f"[error] {path} not found.")
            return 1

    ds = data_mod.load_dataset(list(range(2015, args.end + 1)))
    events = pd.read_csv(args.events)
    teams = partid_to_team(args.projections)
    box = pd.read_csv(args.box)

    eff_tg = efficiency_team_game(box, events, teams)
    covered = set(eff_tg["game_id"])
    # Both teams must have survived, or the game has only half a rating.
    complete = {g for g, n in eff_tg.groupby("game_id").size().items() if n == 2}
    per_team_season = eff_tg.groupby(["season", "team"]).size()
    thin = int((per_team_season < 6).sum())
    print(f"box scores cover {len(complete)} complete games of {len(covered)} touched "
          f"({eff_tg['season'].min():.0f}-{eff_tg['season'].max():.0f})")
    print(f"team-seasons with fewer than 6 games of data: {thin} of {len(per_team_season)}")

    # A rolling team rating needs games to roll over. Below that, the features
    # are mostly league-prior fill and the model is rating nothing -- which
    # produces a confidently terrible number rather than an obviously broken
    # one, so refuse rather than report it. The first run of this hit exactly
    # that: 17.4 MAE against the points variant's 10.9, which looked like a
    # verdict on efficiency and was really a verdict on having no data.
    if thin > len(per_team_season) * 0.5:
        print("\n[refusing to compare] More than half the team-seasons have fewer")
        print("than six games of box-score data. Ratings built on that are noise,")
        print("and any comparison would measure coverage rather than efficiency.")
        return 1
    covered = complete

    def build(team_game: pd.DataFrame) -> pd.DataFrame:
        rolled = feat.build_rolling_features(team_game)
        m = feat.build_matchup_frame(ds.games, rolled)
        m = feat.attach_power_features(m, ds.games)
        return feat.add_context_features(m)

    points = build(ds.team_game)
    efficiency = build(eff_tg)

    # Only games BOTH can price, so the comparison is paired.
    scored_pts = walk_forward(points, covered, args.start, args.end)
    scored_eff = walk_forward(efficiency, covered, args.start, args.end)
    # Align strictly on game_id so the paired difference compares like with
    # like. Dropping duplicates first: a game_id appearing twice on one side
    # and once on the other silently misaligns the arrays.
    scored_pts = scored_pts.drop_duplicates("game_id")
    scored_eff = scored_eff.drop_duplicates("game_id")
    shared = sorted(set(scored_pts["game_id"]) & set(scored_eff["game_id"]))
    scored_pts = scored_pts.set_index("game_id").loc[shared].reset_index()
    scored_eff = scored_eff.set_index("game_id").loc[shared].reset_index()
    if len(shared) < 50:
        print(f"[error] only {len(shared)} shared games -- too few to judge.")
        return 1

    print("Walk-forward, identical model and games; only the team rating differs.\n")
    print(f"{'rating built from':<20}{'games':>7}{'model MAE':>11}{'line MAE':>11}"
          f"{'gap':>9}{'95% CI':>22}")
    gap_pts = summarise(scored_pts, "points (current)")
    gap_eff = summarise(scored_eff, "box efficiency")

    # Paired on the same games, so the difference carries far less variance
    # than the two intervals above would suggest on their own.
    diff = gap_eff - gap_pts
    se = diff.std(ddof=1) / np.sqrt(len(diff))
    lo, hi = diff.mean() - 1.96 * se, diff.mean() + 1.96 * se
    print(f"\nefficiency minus points, paired: {diff.mean():+.3f} pts "
          f"[{lo:+.3f}, {hi:+.3f}]")
    if hi < 0:
        print("-> efficiency is BETTER, and the interval clears zero.")
    elif lo > 0:
        print("-> efficiency is WORSE, and the interval clears zero.")
    else:
        print("-> no separation; this sample cannot tell them apart.")
    print(f"\n(for scale: the model's standing deficit to the closing line is "
          f"+0.40 pts\n over 2,038 games, so closing it needs a gain near that "
          f"size.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
