# v3.1.4 post-mortem — 2026 season

Joined **315 settled ranked plays** (W/L; pushes carry no P/L) from 2026-06-24 to season end, matching each log row to the inputs recorded in its `model_run` card. 51 log rows could not be joined (card predates the `why:` format or the side was renamed) and are excluded from every split below — so these totals run slightly under `cohort_report.py`'s 198-168-50, which counts all 416.

**Everything here except the two pre-registered trials is a post-hoc slice of a single season.** Roughly eight dimensions are examined; at p<0.05 about one spurious finding is expected for free. The tier gate looked exactly this convincing in August (65% hit, +3.1% ROI, n=88) and then went 5-6 / −23.1% forward. Treat what follows as a list of hypotheses ranked by plausibility, not as results.

**Joined card:** 169-146, 53.7% hit, -16.02u, ROI -5.1%

### 1. Edge magnitude — the variable the card actually ranks on
_If edge is a real signal, hit rate and ROI should climb down this table. This is the single most important table in the file._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| edge 5-6% | 32-24 | 57.1% | -0.07u | -0.1% | 56 |
| edge 6-7% | 34-34 | 50.0% | -9.80u | -14.4% | 68 |
| edge 7-9% | 98-80 | 55.1% | -2.61u | -1.5% | 178 |
| edge 9%+ | 5-8 | 38.5% | -3.54u | -27.2% | 13 |

### 2. Bad-arm fade signal (faded SP ERA >= 5.40 AND IP >= 20)
_The September finding, re-cut on the full season._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| bad arm faded | 57-31 | 64.8% | +3.97u | +4.5% | 88 |
| no fade signal | 112-115 | 49.3% | -19.98u | -8.8% | 227 |

Two-proportion p on hit rate = **0.014**

### 3. Faded starter's innings — stability of the arm we attack

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| bad arm, <60 IP | 17-20 | 45.9% | -9.18u | -24.8% | 37 |
| bad arm, 60-109 IP | 29-7 | 80.6% | +11.09u | +30.8% | 36 |
| bad arm, 110+ IP | 11-4 | 73.3% | +2.06u | +13.7% | 15 |
| no fade, <60 IP | 15-9 | 62.5% | +1.98u | +8.2% | 24 |
| no fade, 60-109 IP | 38-46 | 45.2% | -15.11u | -18.0% | 84 |
| no fade, 110+ IP | 59-60 | 49.6% | -6.85u | -5.8% | 119 |

### 4. ERA gap (faded SP ERA − our SP ERA)
_Flagged in October after three straight small-gap plays lost. The card prints this column but explicitly does NOT rank on it._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| gap < 0.00 (we send the worse arm) | 8-9 | 47.1% | -0.39u | -2.3% | 17 |
| gap 0.00-0.50 | 13-21 | 38.2% | -8.53u | -25.1% | 34 |
| gap 0.50-1.00 | 30-16 | 65.2% | +10.58u | +23.0% | 46 |
| gap 1.00-2.00 | 53-53 | 50.0% | -10.94u | -10.3% | 106 |
| gap 2.00+ | 65-47 | 58.0% | -6.74u | -6.0% | 112 |

### 5. Price bucket
_Hit rate rises with price and ROI does not. This is the shape behind a 54% card losing money._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| dog (+money) | 29-39 | 42.6% | -3.75u | -5.5% | 68 |
| -101..-125 | 39-33 | 54.2% | +0.78u | +1.1% | 72 |
| -126..-149 | 36-31 | 53.7% | -4.53u | -6.8% | 67 |
| -150..-199 | 41-35 | 53.9% | -10.48u | -13.8% | 76 |
| -200 or worse | 24-8 | 75.0% | +1.97u | +6.1% | 32 |

### 6. Divergence gap — an existing gate, graded on its own terms
_Gaps over 30% are hard-vetoed and never became ranked plays, so they are absent here by construction — see the shadow cohort._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| gap <= 20% (no flag printed) | 101-86 | 54.0% | -8.04u | -4.3% | 187 |
| gap 20-25% (half stake) | 39-35 | 52.7% | -4.28u | -5.8% | 74 |
| gap 25-30% (half stake) | 29-24 | 54.7% | -2.70u | -5.1% | 53 |

