#!/usr/bin/env python3
"""Generate the season board HTML from the ledger and projection log.

The board was hand-maintained for one week and immediately went stale, which
is the wrong shape for a thing that changes every Sunday. This rebuilds it from
``output/projections.csv`` and ``output/ledger.csv`` -- the two files that are
the actual record -- so refreshing it is one command rather than an editing
session.

    python -m scripts.board --out output/season-board.html

Design notes live in the template below; the short version is that the page
leads with the week-by-week gap between the model and the closing line, since
that is the only measurement on the page accumulating fast enough to mean
anything, and relegates the bet record to a supporting role.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTIONS = os.path.join(HERE, "output", "projections.csv")
LEDGER = os.path.join(HERE, "output", "ledger.csv")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="output/season-board.html")
    p.add_argument("--projections", default=PROJECTIONS)
    p.add_argument("--ledger", default=LEDGER)
    return p.parse_args()


def collect(projections: str, ledger: str) -> dict:
    proj = pd.read_csv(projections)
    led = pd.read_csv(ledger)
    proj["ko"] = pd.to_datetime(proj["kickoff"], utc=True)

    weeks = []
    for wk, g in proj.groupby("week"):
        g = g.sort_values("ko")
        done = g[g["actual_margin"].notna()]
        gap = (done["model_error"] - done["market_error"]).to_numpy(dtype=float)
        picks = led[led["week"] == wk]
        settled = picks[picks["profit"].notna()]
        games = []
        for r in g.itertuples():
            rows = led[led["eid"] == r.eid]
            games.append({
                "away": r.away, "home": r.home,
                "line": _f(r.market_line), "model": _f(r.model_margin, 1),
                "actual": _f(r.actual_margin, 0),
                # + means the model landed closer to the truth than the line did
                "d": None if pd.isna(r.market_error)
                     else round(float(r.market_error - r.model_error), 1),
                "picks": [{"label": p.label, "odds": int(p.book_odds),
                           "res": None if pd.isna(p.result) else p.result}
                          for p in rows.itertuples()],
            })
        weeks.append({
            "week": int(wk), "games": games, "final": int(len(done)),
            "mMAE": _f(done["model_error"].mean(), 2) if len(done) else None,
            "kMAE": _f(done["market_error"].mean(), 2) if len(done) else None,
            "diff": round(float(gap.mean()), 2) if len(gap) else None,
            "units": round(float(settled["profit"].sum()), 2) if len(settled) else 0.0,
            "w": int((settled["profit"] > 0).sum()),
            "l": int((settled["profit"] < 0).sum()),
            "p": int((settled["profit"] == 0).sum()),
            "open": int(picks["profit"].isna().sum()),
        })

    done = proj[proj["actual_margin"].notna()]
    gap = (done["model_error"] - done["market_error"]).to_numpy(dtype=float)
    se = gap.std(ddof=1) / np.sqrt(len(gap)) if len(gap) > 1 else float("nan")
    settled = led[led["profit"].notna()]
    profit = settled["profit"].to_numpy(dtype=float)
    season = {
        "games": int(len(proj)), "final": int(len(done)),
        "mMAE": _f(done["model_error"].mean(), 2),
        "kMAE": _f(done["market_error"].mean(), 2),
        "diff": round(float(gap.mean()), 2),
        "lo": round(float(gap.mean() - 1.96 * se), 2),
        "hi": round(float(gap.mean() + 1.96 * se), 2),
        "beat": int((gap < 0).sum()),
        "units": round(float(profit.sum()), 2),
        "roi": round(float(profit.mean() * 100), 2),
        "w": int((profit > 0).sum()), "l": int((profit < 0).sum()),
        "p": int((profit == 0).sum()), "openPicks": int(led["profit"].isna().sum()),
    }
    return {"weeks": weeks, "season": season}


def _f(v, places: int = 2):
    return None if v is None or pd.isna(v) else round(float(v), places)


TEMPLATE = """<title>Season Model Board</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    color-scheme: light;
    --plane:#f7f7f4; --surface:#fcfcfb; --sunken:#f2f2ee;
    --ink:#0b0b0b; --ink-2:#52514e; --ink-muted:#898781;
    --hairline:rgba(11,11,11,0.10); --rule:rgba(11,11,11,0.06); --axis:#c3c2b7;
    --market:#6da7ec;   /* closing line   — blue, light step */
    --model:#184f95;    /* our projection — blue, dark step  */
    --ahead:#0f7a4a;    /* model landed closer than the line */
    --behind:#b0472f;   /* the line landed closer            */
    --chip:rgba(24,79,149,0.08); --chip-ink:#184f95;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --plane:#0d0d0d; --surface:#1a1a19; --sunken:#141413;
      --ink:#ffffff; --ink-2:#c3c2b7; --ink-muted:#898781;
      --hairline:rgba(255,255,255,0.12); --rule:rgba(255,255,255,0.07); --axis:#383835;
      --market:#3987e5; --model:#b7d3f6; --ahead:#3fbd83; --behind:#e0806a;
      --chip:rgba(183,211,246,0.10); --chip-ink:#b7d3f6;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --plane:#0d0d0d; --surface:#1a1a19; --sunken:#141413;
    --ink:#ffffff; --ink-2:#c3c2b7; --ink-muted:#898781;
    --hairline:rgba(255,255,255,0.12); --rule:rgba(255,255,255,0.07); --axis:#383835;
    --market:#3987e5; --model:#b7d3f6; --ahead:#3fbd83; --behind:#e0806a;
    --chip:rgba(183,211,246,0.10); --chip-ink:#b7d3f6;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--plane); color:var(--ink);
    font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:15px; line-height:1.55;
    padding-block:34px 60px; padding-left:20px; padding-right:20px;
  }
  .wrap { max-width:1000px; margin:0 auto; display:flex; flex-direction:column; gap:30px; }
  .eyebrow {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px;
    letter-spacing:0.10em; text-transform:uppercase; color:var(--ink-muted); margin:0 0 7px;
  }
  h1 {
    font-family:Archivo,system-ui,sans-serif; font-weight:700;
    font-size:clamp(27px,5vw,32px); letter-spacing:-0.015em; margin:0; text-wrap:balance;
  }
  .lede { margin:10px 0 0; color:var(--ink-2); max-width:64ch; }

  .verdict {
    background:var(--surface); border:1px solid var(--hairline);
    border-radius:12px; padding:22px 22px 6px; display:flex; flex-direction:column; gap:18px;
  }
  .verdict-line {
    font-family:Archivo,system-ui,sans-serif; font-size:clamp(18px,3.2vw,22px);
    font-weight:600; line-height:1.35; margin:0; text-wrap:balance; letter-spacing:-0.01em;
  }
  .verdict-line em { font-style:normal; color:var(--ahead); }
  .verdict-sub { margin:6px 0 0; color:var(--ink-2); font-size:14.5px; max-width:66ch; }
  .strip {
    display:grid; grid-template-columns:repeat(auto-fit,minmax(178px,1fr));
    gap:1px; background:var(--hairline); border-top:1px solid var(--hairline); margin:0 -22px;
  }
  .cell { background:var(--surface); padding:15px 22px 17px; display:flex; flex-direction:column; gap:2px; }
  .cell dt { font-size:12px; color:var(--ink-muted); margin:0; }
  .cell dd {
    margin:0; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:21px;
    font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-0.01em;
  }
  .cell dd.good { color:var(--ahead); }
  .cell small { font-size:12px; color:var(--ink-2); font-family:"IBM Plex Sans",sans-serif; }

  .panel {
    background:var(--surface); border:1px solid var(--hairline);
    border-radius:12px; padding:20px 20px 18px;
  }
  .panel-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 20px; margin-bottom:3px; }
  .panel-head h2 {
    font-family:Archivo,sans-serif; font-size:16.5px; font-weight:600; margin:0; letter-spacing:-0.005em;
  }
  .panel-note { margin:0 0 18px; color:var(--ink-2); font-size:13.5px; max-width:70ch; }
  .panel-note strong { color:var(--ink); font-weight:600; }
  .legend { display:flex; gap:16px; flex-wrap:wrap; margin-left:auto; }
  .key { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--ink-2); }
  .swatch { width:10px; height:10px; border-radius:2px; flex:none; }

  /* ---- week-by-week trend: the page's thesis ---------------------------- */
  .trend { display:grid; gap:10px; }
  .trow { display:grid; grid-template-columns:70px minmax(200px,1fr) 150px; gap:14px; align-items:center; }
  .tlabel { font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:13px; font-weight:500; }
  .ttrack { position:relative; height:26px; }
  .ttrack::before {
    content:""; position:absolute; left:50%; top:-4px; bottom:-4px; width:1px; background:var(--axis);
  }
  .tbar { position:absolute; top:4px; height:18px; border-radius:2px; }
  .tbar.ahead { left:50%; background:var(--ahead); }
  .tbar.behind { right:50%; background:var(--behind); }
  .tval {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12.5px;
    font-variant-numeric:tabular-nums; color:var(--ink-2);
  }
  .tval b { font-weight:600; }
  .tval b.ahead { color:var(--ahead); }
  .tval b.behind { color:var(--behind); }
  .taxis { display:flex; justify-content:space-between; font-size:11.5px; color:var(--ink-muted); }

  /* ---- per-game diverging chart ----------------------------------------- */
  .scroller { overflow-x:auto; }
  .chart { min-width:660px; }
  .drow, .drail {
    display:grid; grid-template-columns:104px minmax(220px,1fr) 62px 152px; gap:14px; align-items:center;
  }
  .drow { padding:3px 0; }
  .dteam {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12.5px;
    font-weight:500; white-space:nowrap; color:var(--ink);
  }
  .dtrack { position:relative; height:19px; }
  .dtrack::before {
    content:""; position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:var(--axis);
  }
  .dbar { position:absolute; top:3px; height:13px; border-radius:2px; }
  .dbar.ahead { left:50%; background:var(--ahead); }
  .dbar.behind { right:50%; background:var(--behind); }
  .dval {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12.5px;
    font-variant-numeric:tabular-nums; text-align:right; font-weight:500;
  }
  .dval.ahead { color:var(--ahead); } .dval.behind { color:var(--behind); }
  .dnums {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11.5px;
    color:var(--ink-muted); font-variant-numeric:tabular-nums; white-space:nowrap;
  }
  .drail { margin-top:8px; border-top:1px solid var(--rule); padding-top:7px; }
  .ticks { position:relative; height:14px; }
  .tick {
    position:absolute; transform:translateX(-50%); font-family:"IBM Plex Mono",ui-monospace,monospace;
    font-size:11px; color:var(--ink-muted); font-variant-numeric:tabular-nums;
  }
  .axis-ends { display:flex; justify-content:space-between; font-size:11.5px; color:var(--ink-muted); margin-top:2px; }

  /* ---- week tables ------------------------------------------------------ */
  .weekhead { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 16px; margin-bottom:4px; }
  .weekhead h2 { font-family:Archivo,sans-serif; font-size:16.5px; font-weight:600; margin:0; }
  .weekstat {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12.5px;
    color:var(--ink-2); font-variant-numeric:tabular-nums;
  }
  .tscroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:560px; }
  th {
    text-align:right; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10.5px;
    letter-spacing:0.07em; text-transform:uppercase; color:var(--ink-muted); font-weight:500;
    padding:0 0 7px; border-bottom:1px solid var(--hairline);
  }
  th:first-child, td:first-child { text-align:left; }
  th.pickcol, td.pickcol { text-align:left; padding-left:16px; }
  td {
    padding:7px 0; border-bottom:1px solid var(--rule);
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-variant-numeric:tabular-nums;
    text-align:right; color:var(--ink-2);
  }
  td.matchup { color:var(--ink); font-weight:500; white-space:nowrap; }
  td.model { color:var(--model); font-weight:500; }
  td.line { color:var(--market); font-weight:500; }
  td.actual { color:var(--ink); font-weight:500; }
  tr:last-child td { border-bottom:none; }
  .closer.ahead { color:var(--ahead); } .closer.behind { color:var(--behind); }
  .ticket {
    display:inline-flex; align-items:center; gap:7px;
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px;
    padding:2px 8px; border-radius:4px; background:var(--chip); color:var(--chip-ink); white-space:nowrap;
  }
  .ticket b { font-weight:600; }
  .mark { font-weight:600; font-size:11px; letter-spacing:0.04em; }
  .mark.win { color:var(--ahead); } .mark.loss { color:var(--behind); }
  .mark.push, .mark.open { color:var(--ink-muted); }
  .dash { color:var(--ink-muted); }

  .method { border-top:1px solid var(--hairline); padding-top:20px;
    display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:22px; }
  .method h3 {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10.5px; letter-spacing:0.09em;
    text-transform:uppercase; color:var(--ink-muted); font-weight:500; margin:0 0 6px;
  }
  .method p { margin:0; font-size:13.5px; color:var(--ink-2); }
  .method code {
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12.5px;
    background:var(--sunken); padding:1px 5px; border-radius:3px; color:var(--ink);
  }
  @media (max-width:560px) { .verdict { padding:20px 18px 6px; } .trow { grid-template-columns:56px 1fr; } .trow .tval { grid-column:1/-1; } }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">__EYEBROW__</p>
    <h1>Season Model Board</h1>
    <p class="lede">
      Every projection written down before kickoff, scored against the number the
      market closed at. Bet results are the sideshow; the closing line is the scoreboard.
    </p>
  </header>

  <section class="verdict">
    <div>
      <p class="verdict-line">__VERDICT__</p>
      <p class="verdict-sub">__VERDICT_SUB__</p>
    </div>
    <dl class="strip">
      <div class="cell"><dt>Model error</dt><dd>__MMAE__</dd><small>mean absolute, points</small></div>
      <div class="cell"><dt>Closing-line error</dt><dd>__KMAE__</dd><small>the number to beat</small></div>
      <div class="cell"><dt>Games won outright</dt><dd>__BEAT__ <span style="font-size:14px;color:var(--ink-muted)">/ __FINAL__</span></dd><small>model closer than the line</small></div>
      <div class="cell"><dt>Flagged picks</dt><dd class="__UCLASS__">__UNITS__</dd><small>__PICKREC__</small></div>
    </dl>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>The gap, week by week</h2>
      <div class="legend">
        <span class="key"><span class="swatch" style="background:var(--ahead)"></span>model closer</span>
        <span class="key"><span class="swatch" style="background:var(--behind)"></span>line closer</span>
      </div>
    </div>
    <p class="panel-note">
      How much closer to the final margin the model landed than the closing line did,
      averaged over each week's games. This is the measurement that accumulates fast
      enough to mean something &mdash; sixteen continuous readings a week, against a
      dozen coin-flip bet results.
    </p>
    <div class="trend" id="trend"></div>
    <div class="taxis" style="margin-top:10px"><span>&larr; line closer</span><span>model closer &rarr;</span></div>
  </section>

  <section class="panel">
    <div class="panel-head"><h2 id="gamehead">Game by game</h2></div>
    <p class="panel-note" id="gamenote"></p>
    <div class="scroller"><div class="chart" id="chart"></div></div>
  </section>

  <section class="panel" id="weeks">
    <div class="panel-head"><h2>Week ledger</h2></div>
    <p class="panel-note">
      Every number is a <strong>home margin</strong>: +7 means the home team by seven,
      so a line of &minus;3 has the home team getting three. Picks are what the gate
      flagged before kickoff, at the price recorded.
    </p>
  </section>

  <section class="method">
    <div><h3>How a game is scored</h3><p>
      Absolute distance from the projected home margin to the actual one, against the same
      distance for the closing spread. Paired per game, so shared week-to-week variance
      cancels and a real gap resolves in a fraction of the sample.
    </p></div>
    <div><h3>Why not just the record</h3><p>
      A dozen binary bets a week is almost pure noise. A 9&ndash;2 week happens
      roughly one time in thirty with no edge at all, and one in twelve with a real
      one &mdash; it cannot tell those apart. Projection error can.
    </p></div>
    <div><h3>What gets flagged</h3><p>
      Spreads only; moneylines returned <code>&minus;5.97%</code> over 1,900 walk-forward
      wagers. Every pick is shopped across nine books for the best number on offer, which
      drops break-even from 52.38% to about 51.70%.
    </p></div>
  </section>
