# NBA Betting Model

Monte Carlo model for NBA moneylines (h2h), spreads, totals, and player props.
Lives in `src/models/nbaSimulator.js`, slate inputs in `src/data/nbaGames.js`,
UI at `/nba-model`. Shares odds and sampling helpers with the UFC model via
`src/models/oddsMath.js`.

## Team score model

Expected score comes from the possession identity rather than from raw PPG:

```
possessions   = (homePace + awayPace) / 2
adjEfficiency = teamOffRating x (oppDefRating / leagueAvgRating)
score         = (adjEfficiency / 100) x possessions + homeCourt + schedule
```

**This is a deliberate change from the `Base x Pace x Efficiency` formula the
model was specified with.** That version double-counts: a team's PPG already
contains its own pace and its own efficiency, so multiplying it by a pace
factor and an efficiency factor again compounds both. (The specified
`PaceFactor = (TeamPace + OppPace) / LeagueAvg` also lands near 2.0 rather
than 1.0 — it needs the `/2`.) `points = efficiency x possessions` is an
identity, so building up from it is exact and still reflects pace, matchup,
and form. PPG is reported too, as `impliedSeasonPPG`, for sanity-checking.

Recent form blends in on a sliding weight (`games / 25`, capped at 0.6) so a
three-game sample cannot overrule a season. With `recentForm: null` the prior
season carries the whole projection.

## Simulation

10,000+ sims per game (20,000 in the UI). Team scores are drawn as a
**correlated** pair, not independently:

- One shared possession count per game (SD 3.2), which is also what gives each
  simulation its own pace factor for props.
- One shared scoring-environment shock.
- Each team's own noise.

The three component variances are *derived* from two empirical anchors —
`MARGIN_SD = 13.0` and `TOTAL_SD = 17.5` — rather than guessed. Independent
normals at SD 12 would imply a 17-point margin SD, roughly 4 points too wide,
which prices every spread wrong. The derivation yields a per-team SD of 10.9
and a home/away correlation of 0.29.

Scores round to integers, ties play overtime, and the projection carries the
expected overtime contribution (~0.7 points) because a posted total settles
including OT.

Whole-number lines can push, so cover/push/loss are tallied separately and the
price is compared against the no-push settlement probability
`P(win) / (1 - P(push))`.

## Player props

```
expected = (perGame / baselineMinutes) x projectedMinutes
           x usage x matchup x form x pace
```

Props simulate **inside** the game loop, so each one inherits that
simulation's pace and blowout state — a starter loses minutes once the game is
decided, which is what makes blowout risk an actual mechanism rather than a
flat penalty.

Counting stats (rebounds, assists, threes, blocks, steals) draw from a
Gamma-mixed Poisson, giving integer outcomes and the right overdispersion;
`STAT_SHAPES` holds the per-stat variance inflation. Points-like stats draw
from a Gamma. Integer outcomes matter: `3+ made threes` needs `P(X >= 3)`, not
a normal-curve approximation.

A prop with no sourced baseline returns `insufficientData` and is reported as
`NO PLAY` rather than being modelled off an invented number.

## Sources are configuration, not hard-wired

`providers.js` resolves each capability through a list of providers in priority
order; `providers.espn.js` registers the ESPN-backed ones. Nothing in the model
reaches for ESPN by name.

Only `site.api.espn.com` is reachable from this environment — `stats.nba.com`,
`cdn.nba.com`, `sports.yahoo.com`, `bleacherreport.com`,
`basketball-reference.com` and `api.the-odds-api.com` are all refused at the
proxy. That is a network-policy setting, not a code limitation, so adding an
outlet is three steps: allow the host, write a fetch function, `register` it
with a priority ahead of the ESPN entry.

What each capability is served by now, and what another source would fix:

| Capability | Source | Quality | Gap |
|---|---|---|---|
| slate | espn:scoreboard | 1.00 | — |
| ratings | espn:standings | 1.00 | — |
| injuries | espn:summary | 1.00 | — |
| odds | espn:scoreboard | 0.70 | one book, so cross-book disagreement is mostly invisible |
| playerRates | espn:preseason | 0.50 | 2-6 games, preseason minutes |
| pace | curated:pace-ranks | 0.40 | **rank-derived, not measured** — 20 of 30 teams |
| props | **none** | — | **ESPN publishes no prop lines at all** |

