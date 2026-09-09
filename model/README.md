# NFL Spread & Moneyline Value Model

A small, honest Python model that projects NFL point margins with **Ridge
regression** and reads **both** betting markets off that single projection:

```
projected home margin  ──►  P(cover the spread)   (normal CDF vs the book line)
                       ──►  P(win the game)        (normal CDF vs zero) ──► moneyline
```

Then it compares those probabilities to the sportsbook's prices and flags the
wagers with a positive expected value (EV > 0). It's the football sibling of the
UFC Monte Carlo model in `src/models/ufcSimulator.js` — same idea (project an
outcome distribution once, price every market against it), and it reuses the
exact same American-odds math so the two models agree to the cent.

---

## Why one model, not two

The common advice is to build a regressor for spreads *and* a separate
classifier (logistic / random forest) for moneylines. Don't. A moneyline is
just a spread bet at a line of zero. If you model the **expected margin** plus
its uncertainty (NFL margins are ~normal with a standard deviation around
13–14 points), you get:

- **Spread edge:** `P(cover) = Φ((projMargin − spreadLine) / σ)`
- **Moneyline edge:** `P(win)  = Φ(projMargin / σ)`

One regression, both markets, and they can never contradict each other. Running
two independent models can hand you a moneyline pick that disagrees with your
own spread pick on the same game.

**Why Ridge and not Random Forest?** The NFL plays only ~272 games a season.
Tree ensembles overfit that little, noisy data. A standardized, L2-regularized
linear model degrades gracefully, is interpretable, and out of sample usually
wins on data this sparse.

---

## Quickstart

```bash
cd model
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt

# Offline demo — no downloads, uses the synthetic season generator:
python -m scripts.train_and_export --synthetic --out output/nfl_edges.json

# Run the tests:
pytest
```

**Real data** — train on real nflverse schedules (scores + closing lines) and
price the live OddsTrader slate:

```bash
python -m scripts.train_and_export \
    --train-seasons 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 \
    --slate oddstrader --out output/nfl_edges.json
```

Training data is the nflverse *schedules* CSV (real scores + real closing lines),
turned into a **points-margin power rating** — no API key, no extra package, just
`pandas.read_csv`. It's the default; `--synthetic` forces the offline generator.
A healthy sign it's working: the residual σ lands near the textbook NFL ~13.5 and
the projections hug the market instead of wandering.