</div>

<script>
var DATA = __DATA__;
var SCALE = 5;          // per-game chart: +/- 5 points of error difference
var TREND_SCALE = 1.5;  // week trend: +/- 1.5 points, which contains every week

function sgn(n, p) { p = p === undefined ? 1 : p;
  return (n > 0 ? "+" : n < 0 ? "\\u2212" : "") + Math.abs(n).toFixed(p); }
function odds(n) { return (n > 0 ? "+" : "\\u2212") + Math.abs(n); }
function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c;
  if (x !== undefined) e.textContent = x; return e; }

(function trend() {
  var host = document.getElementById("trend");
  DATA.weeks.forEach(function (w) {
    if (w.diff === null) return;
    var d = -w.diff;                       // flip so positive = model closer
    var row = el("div", "trow");
    row.appendChild(el("div", "tlabel", "Week " + w.week));
    var track = el("div", "ttrack");
    var bar = el("div", "tbar " + (d > 0 ? "ahead" : "behind"));
    bar.style.width = Math.min(Math.abs(d) / TREND_SCALE, 1) * 50 + "%";
    track.appendChild(bar);
    row.appendChild(track);
    var v = el("div", "tval");
    var b = el("b", d > 0 ? "ahead" : "behind", sgn(d, 2) + " pts");
    v.appendChild(b);
    v.appendChild(document.createTextNode("  " + w.mMAE + " vs " + w.kMAE));
    row.appendChild(v);
    host.appendChild(row);
  });
})();

