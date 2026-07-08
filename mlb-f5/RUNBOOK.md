# Daily run — RUNBOOK (v3.1, auto real-L10)

The engine (`daily_run.py`) is pure offline computation. Because the sandbox has
no network, the agent fetches JSON and drops it into `./data/`, then runs the
script. Real last-10 is now computed automatically by `compute_l10()` — no more
season-RPG proxy.

## FETCH METHOD — use Claude in Chrome every run (Jonathan's standing instruction)
`web_fetch` blocks statsapi query URLs (provenance rule) and WebSearch won't surface
them either. The reliable path is the Chrome MCP:
1. `list_connected_browsers`, then `navigate` a tab onto `statsapi.mlb.com`.
2. Pull each endpoint below with `javascript_tool` running same-origin `await fetch(url)`.
3. Payloads overflow `get_page_text` — in the fetch JS, extract only the parser's fields
   and return a COMPACT string; rebuild the engine-format JSON in bash, writing into the
   mount's `data/` dir directly (the bash mount lags behind Write-tool writes).
For grading use the linescore endpoint and sum innings 1–5. See memory
`reference_fetch_constraints` for the full recipe (compact field lists + synthetic L10).

## Each day
1. **Today's schedule + probables** → save as `data/schedule_today.json`
   `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,team`
2. **Season team hitting** → `data/hitting.json`
   `https://statsapi.mlb.com/api/v1/teams/stats?season=YYYY&group=hitting&stats=season&sportId=1`
3. **Probable-pitcher season stats** → `data/pitchers.json` (collect the probablePitcher ids from step 1)
   `https://statsapi.mlb.com/api/v1/people?personIds=ID1,ID2,...&hydrate=stats(group=[pitching],type=[season],season=YYYY)`
4. **Recent games for L10** → `data/recent_<teamId>.json` (one per team playing today; this is the wired-in L10 pull)
   `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=TID&startDate=<today-13d>&endDate=<yesterday>`
   - IMPORTANT: do **not** add `hydrate=linescore` here — without it the payload is small and returns inline; with it, it overflows and gets saved off-mount.
   - The script accepts any number of `recent_*.json` files and dedupes by gamePk, so one league-wide pull also works if it returns inline.
5. **Odds (optional but needed for edges/gating)** → `data/odds_YYYY-MM-DD.csv`
   DATE-KEYED filename (v3.1.1). A generic `odds.csv` is **ignored** so yesterday's
   lines can never leak into today's edges. If today's file is absent the script
   prints `[warn] no odds_<date>.csv found` and runs lean-only (λ/F5%/L10, no edge/tier).
   Columns: `away,home,bet_team,bet_ml,opp_ml` (American odds; `bet_team` is the side the fade points to).
6. **Run:** `python3 daily_run.py` → prints the slate and writes `model_run_YYYY-MM-DD_v3.md`.

## What the engine enforces (v3.1)
- Real L10 → offense (season RPG only as fallback when a team has no recent file).
- ≥20 IP stability gate on **both** starters (skips small-sample arms; no div-by-zero).
- Fade-vs-market three-tier gate: **CONFIRMED** (our team favored → full, parlay-eligible),
  **CAUTION** (pickem +1..+115 → small straight, NOT parlay-eligible),
  **REJECT** (our team a real dog → market favors the bad arm → no bet).
- Divergence-scaled calibration (v3.1.2: leans the market harder as |model−market|
  grows — w_model slides 0.65 → **0.40** floor, slope ×1.5).
- **TWO-TIER DIVERGENCE GATE (v3.1.4, 2026-07-04):** gap = |raw model conditional
  prob − de-vigged market|.
  - gap ≤ 20%: normal play.
  - **20% < gap ≤ 30% (`DIVERGENCE_VETO`): HALF STAKE**, straight only, never a
    parlay leg. Rationale: the old hard-veto shadow record hit **11-6-3 (~+22%
    ROI)** through 7/3 vs ~+2% on the ranked card — the block was costing winners
    in this band. Small sample (n=17); revisit if the half-stake cohort goes cold.
  - **gap > 30% (`HARD_VETO`): NO BET**, watchlist only. This is the trap zone —
    Senga 6/22 (gap 35) and KC 6/25 (gap 33) both live here.
- Ranked plays = edge ≥5% AND not REJECT AND gap ≤30%. Only CONFIRMED legs with
  gap ≤20% are parlay-eligible.

## Bet-time price recheck (v3.1.3, from the 7/2 MIA@COL loss)
Every ranked play now prints **PLAYABLE TO <price>** — the worst American line that
still holds ≥5% edge (implied = calibrated prob − 0.05). **If the book shows a worse
price at bet time, the play is a PASS**, no exceptions, boosts don't change the math.
(7/2: card said MIA -125 +5.3%; bet went in at -135 where implied 57.4% ≥ model 57% —
the edge was gone at the counter. The model run is a snapshot; the line is not.)

## Parlay discipline (from the 6/17 review)
Straight bets first. At a 60% per-leg rate a 3-leg parlay sweeps ~22% of the time.
Parlays: 2 legs max, **both CONFIRMED**, small stake only.

## Cohort watch (added 2026-07-07, Jonathan's call: no rule changes, run as-is)
Rules are FROZEN at v3.1.4 — do NOT add/retune gates in response to daily results.
Since 6/24 the cohorts are inverted: ranked card 12-16-2 (43%, -5.4u flat) vs
vetoed/watchlist shadow 12-4-2 (75%, +6.8u). Every morning brief must print the
updated cohort tallies (ranked vs veto-shadow, W-L-P + flat P/L since 6/24).
**Trigger to escalate ("we caught something"):** when both cohorts have ≥40
graded rows since 6/24 AND a two-proportion test on win% shows p<0.05, flag it
prominently in the brief and propose inverting/retiring the divergence gate.
Until then: report, don't retune.

## Self-test
`python3 daily_run.py --selftest` checks the L10 math (dedupe + last-10 window).
Model-level gates are checked by `python3 mlb_edge_model_v3.py`.
