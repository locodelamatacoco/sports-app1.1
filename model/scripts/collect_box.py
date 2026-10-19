#!/usr/bin/env python3
"""Pull historical player box scores and fold them into team-game efficiency.

Why this exists: the model rates teams on POINTS, because the play-by-play
host that would give EPA is unreachable from here (see data.py). Points are a
noisy proxy -- they carry field position, special teams and defensive scores,
none of which say much about how well an offence moved the ball. The box-score
endpoint reaches back to 2019 and carries yards, plays, turnovers and red-zone
work, which is most of what EPA would have given us.

This script collects that data. Whether it actually helps is a separate
question, answered by ``scripts/eval_efficiency.py``; collect first, judge
after, and do not wire it into the model until it has beaten the points proxy
walk-forward.

    python -m scripts.collect_box --seasons 2024 2025 --out output/box_history.csv

The feed 502s on large event lists, so games are fetched a few at a time with
backoff. Partial progress is written as it goes: a run that dies halfway leaves
a usable file and can be resumed.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import oddstrader  # noqa: E402

# NFL weeks run Thursday to Monday; a 120-hour window from Wednesday catches a
# full week without needing to know the schedule.
WINDOW_HOURS = 120
# A single game is roughly 2,300 box-score rows, and the endpoint truncates at
# its row limit rather than erroring. Fetching four games against the 8,000-row
# default silently returned partial games: 74% of team-games came back missing
# a whole category, which showed up downstream as teams gaining yards on no
# plays. The limit is what truncates, not the batch size, so raise the limit and
# batch six -- about 13,800 rows, well inside it, and three times the throughput.
CHUNK = 6
ROW_LIMIT = 20000
MAX_RETRIES = 3


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seasons", type=int, nargs="+", required=True)
    p.add_argument("--out", default="output/box_history.csv")
    p.add_argument("--weeks", type=int, default=18)
    return p.parse_args()


def season_wednesdays(season: int, weeks: int):
    """Wednesday before each week-1 game, then weekly. Close enough to walk."""
    # The season opens the Thursday after Labor Day; the first Wednesday of
    # September is always within a few days of it, and a 120-hour window is
    # forgiving enough that being a day early costs nothing.
    start = pd.Timestamp(f"{season}-09-01", tz="UTC")
    start += pd.Timedelta(days=(2 - start.dayofweek) % 7)  # roll to Wednesday
    for i in range(weeks):
        yield start + pd.Timedelta(weeks=i)


def collect(seasons, weeks: int, out: str) -> pd.DataFrame:
    done_eids = set()
    frames = []
    if os.path.exists(out):
        prior = pd.read_csv(out)
        frames.append(prior)
        done_eids = set(prior["eid"].unique())
        print(f"resuming: {len(done_eids)} games already collected")

    for season in seasons:
        eids = []
        for wednesday in season_wednesdays(season, weeks):
            ms = int(wednesday.timestamp() * 1000)
            try:
                ev = oddstrader.fetch_completed_events(ms, hours_range=WINDOW_HOURS)
            except Exception as exc:
                print(f"  [warn] {season} {wednesday.date()}: {type(exc).__name__}")
                continue
            if len(ev):
                eids.extend(int(e) for e in ev["eid"])
        eids = sorted(set(eids) - done_eids)
        print(f"{season}: {len(eids)} new games to fetch")

        for i in range(0, len(eids), CHUNK):
            chunk = eids[i:i + CHUNK]
            for attempt in range(MAX_RETRIES):
                try:
                    frames.append(oddstrader.fetch_player_boxscore(chunk, timeout=90, limit=ROW_LIMIT))
                    break
                except Exception as exc:
                    if attempt == MAX_RETRIES - 1:
                        print(f"  [skip] {chunk}: {type(exc).__name__}")
                    else:
                        time.sleep(2 * (attempt + 1))
            if (i // CHUNK) % 10 == 0 and frames:
                pd.concat(frames, ignore_index=True).to_csv(out, index=False)

    box = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not box.empty:
        box = box.drop_duplicates()
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        box.to_csv(out, index=False)
    return box


# --------------------------------------------------------------------------- #
# Box score -> team-game efficiency
# --------------------------------------------------------------------------- #
def team_game_efficiency(box: pd.DataFrame) -> pd.DataFrame:
    """Aggregate player rows into one row per team-game.

    The columns here are the ones points cannot see: how far the offence moved
    the ball per snap, how often it gave the ball away, and how well it finished
    once inside the twenty. A team can score 30 on three short fields and a
    return touchdown; these say whether it actually played well.
    """
    box = box.copy()
    box["value"] = pd.to_numeric(box["value"], errors="coerce")

    def total(stat: str, categories) -> pd.Series:
        sub = box[(box["stat"] == stat) & (box["category"].isin(categories))]
        return sub.groupby(["eid", "team_partid"])["value"].sum()

    pass_yards = total("yards", ["passing"])
    rush_yards = total("yards", ["rushing"])
    pass_att = total("attempts", ["passing"])
    rush_att = total("attempts", ["rushing"])
    sacks = total("sacks", ["passing"])
    interceptions = total("interceptions", ["passing"])
    # No clean "fumbles lost" exists on this feed. "tlost" looked like it, and
    # is not: it is rushing tackled-for-loss, averaging 2.45 a team-game, which
    # inflated turnovers to 3.19 against a true NFL rate near 1.5. The fumble
    # stats present (forced_fumbles, fumble_recoveries) are the DEFENCE's, so
    # they describe the other team. Interceptions thrown is the clean half of
    # turnover margin; take that and leave the rest out rather than guess.
    rz_rush = total("redzone_attempts", ["rushing"])
    rz_tgt = total("redzone_targets", ["receiving"])
    tds = total("touchdowns", ["rushing", "receiving"])

    df = pd.concat({
        "pass_yards": pass_yards, "rush_yards": rush_yards,
        "pass_att": pass_att, "rush_att": rush_att, "sacks": sacks,
        "interceptions": interceptions,
        "rz_rush": rz_rush, "rz_tgt": rz_tgt, "off_td": tds,
    }, axis=1).fillna(0.0).reset_index()

    plays = df["pass_att"] + df["rush_att"] + df["sacks"]
    df["yards"] = df["pass_yards"] + df["rush_yards"]
    df["plays"] = plays
    # A team-game is only usable if both halves of the offence are actually
    # recorded. Some games come back with one category missing, which silently
    # produced a team that gained yards on no plays -- the first pass at this
    # reported a mean 12.6 yards per play against a true value near 5.5, and a
    # maximum of 305. Drop those rather than let them into a rating.
    complete = (df["pass_att"] > 0) & (df["rush_att"] > 0) & (plays >= 30)
    dropped = int((~complete).sum())
    if dropped:
        print(f"  [box] dropping {dropped} of {len(df)} team-games with incomplete stats")
    df = df[complete].copy()
    plays = df["plays"]

    # Yards per play is the headline efficiency number points cannot express.
    df["ypp"] = df["yards"] / plays
    df["turnovers"] = df["interceptions"]
    df["rz_trips"] = df["rz_rush"] + df["rz_tgt"]
    # Red-zone finishing: touchdowns per trip inside the twenty. Undefined with
    # no trips, which is a real state and not a zero.
    df["rz_td_rate"] = df["off_td"] / df["rz_trips"].where(df["rz_trips"] > 0)
    df["sack_rate"] = df["sacks"] / plays
    return df.reset_index(drop=True)


def main() -> int:
    args = parse_args()
    box = collect(args.seasons, args.weeks, args.out)
    if box.empty:
        print("[error] nothing collected.")
        return 1
    print(f"\n{len(box)} box-score rows across {box['eid'].nunique()} games -> {args.out}")
    eff = team_game_efficiency(box)
    eff_path = args.out.replace(".csv", "_team.csv")
    eff.to_csv(eff_path, index=False)
    print(f"{len(eff)} team-games -> {eff_path}")
    print(eff[["ypp", "turnovers", "rz_td_rate", "sack_rate"]].describe().round(3).to_string())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
