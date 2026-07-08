#!/usr/bin/env bash
# Daily MLB F5 pipeline (v3.1.4): fetch inputs -> run engine -> cohort watch.
# Pass --date YYYY-MM-DD to run a slate other than today (ET).
set -euo pipefail
cd "$(dirname "$0")"
python3 -c "import numpy, requests" 2>/dev/null || pip3 install -q numpy requests
python3 fetch_data.py "$@"
python3 odds_fetch.py || echo "[warn] odds fetch failed — continuing lean-only"
python3 daily_run.py
echo
python3 cohort_report.py