Every resolved value carries its provenance, and `provenancePenalty` turns a
below-first-class source into a dampener charge. This is the point of the
abstraction: without it, swapping in a worse source leaves the model looking
exactly as confident as before. A pace figure from an official feed and one
inferred from a published rank are not the same input.

Ranked by what it would actually buy: a **pace** source would fix the model's
weakest output (totals explain 2% of variance, and estimated pace is why), a
**props** source would put props on the board at all, and a **multi-book odds**
source would make market disagreement measurable instead of hand-noted.

## Preseason: the only current-roster data there is

Every team rating comes from last season's standings, which describe rosters
that no longer exist — Miami's 2025-26 numbers were posted by a team that did
not have Giannis Antetokounmpo on it. `espnPreseason.js` reads this season's
preseason box scores, the only current-roster data available before the season
starts, and the only source of player baselines at all.

It is also bad data, and the module is built to say so rather than hide it:

- Two to six games per team.
- Starters play 15-20 minutes, not 32. **Per-game numbers are useless**, so the
  module returns per-minute rates only, and `projectedMinutes` is a prior the
  caller supplies and the dampener charges for.
- A player with under `MIN_MINUTES_FOR_RATE` (24) total minutes is marked
  `usableSample: false` and `propBaseline` refuses to project from it.
- Rotations are experiments, so deep-bench rates are not repeatable.

The sample size travels with every rate, so a caller cannot use one without
seeing how thin it is.

## Market coverage

ESPN posts three markets per game: moneyline, spread, total. The simulation
records full distributions of each team's score, the margin, and the total, so
**any** line can be priced from the same run — `derivedMarkets` adds team
totals and alternate spreads and totals, about 28 rows per game.

ESPN prices none of those, so by default they come back as **fair odds to
shop**, flagged `priced: false`, and are excluded from `qualified` and from the
slate leaderboard. They never count as bets. Supply real prices via
`game.odds.teamTotals` / `altSpreads` / `altTotals` and they are scored through
the same dampener as everything else.

What is still not covered: first-half and quarter lines (would need period
modelling), and correlated multi-stat props such as triple-doubles, since props
are simulated independently of one another.

## Reading the simulation, not just its mean

The engine has always run 40,000-60,000 simulations per game. For weeks it
reported only the mean, which threw away everything the spread had to say —
and a projection quoted without its range reads far more precise than the
model is.

`distributionSummary` returns percentile bands for margin, total and each
team's score, plus the 90% interval, the chance the game lands within a basket
either way, blowout frequency and overtime frequency. `propDistribution` does
the same for a prop, and `percentile` / `probBetween` read any recorded
distribution directly.

The bands are the point. On a typical game the 90% margin interval runs about
50 points wide and the total interval about 65. That is what a 15.8-point
margin SD actually means, and it is the honest frame for any single-number
projection the model prints.

## Adjustable lines: `propLadder`

Where a book lets you move a prop line, the question is not "is the over good"
but "at which line, and at what price". `propLadder` prices a ladder off the
prop's recorded outcome distribution and, for each rung, states the price the
market would have to offer for the bet to clear the gate **after** that prop's
penalty load.

The uncomfortable thing it shows: moving the line does not rescue a bet. The
required price and the fair price stay roughly one penalty-load apart at every
rung, because an efficient book prices the outcome near fair. A rung whose
model probability sits below the penalty load plus the 5% gate returns
`requiredOverPrice: null` — no price clears it — which is more useful than
quoting +50000.

So the ladder is a tool for finding where the model has a real cushion on the
outcome, not for manufacturing a qualifying bet out of a line change.

## Confidence dampener

```
rawEdge      = modelProb - impliedProb
adjustedEdge = rawEdge - sum(penalties)
```

Penalties are a named ledger in probability points (`PENALTIES`), driven by
flags on the slate data: no current-season data, small sample, roster
turnover, estimated inputs, market disagreement, line movement, unconfirmed
lineups, minutes volatility, role change, back-to-back, blowout risk, coin
flip. The total is capped at 22%.

