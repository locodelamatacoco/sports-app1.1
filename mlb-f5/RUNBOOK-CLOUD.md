# Daily run — CLOUD RUNBOOK (Claude Code remote environment)

This supersedes the fetch section of `RUNBOOK.md` when running inside Claude
Code on the web. The old sandbox had no outbound network, so data was smuggled
in via the Chrome MCP. **This environment has direct outbound HTTPS**, so the
whole fetch recipe collapses to one script. Model rules are unchanged and
FROZEN at v3.1.4 — see `RUNBOOK.md` for the gates, the two-tier divergence
policy, the bet-time price recheck, and the cohort-watch escalation trigger.

## One-time setup: allow statsapi.mlb.com

Outbound traffic goes through the environment's egress policy. If
`statsapi.mlb.com` is not on the allowlist every fetch fails with a proxy 403.
Fix: claude.ai/code → **Environments** → this environment → **Network access**
→ add `statsapi.mlb.com` to the allowed domains (or select the unrestricted
policy). Docs: https://code.claude.com/docs/en/claude-code-on-the-web

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

## Odds are still manual

Books/odds sites are not fetched. Drop `data/odds_YYYY-MM-DD.csv`
(`away,home,bet_team,bet_ml,opp_ml`, date-keyed — a generic `odds.csv` is
ignored by design) before the run, or paste odds into chat and the agent will
write the file and re-run. Without it the run is lean-only (λ/F5%/L10, no
edges/tiers). The v3.1.3 bet-time price recheck still applies at the counter:
worse than **PLAYABLE TO** = PASS.

## Grading

```
python3 fetch_data.py --grade YYYY-MM-DD   # F5 = sum of innings 1-5, per game
```

Append graded rows to `calibration_log.csv` **with an explicit cohort tag in
the note** (`cohort=ranked`, `cohort=shadow`, or `cohort=excluded`) so
`cohort_report.py` doesn't have to guess from keywords. Historical rows are
classified heuristically; the keyword rules are documented in the script.

## Scheduled Routine

A daily Routine fires this session every morning (default 14:00 UTC / 10:00
ET — after probables are posted, before day games). Each firing: grade
yesterday → append log → `./run_daily.sh` → post the brief (slate, ranked
plays with PLAYABLE TO, watchlist, cohort tallies) → commit and push to
`claude/mlb-f5-schedule-vyvplv`.
