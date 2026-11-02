#!/usr/bin/env python3
"""Render every game's simulated outcome distribution as one page.

The bet gate answers one narrow question per game: is there a wager here?
Most weeks the answer is no for most games, so the gate's output hides most of
what the model actually thinks. This page shows all of it -- every game's full
distribution of final margins, where the market's number sits inside it, and,
once games are played, where the final actually landed.

Two modes:

    # the upcoming slate, from the latest model run (written on every run)
    python -m scripts.sim_board --live output/nfl_edges.json

    # a played week, each final overlaid on its simulated distribution
    python -m scripts.sim_board --review 8

Review mode doubles as a calibration check anyone can read: if the simulated
distributions are honest, about eight in ten finals land inside each game's
80% band. Far fewer means the sims are too confident; far more means they are
too timid.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nfl_model import data as data_mod  # noqa: E402
from nfl_model import distribution as dist  # noqa: E402
from nfl_model import odds as odds_math  # noqa: E402
from nfl_model import simulation as sim  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTIONS = os.path.join(HERE, "output", "projections.csv")
LEDGER = os.path.join(HERE, "output", "ledger.csv")
EDGES = os.path.join(HERE, "output", "nfl_edges.json")
DEFAULT_OUT = os.path.join(HERE, "output", "game-sims.html")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--live", nargs="?", const=EDGES, default=None,
                      help="Render the upcoming slate from a model export.")
    mode.add_argument("--review", type=int, default=None, metavar="WEEK",
                      help="Render a played week with finals overlaid.")
    p.add_argument("--season", type=int, default=2026)
    p.add_argument("--out", default=DEFAULT_OUT)
    return p.parse_args()


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #
def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _final_percentile(pred: float, sigma: float, actual: float) -> float:
    """Where the final margin fell inside the game's simulated distribution."""
    d = sim.margin_distribution(pred, sigma)
    below = float(d.probs[d.margins < actual].sum())
    at = float(d.probs[d.margins == actual].sum())
    return below + 0.5 * at


def _sigma() -> float:
    try:
        with open(EDGES) as fh:
            return float(json.load(fh)["model"]["sigma"])
    except Exception:
        return dist.DEFAULT_MARGIN_SD


def _pick_rows(led: pd.DataFrame, eid) -> Optional[dict]:
    rows = led[led["eid"] == eid]
    if rows.empty:
        return None
    r = rows.iloc[0]
    return {"label": r["label"], "odds": int(r["book_odds"]),
            "result": None if pd.isna(r["result"]) else str(r["result"]),
            "profit": None if pd.isna(r["profit"]) else float(r["profit"])}


def live_games(path: str) -> tuple:
    with open(path) as fh:
        payload = json.load(fh)
    games = []
    for g in payload.get("games", []):
        s = g.get("sim")
        if not s:
            continue
        b = g.get("bestBet")
        games.append({
            "away": g["away"], "home": g["home"], "kickoff": g.get("kickoff"),
            "awayQb": g.get("awayQb"), "homeQb": g.get("homeQb"),
            "proj": g["projectedMargin"], "sim": s,
            "marketHomeWin": (g.get("market") or {}).get("noVigHomeWin"),
            "pick": ({"label": b["label"], "odds": int(b["book_odds"]),
                      "result": None, "profit": None} if b else None),
            "final": None,
        })
    weeks = sorted({g.get("week") for g in payload.get("games", []) if g.get("week")})
    return games, (int(weeks[0]) if weeks else None)


