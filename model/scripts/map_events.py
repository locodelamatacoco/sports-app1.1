#!/usr/bin/env python3
"""Map OddsTrader event ids to nflverse games.

Box scores key on OddsTrader's event ids and numeric participant ids; the
schedule, the lines and every other table in this project key on nflverse
season/week/team. Nothing in the box-score payload carries a date or a team
name, so the two have to be joined through a manifest built separately.

Two facts make it cheap. Participant ids are stable team identifiers -- all 32
map to exactly one team and never change -- so a map built from one season
works for all of them. And the event-list endpoint returns a timestamp per
event, which gives the season (September to February, so January belongs to the
previous year) and, with the two teams, an exact row in the nflverse schedule.

    python -m scripts.map_events --seasons 2019 2020 2021 --out output/event_map.csv
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data as data_mod  # noqa: E402
from nfl_model import oddstrader  # noqa: E402

WINDOW_HOURS = 120


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seasons", type=int, nargs="+", required=True)
    p.add_argument("--weeks", type=int, default=22)
    p.add_argument("--projections", default="output/projections.csv")
    p.add_argument("--box", default="output/box_history.csv",
                   help="Box scores; their participant ids name the two teams.")
    p.add_argument("--out", default="output/event_map.csv")
    return p.parse_args()


def partid_to_team(projections_path: str) -> dict:
    """Participant id -> nflverse abbreviation, from any season's recorded games."""
    proj = pd.read_csv(projections_path)
    mapping = {}
    for r in proj.itertuples():
        for pid, team in ((r.home_partid, r.home), (r.away_partid, r.away)):
            if pd.notna(pid):
                mapping.setdefault(int(pid), set()).add(team)
    clashes = {k: v for k, v in mapping.items() if len(v) > 1}
    if clashes:
        raise ValueError(f"participant ids are not team-stable: {clashes}")
    return {k: next(iter(v)) for k, v in mapping.items()}


def collect_events(seasons, weeks: int) -> pd.DataFrame:
    rows = []
    for season in seasons:
        start = pd.Timestamp(f"{season}-09-01", tz="UTC")
        start += pd.Timedelta(days=(2 - start.dayofweek) % 7)
        for i in range(weeks):
            when = start + pd.Timedelta(weeks=i)
            try:
                ev = oddstrader.fetch_completed_events(
                    int(when.timestamp() * 1000), hours_range=WINDOW_HOURS)
            except Exception as exc:
                print(f"  [warn] {season} {when.date()}: {type(exc).__name__}")
                continue
            if len(ev):
                rows.append(ev)
    return pd.concat(rows, ignore_index=True).drop_duplicates("eid") if rows else pd.DataFrame()


def main() -> int:
    args = parse_args()
    events = collect_events(args.seasons, args.weeks)
    if events.empty:
        print("[error] no events returned.")
        return 1
    events["kickoff"] = pd.to_datetime(events["dt"], unit="ms", utc=True)
    # A season runs September to February, so January and February games belong
    # to the previous year's season -- the same rule the scraper uses.
    events["season"] = events["kickoff"].dt.year.where(
        events["kickoff"].dt.month >= 3, events["kickoff"].dt.year - 1)

    sched = pd.read_csv(data_mod.SCHEDULES_URL)
    sched = sched[["season", "week", "game_id", "home_team", "away_team"]].dropna()
    sched["season"] = sched["season"].astype(int)
    sched["pair"] = sched.apply(
        lambda r: tuple(sorted((r["home_team"], r["away_team"]))), axis=1)

    # Take the two teams from the BOX SCORE's participant ids, not from the
    # event description. "des" carries full names ("Kansas City Chiefs@Miami
    # Dolphins"), and substring-matching abbreviations against those misfires
    # badly -- "MIA" is inside "MIAMI" but "KC" is nowhere in "KANSAS CITY", so
    # only a quarter of events matched. Participant ids are exact.
    teams = partid_to_team(args.projections)
    box = pd.read_csv(args.box)
    by_event = (box[["eid", "team_partid"]].drop_duplicates()
                .groupby("eid")["team_partid"].apply(list))

    def pair_from_partids(eid):
        pids = by_event.get(eid)
        if not pids or len(pids) != 2:
            return None
        named = {teams.get(int(p)) for p in pids}
        return tuple(sorted(named)) if len(named) == 2 and None not in named else None

    events["pair"] = events["eid"].map(pair_from_partids)
    matched_pairs = events["pair"].notna().sum()
    print(f"{matched_pairs} of {len(events)} events have box scores with two known teams")
    merged = events.dropna(subset=["pair"]).merge(sched, on=["season", "pair"], how="inner")
    out = merged[["eid", "season", "week", "game_id", "home_team", "away_team", "kickoff"]]
    out = out.drop_duplicates("eid")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    out.to_csv(args.out, index=False)
    print(f"{len(events)} events seen, {len(out)} matched to a schedule row -> {args.out}")
    print(out.groupby("season").size().to_string())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