Injury uncertainty is **sized by who is missing** rather than charged flat: a
ruled-out projected starter costs 5%, a questionable one 4%, while absent
reserves cost 1% each capped at 2% — five deep-bench absences are not the same
uncertainty as one ruled-out star. `injuryPenalties` reads the live report and
matches names against `PROJECTED_STARTERS`; with no live report, the curated
free-text note is charged at the old flat rate.

Each row also reports `edgeVsNoVig` — the edge against the de-vigged market
rather than the posted price. That is the harder and more honest test.

A bet qualifies only on `adjustedEdge >= 5%` **and** `confidence >= 6/10`
**and** no divergence veto.

## Market anchoring and the divergence guard

The closing line is the best single predictor of an NBA game, so the
projection is regressed 35% toward the posted number
(`MARKET_ANCHOR_WEIGHT`). Both versions are returned — `projection.raw` and
the anchored projection — so the disagreement stays visible.

Past 4 points of margin or 6 points of total, the gap is charged for by the
point. Past double those, `divergenceVeto` takes the whole game off the board:
a model disagreeing with the market by 8+ points has almost certainly got a
bad input, and we are the side without a trading desk. `projectGame` also
reports the possessions the market's total implies, which isolates pace as the
input to distrust.

## Data sources

The slate is pulled live from ESPN's public scoreboard; the inputs ESPN does
not expose are curated.

| Input | Source |
|---|---|
| Games, teams, venue, tip time | **Live** — `espnNba.js` |
| Moneyline, spread, total — both sides, opening and current | **Live** — DraftKings via ESPN |
| Line movement | **Derived** from the feed's opening vs current numbers |
| Multi-book disagreement | **Derived** when the feed returns more than one book |
| Off/def rating, all 30 teams | **Derived** — `espnRatings.js`, from standings |
| Pace | **Partly sourced** — `PACE_PER_48`, else league average (flagged) |
| Roster-change priors | **Curated judgement** — `ROSTER_PRIORS` |
| Player per-minute rates, current roster | **Live** — `espnPreseason.js` |
| Player prop lines | **Curated** — ESPN publishes none |
| Over/under prices, both sides | **Live** — summary endpoint |
| Injury report, with status | **Live** — summary endpoint |
| ESPN's own win projection | **Live** — shown for comparison, never a model input |
| Projected starting fives | **Curated** — `PROJECTED_STARTERS` in `nbaGames.js` |
| Lineup-confirmation uncertainty | **Curated** — `CURATED_CONTEXT` in `nbaGames.js` |

Ratings are derived rather than curated. ESPN's standings endpoint carries
season points for and against per game for all 30 teams, which is the
possession identity inverted:

```
offRating = (pointsFor     / pace) * 100
defRating = (pointsAgainst / pace) * 100
```

Pace is the catch — ESPN publishes none on the reachable hosts, so
`PACE_PER_48` holds the figures that could be sourced and every other team
falls back to the league average with `paceEstimated` set. Assuming league pace
for a team that plays faster or slower scales **both** its ratings together, so
its net rating, and therefore the projected margin, stays right while its
contribution to the projected total is off. Hence the per-team flag.

The league-average rating used for the matchup adjustment is computed from the
same fetch, so the adjustment cannot drift onto a different scale than the
ratings it adjusts.

The derivation is cross-checked in `espnRatings.test.js` against net ratings
gathered by hand before the feed was wired up (OKC +11.1, DET +8.2, NY +6.4,
BOS +7.7, PHI −0.2). The page fetches the live board and
falls back to the hand-entered snapshot in `NBA_SLATE` if ESPN is unreachable,
labelling which one it used.

`mapScoreboard` is pure, so `espnNba.test.js` runs it against a recorded
payload (`src/data/__fixtures__/espnScoreboard.json`) with no network. It
covers the trap worth guarding: the spread is read from the **home** side, so
a road favourite comes back as a positive home line rather than inverted.

## Validation: what the backtest found

`src/models/backtest.js` rates teams on 2024-25 and predicts all **1,229
regular-season games of 2025-26** — the same shape as production, where tonight
is projected from last season. Run it with `npm run backtest`.

It found the model was badly overconfident, and three constants wrong:

| Constant | Was | Measured |
|---|---|---|
| `HOME_COURT_POINTS` | 2.6 | **1.74** |
| `MARGIN_SD` | 13.0 | **15.8** |
| `TOTAL_SD` | 17.5 | **19.7** |

The 2.6 was folk wisdom; the measured mean home margin is 1.745. The SDs were
sourced from general knowledge about the spread of NBA final scores, which is
**not the same quantity** the simulation needs — that is the spread of outcomes
around *this model's* projection. Understating it by 20% made every price on
the board overconfident.

Worse, the projections themselves were too extreme. Fitting actual margin on
the rating-driven margin gives a slope of **0.555**: barely more than half of a
projected rating gap shows up on the night. Totals are far weaker, slope
**0.325**. So `RATING_SHRINK_MARGIN` and `RATING_SHRINK_TOTAL` now regress the
rating-driven part toward zero and toward the league mean respectively. Home
court is *not* shrunk — it is a real, stable effect.

Calibration before and after, as mean absolute gap between stated and realised
win rate across probability buckets:

```
before   8.74 points   (60-65% bucket won 51.5%; 70-80% bucket won 64.1%)
after    2.86 points   and erring underconfident at the top, the safe direction
```

### The honest limits

- Prior-season ratings explain **7.7% of margin variance** (R² 0.077) and
  **2.0% of total variance** (R² 0.020). The total projections are close to
  uninformative, which is why a 6-point disagreement with a posted total is not
  an edge.
- Straight-up accuracy is **60.1%** against a 55.5% always-pick-home baseline
  over the full season. On a chronologically held-out final quarter it was
  **61.0% against a 61.4% baseline** — i.e. **no measurable edge over a trivial
  rule** in that window. Treat the full-season figure as the optimistic end.
- **The backtest cannot measure profitability.** ESPN strips odds from
  completed games, so there are no historical closing lines to beat. It
  validates the score projection only. Those are different claims.

## Nightly logging, because the lines disappear

Since a price not recorded before tip-off is gone for good, that question only
becomes answerable going forward:

```
npm run log-board              # snapshot tonight's board before tip
npm run log-board 20261022     # a specific date
npm run grade-board            # grade every log against finals
npm run grade-board 2026-10-21
```

`board-log/YYYY-MM-DD.json` stores every priced market with its price, the
model's probability, raw and adjusted edge, and **the constants in force at the
time** — so a later improvement cannot silently rewrite its own history.

The grader reports two things separately, because they answer different
questions:

- **the side the model leaned** (one per market family, raw edge > 0), which
  measures whether the projection is right. Grading both logged sides would be
  mechanically 50% and meaningless.
- **qualifying bets only**, which is the only line reflecting what the model
  actually told you to do.

Player props settle from box scores (`settleProp`), not from the final score.
A player absent from the box score returns `null` — void, not a loss — because
a player who did not appear usually voids the bet and guessing either way
would quietly corrupt the record.

Settlement lives in `src/models/settle.js` rather than in the script, and is
tested: spread orientation, pushes on whole numbers, and pushes excluded from
ROI denominators are each easy to get silently wrong.

The scripts run the real `src/` modules through a `@babel/core` require hook
(`scripts/_loader.cjs`) so they cannot drift from what the page uses, and they
tunnel through `HTTPS_PROXY` via CONNECT when one is set.

## This season's form, and the penalty that punished knowing more

The model projected every game from the PRIOR season's ratings and charged
itself a standing penalty for having no current-season data. That was honest
when there was no pipeline for it, but it had a perverse consequence: the
penalty never came off, so the model grew *less* confident as the season went
on and more information became available, while the market — which does ingest
those games — moved away from it.

This season's standings are now blended into last season's ratings, weighted
`n / (n + 10)` at n games played. Measured by `npm run fit-blend`, fitting on
2025-26 and testing on 2024-25 — separate seasons, no shared state:

| | straight-up | margin RMSE | calibration \|gap\| |
|---|---|---|---|
| prior-season only | 62.1% | 15.150 | 2.81 pts |
| blended, old shrinkage | 65.7% | 14.447 | 5.81 pts |
| blended, scaled shrinkage | **66.2%** | **14.188** | 2.89 pts |