def review_games(season: int, week: int) -> list:
    proj = pd.read_csv(PROJECTIONS)
    proj = proj[(proj["season"] == season) & (proj["week"] == week)]
    if proj.empty:
        raise SystemExit(f"[error] no projections logged for {season} week {week}.")
    led = pd.read_csv(LEDGER) if os.path.exists(LEDGER) else pd.DataFrame(columns=["eid"])

    sched = pd.read_csv(data_mod.SCHEDULES_URL)
    sched = sched[(sched["season"] == season) & (sched["week"] == week)]
    sched = sched.set_index(["home_team", "away_team"])
    sigma = _sigma()

    games = []
    for r in proj.itertuples():
        row = sched.loc[(r.home, r.away)] if (r.home, r.away) in sched.index else None
        total = _num(row["total_line"]) if row is not None else None
        line = _num(r.market_line)
        profile = sim.game_profile(float(r.model_margin), sigma, line, total)

        market_home = None
        if row is not None:
            hml, aml = _num(row["home_moneyline"]), _num(row["away_moneyline"])
            if odds_math.is_valid_american(hml) and odds_math.is_valid_american(aml):
                market_home = odds_math.remove_vig(
                    [odds_math.american_to_prob(hml), odds_math.american_to_prob(aml)])[0]

        final = None
        if pd.notna(r.actual_margin):
            actual = float(r.actual_margin)
            final = {"home": int(r.home_score), "away": int(r.away_score),
                     "margin": actual,
                     "pct": _final_percentile(float(r.model_margin), sigma, actual),
                     "inside": bool(profile["p10"] <= actual <= profile["p90"])}

        games.append({
            "away": r.away, "home": r.home, "kickoff": r.kickoff,
            "awayQb": None if row is None else row.get("away_qb_name"),
            "homeQb": None if row is None else row.get("home_qb_name"),
            "proj": float(r.model_margin), "sim": profile,
            "marketHomeWin": market_home,
            "pick": _pick_rows(led, r.eid), "final": final,
        })
    return games


def summarise(games: list, review: bool) -> dict:
    out = {"games": len(games)}
    if review:
        done = [g for g in games if g["final"]]
        out["final"] = len(done)
        out["inside"] = sum(g["final"]["inside"] for g in done)
        out["expectedInside"] = round(0.8 * len(done))
        out["pickedWinner"] = sum(
            np.sign(g["proj"]) == np.sign(g["final"]["margin"])
            for g in done if g["final"]["margin"] != 0)
        # The same count for the market's favourite. The two disagree on the
        # outright winner in only a game or two a week, so the model's record
        # here is mostly the favourites' record -- show both, or it flatters.
        out["marketWinner"] = sum(
            np.sign(g["sim"].get("line") or 0) == np.sign(g["final"]["margin"])
            for g in done if g["final"]["margin"] != 0 and g["sim"].get("line"))
        picks = [g["pick"] for g in games if g["pick"]]
        out["picksW"] = sum(p["result"] == "win" for p in picks)
        out["picksL"] = sum(p["result"] == "loss" for p in picks)
        out["picksP"] = sum(p["result"] == "push" for p in picks)
        out["picksOpen"] = sum(p["result"] is None for p in picks)
    else:
        out["flagged"] = sum(1 for g in games if g["pick"])
        out["coinFlips"] = sum(1 for g in games if 0.4 <= g["sim"]["homeWin"] <= 0.6)
        if games:
            fav = max(games, key=lambda g: max(g["sim"]["homeWin"], g["sim"]["awayWin"]))
            home_fav = fav["sim"]["homeWin"] >= fav["sim"]["awayWin"]
            out["biggestFav"] = {
                "team": fav["home"] if home_fav else fav["away"],
                "prob": max(fav["sim"]["homeWin"], fav["sim"]["awayWin"])}
    return out


