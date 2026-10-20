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
| Off/def rating, pace | **Curated** — `nbaTeamRatings.js` |
| Player props and baselines | **Curated** — `PROP_SETS` in `nbaGames.js` |
| Over/under prices, both sides | **Live** — summary endpoint |
| Injury report, with status | **Live** — summary endpoint |
| ESPN's own win projection | **Live** — shown for comparison, never a model input |
| Projected starting fives | **Curated** — `PROJECTED_STARTERS` in `nbaGames.js` |
| Lineup-confirmation uncertainty | **Curated** — `CURATED_CONTEXT` in `nbaGames.js` |

Ratings and pace are not in the public scoreboard — they sit behind
`site.web.api.espn.com`, a separate host. The page fetches the live board and
falls back to the hand-entered snapshot in `NBA_SLATE` if ESPN is unreachable,
labelling which one it used.

`mapScoreboard` is pure, so `espnNba.test.js` runs it against a recorded
payload (`src/data/__fixtures__/espnScoreboard.json`) with no network. It
covers the trap worth guarding: the spread is read from the **home** side, so
a road favourite comes back as a positive home line rather than inverted.

A team with no entry in `nbaTeamRatings.js` resolves to league average with
`ratingsSourced: false` and is flagged, so the model degrades to "no opinion"
instead of inventing a rating. **Only six teams are currently filled in** —
the rest of the league needs its 2025-26 figures added before the model has
anything to say about those games.

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