### 7. Bats temperature flag
_Flagged in the brief for weeks before the audit found it was not predictive. Re-cut here on the full season._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| hot | 47-38 | 55.3% | -2.12u | -2.5% | 85 |
| cold | 12-11 | 52.2% | -0.56u | -2.4% | 23 |
| neither | 110-97 | 53.1% | -13.34u | -6.4% | 207 |

### 8. Fade tier (the REJECTED forward trial, for the record)
_Backtested at 65% / +3.1% on n=88, then went 5-6 / −23.1% in the pre-registered forward window. Kept here as the cautionary case._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| CONFIRMED | 55-28 | 66.3% | +4.77u | +5.7% | 83 |
| CAUTION | 2-3 | 40.0% | -0.80u | -16.0% | 5 |
| None | 112-115 | 49.3% | -19.98u | -8.8% | 227 |

### 9. Cross-tab: bad-arm fade AND price better than -150
_The two most plausible single signals, intersected. Smallest n in the file and the most post-hoc thing in it — shown because it is the shape a v3.1.5 would take, not because it is established._

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| bad arm + price >= -149 | 19-16 | 54.3% | -0.43u | -1.2% | 35 |
| everything else | 150-130 | 53.6% | -15.58u | -5.6% | 280 |

### 10. The bad-arm cohort IS the tier cohort

CONFIRMED (83) + CAUTION (5) = 88 = the bad-arm fade set, exactly. A tier only exists when a fade signal fired; `fade_market_ok` then splits those plays by whether our fade side is priced as a favourite. So **the tier gate's forward trial was already a forward test of the bad-arm signal**, and it returned REJECT. That has to be reckoned with before anyone calls table 2 a finding.

### Bad-arm fades, split at the tier trial's pre-registered window

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| before 2026-08-25 (backtest period) | 27-15 | 64.3% | +1.24u | +2.9% | 42 |
| 2026-08-25..2026-09-07 (the FORWARD window) | 6-6 | 50.0% | -1.44u | -12.0% | 12 |
| after 2026-09-07 (post-trial) | 24-10 | 70.6% | +4.17u | +12.3% | 34 |

### Faded SP 60-109 IP — the one slice that reverses nowhere

| segment | W-L | hit | units | ROI | n |
|---|---|---|---|---|---|
| all | 29-7 | 80.6% | +11.09u | +30.8% | 36 |
| before 2026-08-25 | 14-5 | 73.7% | +3.09u | +16.3% | 19 |
| 2026-08-25..2026-09-07 (forward) | 5-1 | 83.3% | +2.46u | +41.0% | 6 |
| after 2026-09-07 | 10-1 | 90.9% | +5.54u | +50.3% | 11 |

### Day-to-day shape

| cohort | mean/day | sd | max DD | green days | worst streak |
|---|---|---|---|---|---|
| whole joined card | -0.198u | 1.70 | 18.18u | 36/81 (44%) | 8L |
| bad-arm fades only | +0.075u | 1.04 | 5.55u | 30/53 (57%) | 3L |
| bad arm + price >= -149 | -0.015u | 1.05 | 4.00u | 16/29 (55%) | 4L |

## What the season actually says

**1. The card's selection variable does not predict.** Table 1 is the whole
post-mortem in four rows. Edge 5-6% hit 57.1%; edge 6-7% hit 50.0%; edge
7-9% hit 55.1%; edge 9%+ hit 38.5% on 13 plays at -27.2% ROI. No order,
and the largest modelled edges were the worst bets on the board. Every
morning brief ranked the card by edge and led with the biggest number. That
ranking carried no information.

This is the direct answer to "why does a 54% card lose money": it selects
on a variable with no signal, and then pays a price that costs ~4.5% a bet.
Hit rate stayed respectable because the simulation is a reasonable model of
baseball. Profit did not, because edge magnitude is not a reasonable model
of where the market is wrong.