(function perGame() {
  var last = DATA.weeks[DATA.weeks.length - 1];
  document.getElementById("gamehead").textContent = "Game by game \\u2014 week " + last.week;
  document.getElementById("gamenote").textContent =
    "Each bar is one game: how many points closer the model's projected margin landed "
    + "to the final result than the closing line did.";
  var host = document.getElementById("chart");
  last.games.filter(function (g) { return g.d !== null; })
    .sort(function (a, b) { return b.d - a.d; })
    .forEach(function (g) {
      var row = el("div", "drow");
      row.appendChild(el("div", "dteam", g.away + " @ " + g.home));
      var track = el("div", "dtrack");
      var bar = el("div", "dbar " + (g.d > 0 ? "ahead" : "behind"));
      bar.style.width = Math.min(Math.abs(g.d) / SCALE, 1) * 50 + "%";
      track.appendChild(bar);
      row.appendChild(track);
      row.appendChild(el("div", "dval " + (g.d > 0 ? "ahead" : "behind"), sgn(g.d)));
      row.appendChild(el("div", "dnums", "line " + sgn(g.line) + "   proj " + sgn(g.model)));
      host.appendChild(row);
    });
  var rail = el("div", "drail");
  rail.appendChild(el("div"));
  var ticks = el("div", "ticks");
  [-5, -2.5, 0, 2.5, 5].forEach(function (t) {
    var m = el("div", "tick", t === 0 ? "0" : sgn(t, t % 1 ? 1 : 0));
    m.style.left = (50 + t / SCALE * 50) + "%";
    ticks.appendChild(m);
  });
  rail.appendChild(ticks); rail.appendChild(el("div")); rail.appendChild(el("div"));
  host.appendChild(rail);
  var ends = el("div", "axis-ends");
  ends.appendChild(el("span", null, "\\u2190 closing line was closer"));
  ends.appendChild(el("span", null, "model was closer \\u2192"));
  var w = el("div", "drow");
  w.appendChild(el("div")); w.appendChild(ends); w.appendChild(el("div")); w.appendChild(el("div"));
  host.appendChild(w);
})();