**Live odds from OddsTrader.** The `--slate oddstrader` above scrapes the
consensus board from [oddstrader.com/nfl](https://www.oddstrader.com/nfl/).
OddsTrader has no public API, so this reads the game list from the page's
`window.__INITIAL_STATE__` and pulls prices from the `odds-v2-service` GraphQL
backend the site itself calls, taking the **median across books** as the
consensus line. See the caveat below — it's an undocumented private API.

Sample console output (synthetic):

```
[4/5] Ridge fit: alpha=10, sigma=14.09 pts, train RMSE=14.08, CV RMSE=14.21.
[5/5] Wrote 16 games (6 value bets) -> output/nfl_edges.json

MATCHUP           PROJ    SPREAD   HOME ML  BEST VALUE BET
------------------------------------------------------------------------
JAX @ DET         +0.8      -2.5      +112  DET +2.5 -110 (edge +6.7%, EV +12.9%)
WAS @ BAL        -13.9     -10.5      +280  WAS -10.5 -110 (edge +7.3%, EV +13.9%)
BUF @ NYJ         -0.6      -0.5      -113  — pass (no qualifying edge)
...
```

Notice the projections track the market closely and most games are a *pass* —
that's the point. On the efficient synthetic market (and on the real one) edges
are small and most of the slate offers no value.

---

## How it works

| Stage | File | What it does |
|-------|------|--------------|
| Load | `nfl_model/data.py` | Real nflverse schedules (scores + closing lines) → points-margin ratings; synthetic fallback if offline. |
| Live odds | `nfl_model/oddstrader.py` | Scrape the consensus slate + odds from OddsTrader's backend. |
| Features | `nfl_model/features.py` | Per-team rolling offense/defense ratings + game context, **leakage-safe**. |
| Ratings | `nfl_model/power.py` | Opponent-adjusted ridge power ratings for **teams and quarterbacks**, plus home-field advantage. |
| Model | `nfl_model/model.py` | Standardize → Ridge; alpha auto-tuned by time-series CV; measures residual σ. |
| Probabilities | `nfl_model/distribution.py` | Projected margin → cover prob + win prob via the normal CDF. |
| Edges | `nfl_model/edges.py` | Model prob vs book price → edge, EV, value-bet gate. |
| Export | `nfl_model/export.py` | JSON payload written alongside the CLI table. |

### Leakage safety (the thing that quietly ruins these models)

Every feature is a team's **season-to-date average entering that game** —
`expanding().mean().shift(1)` within each season. A rating for week N contains
nothing from week N onward. Training also excludes the slate being priced and
anything at/after its week. Get this wrong and your backtest looks amazing while
your real bets lose.

### Sign conventions (read this before trusting a number)

- `spread_line` follows **nflverse**: *positive means the home team is favored by
  that many points.* `spread_line = 3` ⇒ home is `-3`, away is `+3`.
- `projectedMargin` is from the **home** team's perspective: `+7` = home by 7.
- `home_margin` (training target) = `home_score − away_score`.

---

## Does it actually work? (Read this before betting anything)

**There is no evidence that it does.** `scripts/backtest.py` replays the model's
own edge list against real closing lines, walk-forward: each season is priced by
a model trained only on earlier seasons.

```bash
python -m scripts.backtest
```

Current result, 2012–2025, 3,954 flagged bets:

| slice | bets | win% | ROI | 95% CI | verdict |
|---|---|---|---|---|---|
| all | 3954 | 45.7% | −2.32% | [−5.91%, +1.27%] | noise |
| spreads | 2104 | 51.0% | −0.39% | [−4.52%, +3.73%] | noise |
| moneylines | 1850 | 39.8% | −4.50% | [−10.57%, +1.57%] | noise |

**Every slice straddles zero.** Betting results are brutally high-variance —
even ~4,000 wagers across 14 seasons cannot resolve a couple of points of edge.
The point estimate is negative; the honest reading is "indistinguishable from
break-even, with no demonstrated skill."

That is why the report prints a confidence interval on every line. **Do not tune
the bet gate on the edge buckets**: at these sample sizes they are noise, and
fitting them is exactly how a model gets fooled into looking profitable. Re-run
this after any change — a change that "finds more edges" without moving these
numbers has made the tool worse, not better.

For reference, the same backtest before opponent-adjusted ratings and QB
handling ran 42.6% / −5.57% ROI, so the modelling work below is real progress on
accuracy even though it does not add up to a demonstrated edge.

---

## Tracking live picks

The backtest says what the model *would have* done. The ledger says what it is
actually doing, on picks written down before kickoff — the one record that can't
be tuned after the fact.

```bash
# after pricing a slate
python -m scripts.train_and_export --slate oddstrader --out output/nfl_edges.json
python -m scripts.track record --picks output/nfl_edges.json

# any time after the games finish
python -m scripts.track grade
```

`record` freezes each pick's price at the moment it was taken and keys entries by
(event, market, side), so re-running it on the same slate never duplicates or
overwrites. `grade` pulls real finals from OddsTrader's per-quarter scores and
settles whatever is done — spreads on the cushion, moneylines on the winner, a
dead-on number as a push.

The report shows the running record **with a 95% CI**, the same discipline as the
backtest, and warns while the sample is under 100 bets. Expect the interval to be
uselessly wide for most of a season: a 17-week slate produces a couple hundred
bets, and that is nowhere near enough to separate a real edge from luck. The
ledger is for honesty, not for confirmation.

Use `--all-wagers` to record every priced wager rather than only the flagged
ones, which measures the bet gate itself: if flagged picks don't outperform the
ones it passed on, the gate is not doing anything.

---

## The honest caveats

1. **You're not beating the game — you're trying to beat the closing line.** The
   market is brutally efficient. Break-even at −110 juice is **52.38%**. Sharp
   bettors grind out ~53–55% and call it elite.
2. **Closing Line Value is the real scorecard**, not a given week's W/L (that's
   noise over small samples). Did you consistently bet a better number than
   where the line closed?
3. **Don't relearn Vegas.** The line is one of the best predictors that exists.
   Include it as a feature and you can't find value against it; exclude it (as we
   do) and you're competing head-on with it. That tension is the whole game.
4. **This is a learning/portfolio tool, not betting advice.** Same disclaimer the
   UFC page already carries.

---

## Getting real data

Training data comes straight from the nflverse **schedules** CSV — no package,
no key, just a URL `pandas` reads directly:

