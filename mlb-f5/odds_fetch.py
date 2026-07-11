"""
odds_fetch.py — F5 moneylines from OddsTrader into data/odds_YYYY-MM-DD.csv.
============================================================================
OddsTrader's odds microservice (GraphQL, discovered 2026-07-08) serves the
same lines as https://www.oddstrader.com/mlb/?g=first-half&m=money:

  1. GET /mlb/ page -> window.__INITIAL_STATE__ -> today's events (eid,
     participants with partid + team nickname) and sportsbook paids.
  2. GET odds-v2-service ?query={currentLines(eid:[...], mtid:91, paid:[...])}
     mtid 91 = MLB first-half (F5) moneyline. Empty without the paid filter.
  3. Consensus price per side = median decimal price across books -> American.

bet_team is the MODEL's lean: daily_run.run() is invoked lean-first and the
side with F5 conditional win prob > 0.5 becomes bet_team, so the engine then
grades its own lean against the market (edge/tier/divergence as usual).

Team matching: OddsTrader nickname ("Blue Jays") is matched inside the
statsapi team name ("Toronto Blue Jays") from data/schedule_today.json —
abbreviation conventions differ between the two sources, nicknames don't.

Usage: python3 odds_fetch.py   (after fetch_data.py; writes odds_<date>.csv)
"""
import csv
import json
import os
import re
import statistics

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PAGE = "https://www.oddstrader.com/mlb/"
SVC = "https://ms.virginia.us-east-1.oddstrader.com/odds-v2/odds-v2-service"
HDRS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Referer": PAGE, "Origin": "https://www.oddstrader.com"}
F5_MONEY_MTID = 91


def american(dec):
    if dec >= 2.0:
        return int(round((dec - 1) * 100))
    return -int(round(100 / (dec - 1)))


def ot_events():
    """eid -> {partid: nickname} plus the sportsbook paid list, from the page."""
    html = requests.get(PAGE, headers=HDRS, timeout=60).text
    i = html.find("window.__INITIAL_STATE__")
    if i < 0:
        raise RuntimeError("no __INITIAL_STATE__ on OddsTrader page")
    state, _ = json.JSONDecoder().raw_decode(html[html.find("{", i):])
    paids = [b["paid"] for b in state["sportsbooks"]["sportsbooks"] if b.get("paid")]
    events = {}
    for eid, e in state["events"]["events"].items():
        parts = {}
        for pid, p in e.get("participants", {}).items():
            src = p.get("source", {})
            if src.get("nn"):
                parts[int(pid)] = src["nn"]
        if len(parts) == 2:
            events[int(eid)] = parts
    return events, paids


def f5_lines(eids, paids):
    """(eid, partid) -> median-consensus American price across books."""
    q = (f'{{currentLines(eid:[{",".join(map(str, eids))}],'
         f'mtid:{F5_MONEY_MTID},paid:[{",".join(map(str, paids))}])}}')
    r = requests.get(SVC, params={"query": q}, headers=HDRS, timeout=60)
    r.raise_for_status()
    rows = r.json()["data"]["currentLines"]
    prices = {}
    for l in rows:
        if l.get("pri"):
            prices.setdefault((l["eid"], l["partid"]), []).append(float(l["pri"]))
    return {k: american(statistics.median(v)) for k, v in prices.items()}


def slate_games():
    """[(away_abbr, home_abbr, away_name, home_name)] from schedule_today.json."""
    with open(os.path.join(DATA, "schedule_today.json")) as f:
        sched = json.load(f)
    date = sched["dates"][0]["date"]
    games = []
    for g in sched["dates"][0]["games"]:
        if g["status"]["abstractGameState"] != "Preview":
            continue
        a, h = g["teams"]["away"]["team"], g["teams"]["home"]["team"]
        games.append((a["abbreviation"], h["abbreviation"], a["name"], h["name"]))
    return date, games


def model_leans():
    """game 'AAB@HAB' -> lean abbr (F5 conditional > 0.5), engine lean-first."""
    import sys
    sys.path.insert(0, HERE)
    from daily_run import run
    _, rows = run()
    leans = {}
    for game, rec, skip in rows:
        if rec:
            ca, ch = rec["cond"]
            leans[game] = rec["aab"] if ca > ch else rec["hab"]
    return leans


def main():
    date, games = slate_games()
    events, paids = ot_events()
    prices = f5_lines(list(events), paids)
    leans = model_leans()

    # Doubleheaders: the same matchup twice makes line->game matching ambiguous
    # (odds.csv and the engine key on away@home), so those games run lean-only.
    from collections import Counter
    dh = {k for k, n in Counter((a, h) for a, h, _, _ in games).items() if n > 1}

    out, missing = [], []
    for aab, hab, aname, hname in games:
        if (aab, hab) in dh:
            if f"{aab}@{hab}" not in [m[0] for m in missing]:
                missing.append((f"{aab}@{hab}", "doubleheader — ambiguous line matching, lean-only"))
            continue
        match = None
        for eid, parts in events.items():
            nns = list(parts.values())
            if (any(nn in aname for nn in nns) and any(nn in hname for nn in nns)
                    and not nns[0] == nns[1]):
                match = eid
                break
        lean = leans.get(f"{aab}@{hab}")
        if match is None or lean is None:
            missing.append((f"{aab}@{hab}", "no OT event" if match is None else "no model lean"))
            continue
        side = {}
        for pid, nn in events[match].items():
            ab = aab if nn in aname else hab
            ml = prices.get((match, pid))
            if ml is not None:
                side[ab] = ml
        if len(side) != 2:
            missing.append((f"{aab}@{hab}", "F5 line not posted"))
            continue
        opp = hab if lean == aab else aab
        out.append({"away": aab, "home": hab, "bet_team": lean,
                    "bet_ml": side[lean], "opp_ml": side[opp]})

    path = os.path.join(DATA, f"odds_{date}.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["away", "home", "bet_team", "bet_ml", "opp_ml"])
        w.writeheader()
        w.writerows(out)
    print(f"wrote {path}: {len(out)} games priced (consensus median, mtid {F5_MONEY_MTID})")
    for g, why in missing:
        print(f"[skip] {g} — {why}")


if __name__ == "__main__":
    main()
