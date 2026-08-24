# Daily run — CLOUD RUNBOOK (Claude Code remote environment)

This supersedes the fetch section of `RUNBOOK.md` when running inside Claude
Code on the web. The old sandbox had no outbound network, so data was smuggled
in via the Chrome MCP. **This environment has direct outbound HTTPS**, so the
whole fetch recipe collapses to one script. Model rules are unchanged and
FROZEN at v3.1.4 — see `RUNBOOK.md` for the gates, the two-tier divergence
policy, the bet-time price recheck, and the cohort-watch escalation trigger.

## One-time setup: network allowlist

Outbound traffic goes through the environment's egress policy; blocked hosts
fail with a proxy 403. Fix: claude.ai/code → **Environments** → this
environment → **Network access** → add the domains below (or select the
unrestricted policy). Docs: https://code.claude.com/docs/en/claude-code-on-the-web

- `statsapi.mlb.com` — stats/schedule/grading (required)
- `www.oddstrader.com` / `oddstrader.com` — F5 lines (Jonathan's source)
- `app.hardrock.bet` / `api.hardrock.bet` — bet-time price cross-check

## Each day (automated by the scheduled Routine)

```
./run_daily.sh                # fetch inputs -> daily_run.py -> cohort report
```

1. `fetch_data.py` pulls RUNBOOK steps 1–4 into `data/` (schedule + probables,
   season hitting, probable-SP pitching, league-wide trailing-14d schedule for
   real L10). No Chrome MCP, no compact-string rebuild — direct JSON.
2. `daily_run.py` (unchanged v3.1.4 engine) prints the slate and writes
   `model_run_YYYY-MM-DD_v3.md`.
3. `cohort_report.py` prints the mandatory cohort tallies (ranked vs
   veto-shadow since 6/24, W-L-P + flat P/L) and checks the escalation
   trigger (both cohorts ≥40 graded rows AND two-proportion p<0.05).

## Odds: agent-fetched from OddsTrader, manual fallback

`odds_fetch.py` pulls F5 moneylines (mtid 91) from OddsTrader's odds
microservice — the same lines as `oddstrader.com/mlb/?g=first-half&m=money` —
takes the median-consensus price across books, sets `bet_team` to the model's
lean (F5 conditional > 0.5 from a lean-first engine pass), and writes
`data/odds_YYYY-MM-DD.csv` (`away,home,bet_team,bet_ml,opp_ml`, date-keyed —
a generic `odds.csv` is ignored by design). Note: consensus is mostly
offshore books (BetOnline/Bovada/etc.), so the v3.1.3 PLAYABLE TO recheck
against the actual Hard Rock price at the counter matters even more.
Fallback stays manual: drop the CSV in `data/` or paste odds into chat and
the agent re-runs with edges. Without odds the run is
lean-only (λ/F5%/L10, no edges/tiers). The v3.1.3 bet-time price recheck
still applies at the counter: worse than **PLAYABLE TO** = PASS.

## Grading

```
python3 fetch_data.py --grade YYYY-MM-DD   # F5 = sum of innings 1-5, per game
```

Append graded rows to `calibration_log.csv` **with an explicit cohort tag in
the note** (`cohort=ranked`, `cohort=shadow`, or `cohort=excluded`) so
`cohort_report.py` doesn't have to guess from keywords. Historical rows are
classified heuristically; the keyword rules are documented in the script.

## Shadow analyses (reporting only — never change the live card)

`run_daily.sh` prints these under a SHADOW banner after the normal brief.
Neither feeds `daily_run.py`; the frozen v3.1.4 rules are untouched.

- **`f5_offense.py`** — each team's ACTUAL first-five runs/game from
  linescores, vs the full-game R/G the live model proxies with. The F5
  share of full-game runs spans ~45%–68% across teams, so the proxy
  systematically overrates late-scoring clubs (PIT, WSH, CWS) and
  underrates front-loaded ones (DET, CLE, SD).
- **`tier_gate.py`** — backtest + forward trial of selecting the card on
  fade-vs-market TIER instead of edge magnitude.

### TIER-GATE FORWARD TRIAL — pre-registered 2026-08-24

Backtest since 6/24: CONFIRMED-only 28-15 (+4.0% ROI) vs live edge-gated
108-91 (−3.1%). Edge magnitude does not rank winners (5-6% +10%, 6-7%
−22%, 8-9% +13%, 9%+ −46%) — that cohort was chosen *after* seeing the
data, so it gets a forward test before anyone acts on it.

- **Window:** 2026-08-25 .. 2026-09-07 (14 days). Live card stays
  `CARD_MODE = "edge"` for the entire window — no mid-trial changes.
- **ADOPT** if CONFIRMED ROI > 0 AND CONFIRMED win% > None-tier win%
  AND n ≥ 8 · **REJECT** if ROI < −5% OR win% < None-tier
  · **EXTEND** if n < 8.
- **Power caveat:** ~0.7 CONFIRMED plays/day means n≈10. This can only
  catch a directional reversal (i.e. show the backtest was a fluke); it
  cannot prove the edge is real.
- The verdict line is advisory. **A human flips `CARD_MODE`, never the
  daily routine.**

## Scheduled Routine

A daily Routine fires this session every morning (default 14:00 UTC / 10:00
ET — after probables are posted, before day games). Each firing: grade
yesterday → append log → `./run_daily.sh` → post the brief (slate, ranked
plays with PLAYABLE TO, watchlist, cohort tallies) → commit and push to
`claude/mlb-f5-schedule-vyvplv`.