# --------------------------------------------------------------------------- #
# Page
# --------------------------------------------------------------------------- #
TEMPLATE = r"""<title>Game Sim Board</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  /* Layout: one row per game, read left to right as the matchup is written --
     away team's outcomes on the left, home team's on the right, the market's
     number splitting them. Same paper and type as the Season Model Board. */
  :root {
    color-scheme: light;
    --plane: #f7f7f4; --surface: #fcfcfb; --sunken: #f2f2ee;
    --ink: #0b0b0b; --ink-2: #52514e; --ink-muted: #898781;
    --hairline: rgba(11,11,11,0.10); --rule: rgba(11,11,11,0.06);
    --home: #2a78d6;      /* outcomes where the home side covers */
    --away: #eb6834;      /* outcomes where the away side covers */
    --push: #8a8983;      /* the margin that lands exactly on the number */
    --key: rgba(11,11,11,0.07);
    --win: #0f7a4a; --loss: #b0472f;
    --font-display: Archivo, system-ui, sans-serif;
    --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-data: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --plane: #0d0d0d; --surface: #1a1a19; --sunken: #141413;
      --ink: #f0efec; --ink-2: #c3c2b7; --ink-muted: #898781;
      --hairline: rgba(255,255,255,0.12); --rule: rgba(255,255,255,0.07);
      --home: #3987e5; --away: #d95926; --push: #6b6a64;
      --key: rgba(255,255,255,0.07);
      --win: #3fbd83; --loss: #e0806a;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --plane: #0d0d0d; --surface: #1a1a19; --sunken: #141413;
    --ink: #f0efec; --ink-2: #c3c2b7; --ink-muted: #898781;
    --hairline: rgba(255,255,255,0.12); --rule: rgba(255,255,255,0.07);
    --home: #3987e5; --away: #d95926; --push: #6b6a64;
    --key: rgba(255,255,255,0.07);
    --win: #3fbd83; --loss: #e0806a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--plane); color: var(--ink);
    font-family: var(--font-body); font-size: 15px; line-height: 1.5;
    padding-block: 32px 56px;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
  }
  .wrap { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
  .eyebrow {
    font-family: var(--font-data); font-size: 11px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink-muted); margin: 0 0 6px;
  }
  h1 { font-family: var(--font-display); font-weight: 700; font-size: clamp(26px, 5vw, 32px);
       letter-spacing: -0.015em; margin: 0; text-wrap: balance; }
  .lede { margin: 8px 0 0; color: var(--ink-2); max-width: 66ch; }

  .strip {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 1px; background: var(--hairline); border: 1px solid var(--hairline);
    border-radius: 10px; overflow: hidden;
  }
  .cell { background: var(--surface); padding: 13px 16px 15px; display: flex; flex-direction: column; gap: 2px; }
  .cell dt { font-size: 12px; color: var(--ink-muted); margin: 0; }
  .cell dd { margin: 0; font-family: var(--font-data); font-size: 20px; font-weight: 600;
             font-variant-numeric: tabular-nums; }
  .cell small { font-size: 12px; color: var(--ink-2); }

  .legend { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 12.5px; color: var(--ink-2);
            align-items: center; }
  .key { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 10px; height: 12px; border-radius: 2px; flex: none; }
  .mk { flex: none; }

  .games { display: flex; flex-direction: column; gap: 10px; }
  .game {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px;
    padding: 14px 16px; display: grid; gap: 10px 18px;
    grid-template-columns: 190px minmax(0, 1fr) 230px; align-items: center;
  }
  .info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .matchup { font-family: var(--font-display); font-weight: 600; font-size: 17px; letter-spacing: -0.005em; }
  .matchup .at { color: var(--ink-muted); font-weight: 600; padding: 0 3px; }
  .when, .qbs { font-size: 12.5px; color: var(--ink-2); }
  .qbs { color: var(--ink-muted); }
  .proj { font-family: var(--font-data); font-size: 12.5px; color: var(--ink-2); margin-top: 4px;
          font-variant-numeric: tabular-nums; }

  .chart { min-width: 0; position: relative; }
  .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .chart text { font-family: var(--font-data); font-size: 10.5px; fill: var(--ink-muted); }
  .chart .linelabel { fill: var(--ink); font-weight: 600; font-size: 11px; }
  .chart .hit { fill: transparent; cursor: crosshair; }
  .chart .hit:focus-visible { outline: none; fill: var(--key); }

  .stats { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px;
           font-size: 12.5px; align-items: baseline; }
  .stats dt { color: var(--ink-muted); margin: 0; white-space: nowrap; }
  .stats dd { margin: 0; font-family: var(--font-data); font-variant-numeric: tabular-nums;
              color: var(--ink); min-width: 0; }
  .stats dd .sub { color: var(--ink-muted); }
  .chip { display: inline-block; font-family: var(--font-data); font-size: 11px; font-weight: 600;
          padding: 1px 6px; border-radius: 4px; border: 1px solid var(--hairline);
          color: var(--ink-2); white-space: nowrap; }
  .chip.win { color: var(--win); border-color: currentColor; }
  .chip.loss { color: var(--loss); border-color: currentColor; }

  .tip {
    position: absolute; pointer-events: none; z-index: 5;
    background: var(--ink); color: var(--surface);
    font-family: var(--font-data); font-size: 11.5px; line-height: 1.35;
    padding: 5px 8px; border-radius: 5px; white-space: nowrap; transform: translate(-50%, -100%);
  }

  .notes { border-top: 1px solid var(--hairline); padding-top: 18px;
           display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
  .notes h3 { font-family: var(--font-data); font-size: 10.5px; letter-spacing: 0.09em;
              text-transform: uppercase; color: var(--ink-muted); font-weight: 500; margin: 0 0 6px; }
  .notes p { margin: 0; font-size: 13.5px; color: var(--ink-2); max-width: 60ch; }

  details.tbl { background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 12px 16px; }
  details.tbl summary { cursor: pointer; font-size: 13.5px; color: var(--ink-2); }
  details.tbl summary:focus-visible { outline: 2px solid var(--home); outline-offset: 3px; border-radius: 4px; }
  .tscroll { overflow-x: auto; margin-top: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 12.5px; }
  th { text-align: right; font-family: var(--font-data); font-size: 10.5px; letter-spacing: 0.07em;
       text-transform: uppercase; color: var(--ink-muted); font-weight: 500; padding: 0 8px 6px;
       border-bottom: 1px solid var(--hairline); }
  td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--rule);
       font-family: var(--font-data); font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; padding-left: 0; }

  @media (max-width: 900px) {
    .game { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .chart { grid-column: 1 / -1; grid-row: 2; }
  }
  @media (max-width: 560px) {
    .game { grid-template-columns: minmax(0, 1fr); }
    .chart { grid-row: auto; }
    /* The drawing shrinks to the screen, so its text would too: drop every
       other tick and set the rest in larger viewBox units to stay legible. */
    .chart .tick { font-size: 17px; }
    .chart .tick.odd { display: none; }
    .chart .linelabel { font-size: 17px; }
  }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow" id="eyebrow"></p>
    <h1>Game Sim Board</h1>
    <p class="lede" id="lede"></p>
  </header>

  <dl class="strip" id="strip"></dl>

  <div class="legend" aria-label="Chart key">
    <span class="key"><span class="sw" style="background:var(--away)"></span>away side covers</span>
    <span class="key"><span class="sw" style="background:var(--home)"></span>home side covers</span>
    <span class="key"><span class="sw" style="background:var(--push)"></span>push</span>
    <span class="key"><svg class="mk" width="12" height="14" aria-hidden="true"><line x1="6" y1="0" x2="6" y2="14" stroke="var(--ink)" stroke-width="2"/></svg>market line</span>
    <span class="key"><svg class="mk" width="12" height="12" aria-hidden="true"><path d="M6 1 L11 10 L1 10 Z" fill="var(--ink-2)"/></svg>model projection</span>
    <span class="key" id="finalkey"><svg class="mk" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--ink)"/></svg>final</span>
  </div>

  <section class="games" id="games" aria-label="Games"></section>

  <details class="tbl">
    <summary>All games as a table</summary>
    <div class="tscroll"><table id="tbl"></table></div>
  </details>

  <section class="notes">
    <div><h3>Reading a game</h3><p>Each bar is one final margin, and its height is how often the model
      expects that exact result. The market's number splits them: bars on the left of it are outcomes
      where the away side covers, bars on the right where the home side does.</p></div>
    <div><h3>Why 3 and 7 stand out</h3><p>Football scores are built from field goals and touchdowns,
      so finals pile up on 3 and 7. Over 3,134 games a margin of exactly 3 happened 15% of the time.
      That is why a spread of 3 pushes so often.</p></div>
    <div><h3>The 80% band</h3><p>The middle 80% of each game's outcomes. It is wide on purpose:
      a projected margin of 4 still leaves plenty of room for a two-touchdown swing either way.
      If the sims are honest, about eight in ten finals land inside it.</p></div>
  </section>
</div>

<script>
const DATA = __DATA__;
const SPAN = 35;

const W = 640, H = 128, PADX = 10, TOP = 18, BASE = 92;
const step = (W - 2 * PADX) / (2 * SPAN + 1);
const x = m => PADX + (m + SPAN + 0.5) * step;
const yMax = Math.max(...DATA.games.flatMap(g => g.sim.distribution.map(d => d[1])), 0.01);
const h = p => (p / yMax) * (BASE - TOP);

const pct = p => (p * 100).toFixed(0) + "%";
const side = (g, m) => m === 0 ? "tie" : (m > 0 ? g.home : g.away) + "+" + Math.abs(m);
const lineText = (g, L) => L === 0 ? "PK" :
  (L > 0 ? g.home + " −" + fmt(L) : g.away + " −" + fmt(-L));
const fmt = v => (Math.round(v * 2) / 2).toString().replace(/\.0$/, "");
const odds = o => (o > 0 ? "+" : "−") + Math.abs(o);
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
const div = (cls, text) => { const d = document.createElement("div"); if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text; return d; };

function header() {
  const s = DATA.summary, wk = DATA.week ? "Week " + DATA.week : "This week";
  document.getElementById("eyebrow").textContent =
    "2026 NFL · " + wk + (DATA.review ? " · results in" : " · upcoming");
  document.getElementById("lede").textContent = DATA.review
    ? "Every game from " + wk.toLowerCase() + ", run through the model's full outcome distribution, with each final marked where it actually landed."
    : "Every game on the slate, run through the model's full outcome distribution. The bet gate flags only a few; this shows what the model thinks about all of them.";
  document.getElementById("finalkey").hidden = !DATA.review;

  const cells = DATA.review ? [
    ["Games simulated", s.games, s.final + " final"],
    ["Finals inside the 80% band", s.inside + " of " + s.final, "honest sims put about " + s.expectedInside + " here"],
    ["Model's projected winner won", s.pickedWinner + " of " + s.final,
      "market favorite won " + s.marketWinner + ", straight up"],
    ["Flagged picks", s.picksW + "–" + s.picksL + (s.picksP ? "–" + s.picksP : ""),
      s.picksOpen ? s.picksOpen + " still open" : "all settled"],
  ] : [
    ["Games simulated", s.games, "every game on the slate"],
    ["Model flags", s.flagged, "games that clear the bet gate"],
    ["Coin flips", s.coinFlips, "neither side above 60% to win"],
    ["Biggest favorite", s.biggestFav ? s.biggestFav.team + " " + pct(s.biggestFav.prob) : "—", "to win outright"],
  ];
  const strip = document.getElementById("strip");
  for (const [t, v, sm] of cells) {
    const c = div("cell");
    const dt = document.createElement("dt"); dt.textContent = t;
    const dd = document.createElement("dd"); dd.textContent = v;
    const small = document.createElement("small"); small.textContent = sm;
    c.append(dt, dd, small); strip.append(c);
  }
}

function chart(g, host) {
  const svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
    "aria-label": g.away + " at " + g.home + " outcome distribution" });
  const s = g.sim, L = s.line;

  // Key numbers: faint guides at 3 and 7 either way, where finals pile up.
  for (const k of [-7, -3, 3, 7]) {
    svg.append(el("rect", { x: x(k) - step / 2, y: TOP, width: step, height: BASE - TOP, fill: "var(--key)" }));
  }
  for (const [m, p] of s.distribution) {
    const cls = L === undefined || L === null ? "home" : (m > L ? "home" : (m < L ? "away" : "push"));
    const bh = h(p), bw = Math.max(step - 2, 1);
    if (bh > 0.2) svg.append(el("rect", { x: x(m) - bw / 2, y: BASE - bh, width: bw, height: bh,
      rx: Math.min(1.5, bw / 2), fill: "var(--" + cls + ")" }));
  }
  svg.append(el("line", { x1: PADX, x2: W - PADX, y1: BASE, y2: BASE, stroke: "var(--hairline)", "stroke-width": 1 }));
  for (const t of [-28, -21, -14, -7, 0, 7, 14, 21, 28]) {
    svg.append(el("text", { x: x(t), y: BASE + 13, "text-anchor": "middle",
      class: Math.abs(t) % 14 === 7 ? "tick odd" : "tick" },
      t === 0 ? "0" : (t < 0 ? g.away + " " + (-t) : g.home + " " + t)));
  }
  if (L !== undefined && L !== null) {
    svg.append(el("line", { x1: x(L), x2: x(L), y1: TOP - 4, y2: BASE + 2, stroke: "var(--ink)", "stroke-width": 2 }));
    const right = L < SPAN - 8;
    svg.append(el("text", { x: x(L) + (right ? 5 : -5), y: TOP - 6, "text-anchor": right ? "start" : "end",
      class: "linelabel" }, lineText(g, L)));
  }
  const pm = Math.max(-SPAN, Math.min(SPAN, g.proj));
  svg.append(el("path", { d: `M${x(pm)} ${BASE + 18} l5 9 h-10 z`, fill: "var(--ink-2)" }));
  if (g.final) {
    const fm = Math.max(-SPAN, Math.min(SPAN, g.final.margin));
    svg.append(el("line", { x1: x(fm), x2: x(fm), y1: TOP, y2: BASE, stroke: "var(--ink)",
      "stroke-width": 1.25, "stroke-dasharray": "2 2" }));
    svg.append(el("circle", { cx: x(fm), cy: TOP, r: 4.5, fill: "var(--ink)",
      stroke: "var(--surface)", "stroke-width": 2 }));
  }

  // Hover: hit targets span the full plot height, wider than the bar itself.
  const tip = div("tip"); tip.hidden = true; host.append(tip);
  for (const [m, p] of s.distribution) {
    const hit = el("rect", { x: x(m) - step / 2, y: TOP, width: step, height: BASE - TOP + 2,
      class: "hit", tabindex: "-1" });
    const show = () => {
      const r = svg.getBoundingClientRect(), k = r.width / W;
      const covers = L === undefined || L === null ? "" :
        (m > L ? g.home + " covers" : m < L ? g.away + " covers" : "push");
      tip.textContent = (m === 0 ? "Tie" : (m > 0 ? g.home : g.away) + " by " + Math.abs(m)) +
        " — " + (p * 100).toFixed(1) + "%" + (covers ? " · " + covers : "");
      tip.style.left = (x(m) * k) + "px"; tip.style.top = ((BASE - h(p)) * k - 6) + "px";
      tip.hidden = false;
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
    svg.append(hit);
  }
  host.prepend(svg);
}

function stats(g) {
  const s = g.sim, dl = document.createElement("dl"); dl.className = "stats";
  const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); if (typeof v === "string") dd.textContent = v; else dd.append(v);
    dl.append(dt, dd); };
  const homeFav = s.homeWin >= s.awayWin;
  const winTxt = (homeFav ? g.home : g.away) + " " + pct(Math.max(s.homeWin, s.awayWin));
  if (g.marketHomeWin !== null && g.marketHomeWin !== undefined) {
    const f = document.createDocumentFragment(); f.append(winTxt + " ");
    const sub = document.createElement("span"); sub.className = "sub";
    sub.textContent = "mkt " + pct(homeFav ? g.marketHomeWin : 1 - g.marketHomeWin);
    f.append(sub); row("Win", f);
  } else row("Win", winTxt);
  if (s.homeCover !== undefined) {
    const hc = s.homeCover >= s.awayCover;
    row("Covers", (hc ? g.home : g.away) + " " + pct(Math.max(s.homeCover, s.awayCover)) +
        (s.push > 0.005 ? " · push " + pct(s.push) : ""));
  }
  row("80% band", side(g, s.p10) + " to " + side(g, s.p90));
  if (g.pick) {
    const f = document.createDocumentFragment();
    const c = document.createElement("span"); c.className = "chip" + (g.pick.result ? " " + g.pick.result : "");
    c.textContent = g.pick.label + " " + odds(g.pick.odds) +
      (g.pick.result ? " · " + g.pick.result.toUpperCase()[0] : "");
    f.append(c); row("Pick", f);
  }
  if (g.final) {
    const f = document.createDocumentFragment();
    f.append(side(g, g.final.margin) + " ");
    const sub = document.createElement("span"); sub.className = "sub";
    sub.textContent = (g.final.inside ? "inside band" : "outside band") + " · " +
      Math.round(g.final.pct * 100) + "th pct";
    f.append(sub); row("Final", f);
  }
  return dl;
}

function games() {
  const host = document.getElementById("games");
  for (const g of DATA.games) {
    const a = document.createElement("article"); a.className = "game";
    const info = div("info");
    const mu = div("matchup"); mu.append(g.away);
    const at = document.createElement("span"); at.className = "at"; at.textContent = "@"; mu.append(at, g.home);
    info.append(mu);
    if (g.kickoff) {
      const d = new Date(g.kickoff);
      info.append(div("when", d.toLocaleString("en-US", { timeZone: "America/New_York",
        weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET"));
    }
    if (g.awayQb || g.homeQb) info.append(div("qbs", (g.awayQb || "?") + " vs " + (g.homeQb || "?")));
    const s = g.sim;
    let pj = "Model " + side(g, Math.round(g.proj * 2) / 2);
    if (s.projHome !== undefined) pj += " · " + (s.projHome >= s.projAway
      ? g.home + " " + Math.round(s.projHome) + "–" + Math.round(s.projAway)
      : g.away + " " + Math.round(s.projAway) + "–" + Math.round(s.projHome));
    if (g.final) pj += "\nFinal " + (g.final.home >= g.final.away
      ? g.home + " " + g.final.home + "–" + g.final.away
      : g.away + " " + g.final.away + "–" + g.final.home);
    const p = div("proj"); p.style.whiteSpace = "pre-line"; p.textContent = pj; info.append(p);
    const c = div("chart"); chart(g, c);
    a.append(info, c, stats(g));
    host.append(a);
  }
}

function table() {
  const t = document.getElementById("tbl");
  const cols = ["Game", "Model", "Line", "Win", "Covers", "Push", "80% band"];
  if (DATA.review) cols.push("Final", "Pctile");
  const thead = document.createElement("thead"), tr = document.createElement("tr");
  for (const c of cols) { const th = document.createElement("th"); th.textContent = c; tr.append(th); }
  thead.append(tr); t.append(thead);
  const tb = document.createElement("tbody");
  for (const g of DATA.games) {
    const s = g.sim, r = document.createElement("tr");
    const homeFav = s.homeWin >= s.awayWin;
    const cells = [g.away + " @ " + g.home, side(g, Math.round(g.proj * 2) / 2),
      s.line === undefined ? "—" : lineText(g, s.line),
      (homeFav ? g.home : g.away) + " " + pct(Math.max(s.homeWin, s.awayWin)),
      s.homeCover === undefined ? "—" : (s.homeCover >= s.awayCover ? g.home : g.away) + " " +
        pct(Math.max(s.homeCover, s.awayCover)),
      s.push === undefined ? "—" : pct(s.push), side(g, s.p10) + " to " + side(g, s.p90)];
    if (DATA.review) cells.push(g.final ? side(g, g.final.margin) : "—",
      g.final ? Math.round(g.final.pct * 100) + "" : "—");
    for (const v of cells) { const td = document.createElement("td"); td.textContent = v; r.append(td); }
    tb.append(r);
  }
  t.append(tb);
}

header(); games(); table();
</script>
"""


def render(games: list, week: Optional[int], review: bool) -> str:
    games = sorted(games, key=lambda g: (g.get("kickoff") or "", g["away"]))
    data = {"week": week, "review": review, "games": games,
            "summary": summarise(games, review)}
    return TEMPLATE.replace("__DATA__", json.dumps(data, default=_json_default,
                                                   separators=(",", ":")))


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return str(o)


def write(path: str, html: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(html)


def main() -> int:
    args = parse_args()
    if args.review is not None:
        games = review_games(args.season, args.review)
        html, week, review = render(games, args.review, True), args.review, True
    else:
        games, week = live_games(args.live or EDGES)
        html, review = render(games, week, False), False
    write(args.out, html)
    print(f"Wrote {args.out}: {len(games)} games, week {week}, "
          f"{'review' if review else 'live'} mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