The middle row is the trap. Better ratings with the old shrinkage improve
accuracy and *wreck* calibration, because `RATING_SHRINK_MARGIN` is a claim
about how much the input ratings can be trusted — 0.555 was fitted for
prior-season inputs and is simply the wrong number for better ones. Shrinkage
and `MARGIN_SD` now scale with the blend weight, which recovers the
calibration while keeping the accuracy.

Two measurements worth keeping, because both are counter-intuitive:

**The gate at 6 games is not caution, it is measurement.** At 1-5 games played
the blend *loses* to prior-season ratings outright (margin RMSE 14.17 against
13.88). Four games of scoring is noise. Below the gate the weight is zero and
nothing changes, which is why this landed with no effect on the 2026-10-27
board, where every team had played two or three.

**A within-season train/test split flatters the blend badly.** Split that way
the model reads 73.9% straight-up and claims 88.9% accuracy in its 67.5%
probability bucket — numbers that would beat the market outright, and which
are an artifact of both halves sharing the same accumulated team state. Across
separate seasons the same setup reads 66.2%. The first set was nearly believed
here; `scripts/fit-blend.js` tests across seasons so it cannot be.

## Whole-player games: double-doubles and scoring marks

Player baselines were the model's binding constraint. Lines could be read
wholesale but baselines came one player at a time from search, so most of a
board could never be priced. `espnSeasonRates.js` fixes that: every completed
regular-season game already has a box score on the same feed the slate comes
from, so the whole league's per-minute rates are a few requests away. On
2026-10-27 that was 274 usable players from 52 games.

A double-double is a JOINT event and cannot be assembled from separate
per-stat probabilities, so `simulateGame` now draws every stat for a player
inside ONE shared minutes draw, and counts the double-double as the single
event it is. `projectPlayerGame` supplies the means; the sim reports
`doubleDouble`, `tripleDouble`, `atLeastTen` per stat and `pointsAtLeast` at
10/15/20/25/30/35/40.

Worth recording that **the correlation turned out not to matter**. Joint and
independent estimates differ by at most 0.6 points across tonight's leaders,
because the only dependence the model carries is an 8% minutes wobble and a
shared pace shock. The joint machinery is still the correct construction — and
it is what makes the blowout effect reach the double-double odds — but anyone
expecting the correlation to move these numbers should know it does not. Real
points/rebounds correlation runs through role and game flow, which this model
does not represent.

### The 3-game sample is the live limitation

Rates are taken at face value with no regression toward any prior, and in late
October that face value is three games. The effect is large:

| | DD @0% | @20% | @35% | @50% regression |
|---|---|---|---|---|
| Sabonis | 89% | 82% | 74% | 62% |
| Towns | 66% | 54% | 45% | 34% |
| Wembanyama | 54% | 43% | 35% | 27% |

Regressing halfway to the league per-minute mean takes Sabonis from 16.2
projected rebounds to 11.2. The *ordering* is robust across every column; the
*levels* are not. Unlike the team-rating blend, whose weight was fitted
(`npm run fit-blend`), this shrinkage is unfitted — doing it properly needs
last season's per-player rates, which is ~1,230 box scores rather than 52. So
the model reports face value and the bracket is stated rather than hidden.

## The bar has never been cleared

Across the five logged slates — 2026-10-20 through 10-27, 280 priced markets —
**zero** have ever qualified as a bet. That is not a run of quiet nights; the
`AdjustedEdge >= 5%` rule has never once been satisfied.

The arithmetic says why. Every game carries a 13-22% penalty floor before any
market is priced, so clearing +5% adjusted needs an 18-27% raw edge, and raw
edges that large do not exist in a liquid NBA market — the widest seen so far
is +12.3%. Blending this season's form legitimately removes about 6% of that
floor once the gate opens, which helps, but does not by itself make the rule
reachable. Either the threshold or the penalty scale is mis-set relative to
real market pricing, and that is a deliberate open question rather than a bug
to patch quietly: the honest options are a lower bar, a smaller penalty scale,
or accepting that this model is a screen rather than a bet-selector.

## Live record