```python
import pandas as pd
games = pd.read_csv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")
```

It ships real scores **and** the **historical closing lines** (`spread_line`,
`home_moneyline`, `away_moneyline`) going back decades — both the training
target and what you measure edges against. `data.load_schedule_data` turns each
game's points scored/allowed into the team ratings the model rolls forward.

> A richer per-play / EPA feed (nflverse play-by-play) was intentionally left
> out: it's published only on a host this project can't reach. Schedules give
> real scores + real lines, which is enough for a scores-margin model.

---

## Reading the output

This is a standalone command-line tool — no app required. Each run does two
things:

1. **Prints the slate as a table** in your terminal (the main deliverable):

   ```
   MATCHUP           PROJ    SPREAD   HOME ML  BEST VALUE BET
   ------------------------------------------------------------------------
   JAX @ DET         +0.8      -2.5      +112  DET +2.5 -110 (edge +6.7%, EV +12.9%)
   WAS @ BAL        -13.9     -10.5      +280  WAS -10.5 -110 (edge +7.3%, EV +13.9%)
   BUF @ NYJ         -0.6      -0.5      -113  — pass (no qualifying edge)
   ```

2. **Writes the full detail as JSON** to `--out` (default `output/nfl_edges.json`)
   — every wager, edge, EV, and the model's coefficients. A committed reference
   sample lives at [`sample_output.json`](sample_output.json) so you can see the
   shape without running anything.

To refresh picks on a schedule, run the exporter from cron / a GitHub Action:

```bash
python -m scripts.train_and_export --slate oddstrader --out output/nfl_edges.json
```

### Where the live odds come from

- **OddsTrader ([oddstrader.com/nfl](https://www.oddstrader.com/nfl/), `--slate
  oddstrader`, built in).** Consensus of many books. There is **no public API**,
  so `oddstrader.py` reads the page's `window.__INITIAL_STATE__` for the game list
  and calls the site's own `odds-v2-service` GraphQL backend for prices (NFL
  market-type ids: money `83`, spread `401`, total `402`; category `506`). Because
  it's an undocumented private API, those ids / the state shape can change without
  notice and scraping may be against the site's terms — treat it as best-effort,
  cache results, and keep request rates low.
- **Want more books?** A sanctioned aggregator (e.g. The Odds API) slots in as
  another slate source next to `oddstrader.py` — build a `fetch_*_slate` that
  returns the same nflverse-schema columns and add a `--slate` branch.

---

## Half scores and player stats: unblocked

Both blockers are solved. The nflverse schedules carry only final scores and no
player rows — but OddsTrader's backend, already reachable for odds, serves both
for completed games on the same endpoint:

| need | call | shape |
|---|---|---|
| per-quarter scores | `scores(eid)` | one row per (participant, period): `pn`=quarter, `val`=points |
| player box scores | `statisticsByEvent(eids)` | `pid`, name, `idty`=category, `stat`, `val` |

`idty` is the stat category (`passing` / `rushing` / `receiving` / `defense` / …),
so a receiver's yards is `(idty='receiving', stat='yards')`. Verified live: a
single game returns 2,371 player-stat rows across 92 distinct stats.

Helpers are in `oddstrader.py`: `fetch_completed_events`, `fetch_period_scores`,
`half_scores` (folds quarters 1–2 into a first half, OT into the final only), and
`fetch_player_boxscore`. First-half market ids are `MTID_1H_MONEY` (91),
`MTID_1H_SPREAD` (397), `MTID_1H_TOTAL` (398).

This means a first-half model and a props model can now both be **built and
backtested** rather than assumed. Neither is built yet — and given what the
backtest showed for the full-game model, neither should be trusted until it has
been through `scripts/backtest.py` with confidence intervals.

---

## Natural next upgrades

- **Opponent-adjusted ratings.** Swap raw rolling point margins for an SRS /
  ridge power rating so a good number against three bad defenses isn't mistaken
  for signal.
- **The features the pros use.** Red-zone & third-down efficiency, turnover
  margin (regressed toward the mean — it's noisy), pace/pass-rate, QB adjustments
  for injuries, and weather for totals.
- **Calibration & backtest.** Check that "60%" bets actually hit ~60% (reliability
  curve), and backtest by Closing Line Value, not raw record.
- **Uncertainty per game.** A game-specific σ (bad weather, backup QB) instead of
  one league-wide number.
```
