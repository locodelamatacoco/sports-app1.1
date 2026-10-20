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

## Confidence dampener

```
rawEdge      = modelProb - impliedProb
adjustedEdge = rawEdge - sum(penalties)
```

Penalties are a named ledger in probability points (`PENALTIES`), driven by
flags on the slate data: no current-season data, small sample, roster
turnover, estimated inputs, market disagreement, line movement, injury/news
uncertainty, unconfirmed lineups, minutes volatility, role change,
back-to-back, blowout risk, coin flip. The total is capped at 22%.

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

## Running it on a new slate

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
  the header comment in `src/data/nbaGames.js`.
