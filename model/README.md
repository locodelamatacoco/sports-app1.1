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

Real data (needs `nfl_data_py` + network) — train on four seasons, price week 5:

```bash
python -m scripts.train_and_export \
    --train-seasons 2021 2022 2023 2024 \
    --predict-season 2024 --predict-week 5 \
    --out output/nfl_edges.json
```

**Live odds from ESPN** — train on history, then price the *actual upcoming
slate* using moneylines/spreads pulled straight from ESPN (`--slate espn`):

```bash
# current week, whatever book ESPN lists first
python -m scripts.train_and_export --slate espn --out output/nfl_edges.json

# a specific week, preferring a named book
python -m scripts.train_and_export --slate espn \
    --espn-year 2025 --espn-week 3 --espn-provider "ESPN BET"
```

This hits `site.api.espn.com/.../nfl/scoreboard` — the same key-free endpoint
`ScoresPage` already uses, and the data behind
[espn.com/nfl/odds](https://www.espn.com/nfl/odds). Each team's *latest* rolling
rating is attached to the upcoming games (they have no historical row yet), then
the model prices them. ESPN must be reachable from wherever you run this.

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
| Load | `nfl_model/data.py` | Real play-by-play + schedules via `nfl_data_py`; synthetic fallback if offline. |
| Live odds | `nfl_model/espn.py` | Grab this week's games + moneylines/spreads from ESPN's public API. |
| Features | `nfl_model/features.py` | Per-team rolling EPA/YPP (offense & defense), **leakage-safe**. |
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

[`nfl_data_py`](https://github.com/nflverse/nfl_data_py) (successor:
[`nflreadpy`](https://github.com/nflverse/nflreadpy)) hands you almost everything
for free:

```python
import nfl_data_py as nfl
pbp   = nfl.import_pbp_data([2021, 2022, 2023, 2024])  # EPA per play, precomputed
games = nfl.import_schedules([2024])                    # results + spread_line + moneylines
```

`import_schedules` ships the **historical betting lines** (`spread_line`,
`home_moneyline`, `away_moneyline`, spread odds) — that's both your training
target's benchmark and what you measure edges against.

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
python -m scripts.train_and_export --slate espn --espn-week <week> \
    --out output/nfl_edges.json
```

### Where the live odds come from

- **ESPN (`nfl_model/espn.py`, built in).** Key-free public API, and it's the
  data behind [espn.com/nfl/odds](https://www.espn.com/nfl/odds). Run the exporter
  with `--slate espn` and you're pricing real games. This is the recommended,
  sanctioned path.
- **OddsTrader ([oddstrader.com/nfl](https://www.oddstrader.com/nfl/)).** Nice for
  comparing many books at once, but there is **no public API** — pulling it means
  scraping HTML / undocumented endpoints, which is brittle and usually against the
  site's terms. Prefer ESPN unless you specifically need the multi-book board.
- **The Odds API.** If you want many US books through a sanctioned API, put the
  key behind a Netlify function so it never ships to the browser (see the earlier
  discussion). It slots in as another slate source alongside `espn.py`.

---

## Natural next upgrades

- **Opponent-adjusted ratings.** Swap raw rolling EPA for an SRS / ridge power
  rating so a good number against three bad defenses isn't mistaken for signal.
- **The features the pros use.** Red-zone & third-down efficiency, turnover
  margin (regressed toward the mean — it's noisy), pace/pass-rate, QB adjustments
  for injuries, and weather for totals.
- **Calibration & backtest.** Check that "60%" bets actually hit ~60% (reliability
  curve), and backtest by Closing Line Value, not raw record.
- **Uncertainty per game.** A game-specific σ (bad weather, backup QB) instead of
  one league-wide number.
```