A note on two different numbers, because they diverged sharply and the
difference matters. The **lean record** below measures whether the
projection is right across the board. The **called-shot record** is how the
rows published in chat actually did, and it has been worse: 6-10 and -4.51u
over the first three logged slates. On 2026-10-23 the board went 17-15 and
+2.48u while the five rows highlighted went 2-4 and -2.15u — Cunningham over
24.5, the row pushed hardest, scored 16. Selecting from the board has so far
done worse than the board, which is the opposite of what a ranking is for.


Logged before tip, graded after. The model has **passed on every market so
far**, so the lean record measures whether the projection is right, not
whether following the model would have made money — following it would have
staked nothing.

| | Record | Units | ROI |
|---|---|---|---|
| all leans | 18-19 (48.6%) | −2.29u | −6.2% |
| totals | 7-5 (58.3%) | +1.36u | +11.3% |
| props | 2-2 (50.0%) | −0.11u | −2.8% |
| spreads | 4-5 (44.4%) | −1.32u | −14.7% |
| moneylines | 5-7 (41.7%) | −2.21u | −18.4% |

n=37 across two slates, which is far too small to mean anything — the
standard error on a win rate here is about 8 points. The shape is worth
watching though: totals have been the best family and sides the worst, which
inverts what the backtest predicted (margin R² 0.077 against total R² 0.020).
Either the backtest's ordering or this sample is misleading, and two slates is
not enough to say which.

One day-level diagnostic worth recording: on 2026-10-21 the margin bias was
**−9.78** points across 11 games, with home teams winning 8 and several by
30+. Home court is calibrated at 1.74 from 1,229 games, so that is a one-day
anomaly rather than a defect — but a repeat would mean revisiting it.

## Two unknown-is-not-zero bugs worth not reintroducing

Both made the model quietly *more* confident about the things it knew least
about, which is the exact failure the dampener exists to prevent:

1. `noCurrentSeasonData` was tied to whether a team had played games. One game
   in, the 4% penalty vanished — while the projection still ran on prior-season
   ratings, because there is no pipeline for current-season form. The market
   does ingest those games, so the gap favours the market, not us. It is now
   always true, with a separate `BEHIND_MARKET` charge when games have been
   played that the model cannot read.
2. Roster turnover charged for `high` and `moderate` and nothing for
   `unknown` — so teams nobody had assessed scored as confident as teams
   verified unchanged. `UNASSESSED_ROSTER` now charges 3%.

## Running it on a new slate

The slate and the lines arrive on their own. What needs maintaining is
`nbaTeamRatings.js` (ratings, pace, roster priors) and, for props,
`PROP_SETS` / `CURATED_CONTEXT` in `src/data/nbaGames.js`, keyed by an
`AWAY@HOME` matchup of ESPN abbreviations (note ESPN uses `NY` and `SA`, not
`NYK`/`SAS`).

Edit `src/data/nbaGames.js`. Each number is SOURCED, ESTIMATED, or JUDGEMENT —
flag the latter two in `dataQuality` / `flags` so the dampener charges for
them. To add current-season form, fill each team's `recentForm`
(`{ off, def, pace, games }`) and clear `noCurrentSeasonData`.

Tests: `CI=true npx react-scripts test --testPathPattern=Simulator
--watchAll=false`. `nbaSimulator.test.js` includes a clean synthetic game with
a mispriced moneyline whose job is to prove the dampener gates bets rather
than blocking all of them — if that test stops producing a `BET`, the model
has gone mute.

## Known limits

- Team ratings are season aggregates; there is no injury-adjusted rating, so a
  missing starter is handled through the penalty ledger, not the projection.
- `rosterAdj` and `usageFactor` are priors, not measurements. They are the
  least defensible inputs in the model and the dampener is sized accordingly.
- Props are simulated independently of each other, so correlated parlays and
  combination markets (triple-doubles, PRA built from separate legs) are not
  priced.
- Pace inputs mix a directly sourced figure with rank-derived estimates; see
  `PACE_SCALE_NOTE` in `src/data/nbaTeamRatings.js`.
- ESPN returns one book (DraftKings) on this endpoint, so cross-book
  disagreement is usually undetectable and stays a curated note.
- ESPN prices only one side of the total and spread on this endpoint; the
  missing side falls back to -110 and is flagged as inferred.