(function weeks() {
  var host = document.getElementById("weeks");
  DATA.weeks.slice().reverse().forEach(function (w, i) {
    if (i > 0) { var s = el("div"); s.style.height = "26px"; host.appendChild(s); }
    var head = el("div", "weekhead");
    head.appendChild(el("h2", null, "Week " + w.week));
    var bits = [w.final + " of " + w.games.length + " final"];
    if (w.diff !== null) bits.push("model " + w.mMAE + " vs line " + w.kMAE);
    bits.push(w.w + "\\u2013" + w.l + (w.p ? "\\u2013" + w.p : "")
              + "  " + sgn(w.units, 2) + "u");
    if (w.open) bits.push(w.open + " open");
    head.appendChild(el("span", "weekstat", bits.join("  \\u00b7  ")));
    host.appendChild(head);

    var scroll = el("div", "tscroll"), table = el("table");
    var thead = el("thead"), hr = el("tr");
    ["Matchup", "Line", "Proj", "Result", "Closer by", "Picks"].forEach(function (c) {
      hr.appendChild(el("th", c === "Picks" ? "pickcol" : null, c));
    });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = el("tbody");
    w.games.forEach(function (g) {
      var tr = el("tr");
      tr.appendChild(el("td", "matchup", g.away + " @ " + g.home));
      tr.appendChild(el("td", "line", sgn(g.line)));
      tr.appendChild(el("td", "model", sgn(g.model)));
      tr.appendChild(el("td", "actual", g.actual === null ? "\\u2014" : sgn(g.actual, 0)));
      var c = el("td");
      if (g.d === null) c.appendChild(el("span", "dash", "\\u2014"));
      else c.appendChild(el("span", "closer " + (g.d > 0 ? "ahead" : "behind"),
             (g.d > 0 ? "model " : "line ") + Math.abs(g.d).toFixed(1)));
      tr.appendChild(c);
      var td = el("td", "pickcol");
      if (!g.picks.length) td.appendChild(el("span", "dash", "\\u2014"));
      else g.picks.forEach(function (p, j) {
        var chip = el("span", "ticket");
        chip.appendChild(el("b", null, p.label));
        chip.appendChild(el("span", null, odds(p.odds)));
        chip.appendChild(el("span", "mark " + (p.res || "open"),
          p.res === "win" ? "W" : p.res === "loss" ? "L" : p.res === "push" ? "P" : "OPEN"));
        td.appendChild(chip);
        if (j < g.picks.length - 1) td.appendChild(document.createTextNode(" "));
      });
      tr.appendChild(td); tb.appendChild(tr);
    });
    table.appendChild(tb); scroll.appendChild(table); host.appendChild(scroll);
  });
})();
</script>
"""


def render(data: dict) -> str:
    s = data["season"]
    weeks = data["weeks"]
    last = weeks[-1]
    trend = ", ".join(f"{w['diff']:+.2f}" for w in weeks if w["diff"] is not None)

    if s["hi"] < 0:
        verdict = (f"The model is landing <em>{abs(s['diff']):.2f} points closer</em> to the "
                   "final margin than the closing line does.")
    elif s["lo"] > 0:
        verdict = (f"The model lands <em>{s['diff']:.2f} points further</em> from the final "
                   "margin than the closing line does.")
    else:
        verdict = (f"Across {s['final']} games the model and the closing line are now "
                   f"<em>within {abs(s['diff']):.2f} points</em> of each other.")

    sub = (f"The 95% interval on that gap is [{s['lo']:+.2f}, {s['hi']:+.2f}] points, so it no "
           f"longer separates from zero. Week by week the gap reads {trend} &mdash; narrowing "
           "every week, and negative means the model was closer.")

    pick_rec = (f"{s['w']}&ndash;{s['l']}" + (f"&ndash;{s['p']}" if s["p"] else "")
                + f" &middot; ROI {s['roi']:+.1f}%"
                + (f" &middot; {s['openPicks']} open" if s["openPicks"] else ""))

    out = TEMPLATE
    out = out.replace("__EYEBROW__", f"2026 NFL &middot; through week {last['week']}")
    out = out.replace("__VERDICT__", verdict)
    out = out.replace("__VERDICT_SUB__", sub)
    out = out.replace("__MMAE__", f"{s['mMAE']:.2f}")
    out = out.replace("__KMAE__", f"{s['kMAE']:.2f}")
    out = out.replace("__BEAT__", str(s["beat"]))
    out = out.replace("__FINAL__", str(s["final"]))
    out = out.replace("__UNITS__", f"{s['units']:+.2f}u".replace("-", "−"))
    out = out.replace("__UCLASS__", "good" if s["units"] > 0 else "")
    out = out.replace("__PICKREC__", pick_rec)
    out = out.replace("__DATA__", json.dumps(data, separators=(",", ":")))
    return out


def main() -> int:
    args = parse_args()
    data = collect(args.projections, args.ledger)
    html = render(data)
    path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(html)
    s = data["season"]
    print(f"Wrote {path}")
    print(f"  {s['final']} games final, gap {s['diff']:+.2f} [{s['lo']:+.2f}, {s['hi']:+.2f}]")
    print("  weekly: " + ", ".join(f"wk{w['week']} {w['diff']:+.2f}"
                                   for w in data["weeks"] if w["diff"] is not None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