**2. One signal survived everything: the bad-arm fade.** 64.8% hit, +4.5%
ROI over 88 plays, p=0.014 — the only split in this file that clears
significance, and the only one with a mechanism stated before the data
(a starter with a genuinely bad season ERA over a stable sample is the
thing the market reprices slowest). Day-shape is better on every measure
that matters for consistency: +0.075u/day against -0.198u for the whole
card, 57% green days against 44%, worst losing streak 3 against 8.

**3. But that signal already failed a pre-registered forward test, and the
reason is instructive.** The bad-arm set is identical to CONFIRMED+CAUTION.
The tier trial ran forward 2026-08-25..09-07, went 5-6 / -23.1% on n=11,
and was rejected — correctly, under its own pre-registered rule. Table 10
shows what that window was: 12 bad-arm plays at 50% sitting between 42
plays at 64.3% before it and 34 plays at 70.6% after it. The trial's rule
had **no minimum sample size**. The divergence trial, written three weeks
later, did (`TRIAL_MIN_N = 25`) and correctly returned EXTEND at n=20
rather than deciding on noise.

So the honest position is not "the tier gate was wrong." It is that a
14-day window on a cohort running ~1 play a day cannot decide anything,
and the trial was built to decide anyway. That is a flaw in the trial, not
evidence for the signal — and it is also exactly what a motivated reader
would say to rescue a rejected hypothesis. Which is why it gets re-run
properly rather than adopted.

**4. Things that looked like signals and are not.** Bats temperature: hot
-2.5%, cold -2.4%, neither -6.4% — nothing, confirming the earlier audit.
ERA gap: 0.50-1.00 looks excellent at +23.0% but 1.00-2.00 is -10.3% and
2.00+ is -6.0%, so it is non-monotonic and the October read on it does not
hold. Divergence band: gap<=20% -4.3%, 20-25% -5.8%, 25-30% -5.1% — the
three are indistinguishable, so the half-stake band is not separating
anything and the EXTEND verdict stands. Price buckets are real but
non-monotonic in ROI (-150..-199 is -13.8% while -200+ is +6.1%), which is
a strange enough shape that I read it as mostly noise with one true
component: dogs and the -150..-199 band are where money went.

**5. The intersection does NOT work.** Bad arm AND price >= -149 is
54.3% / -1.2% on 35 plays, materially worse than bad arm alone. The
bad-arm edge lives at the steeper prices, not the cheap ones. Any v3.1.5
built by stacking the two best-looking columns would have been worse than
one built on either.

## Recommendation for v3.1.5

Do not change the engine now. One thing is worth pre-registering for next
season, and it is narrow:

> **Select on the bad-arm fade signal instead of on edge magnitude.**
> Card = plays where the faded SP has season ERA >= 5.40 over >= 20 IP
> and edge >= 5%. Edge stops being the ranking key and becomes a floor.

Pre-registration requirements, set before any 2027 data exists:
  * **Minimum n = 60 ranked plays in-window**, not 11. At ~1/day that is
    a full two months. No verdict before it is reached; no verdict after
    it is reached either, until the window closes.
  * **Window: the first 60 qualifying plays of 2027**, fixed by date once
    the schedule is out.
  * **ADOPT** if bad-arm hit% > whole-card hit% AND bad-arm ROI > 0.
  * **REJECT** if bad-arm ROI <= 0 OR hit% <= whole-card hit%.
  * **No third run.** If it rejects, the bad-arm hypothesis is spent — it
    will have had a backtest, a failed trial, and a powered trial.
  * Live card stays v3.1.4 for the whole window. Report only.

The 60-109 IP sub-bucket (80.6%, +30.8%, and positive in all three
sub-periods) is the most interesting number in this file and should be
left alone. It is a 36-play post-hoc bucket inside an already post-hoc
cohort. Looking at it again before the trial above resolves is how the
tier gate happened.

## What I would also fix, which is not modelling

The log is the binding constraint on all of this. 51 of 366 settled
rows could not be joined to their inputs, and real stake, real price and
real result for the bets actually placed were never recorded — so there is
still no answer to whether this card was +EV *as played*, parlayed, at
Hard Rock's prices. Adding stake/price/result columns costs nothing and
would make next season's post-mortem about money rather than about units.

