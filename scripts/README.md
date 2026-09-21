# Model data pipeline

Two scripts turn public UFCStats data into a backtest corpus and a fitted
win-probability model. Neither is part of the app build; they regenerate
`src/models/winProbModel.js`.

## 1. Build the corpus

```
curl -sO https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_stats.csv
curl -sO https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_results.csv
curl -sO https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fighter_tott.csv
curl -sO https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_event_details.csv
python3 scripts/build_corpus.py <csv-dir> corpus_all.json
```

For every fight it rebuilds both fighters' profiles from **only** their bouts
before that date. Every 0-10 rating is a percentile of a measured quantity
(control time per minute, knockdowns absorbed per 100 strikes absorbed,
late-round output vs round-1 output, and so on), and the percentile scales are
fitted strictly before the evaluation window so nothing leaks backwards.

## 2. Fit the model

```
python3 scripts/fit_logistic.py corpus_all.json 2023-01-01
```

Trains on fights before the cutoff, tests after it, mirroring the training set
(A-B and B-A) so the model is symmetric. Writes `logistic_model.json`, whose
weights are transcribed into `src/models/winProbModel.js`.

## Why this exists

The Monte Carlo simulation's hazard coefficients were hand-chosen and never
fitted. Backtested over 960 out-of-sample fights it scored worse than a coin
flip (Brier 0.2584 vs 0.2500). The fitted model on the same inputs scores
0.2313 at 62% accuracy with no train/test gap.

## Known gaps

- **No historical closing lines.** The fitted model beats the simulation and a
  coin flip; it has NOT been shown to beat the market. Published UFC closing
  lines usually land around 0.21-0.22 Brier, likely still ahead of this.
- **Card data is still hand-entered.** The app's per-card files carry profiles
  written by hand, whose rating scales differ from the derived ones, so those
  cards still run on the simulation engine (`profileSource` is not `derived`).
  Generating card profiles from this pipeline is the next step, and the one
  that would let the fitted model run on live cards.
