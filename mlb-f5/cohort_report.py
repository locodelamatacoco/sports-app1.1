"""
cohort_report.py — daily cohort watch (RUNBOOK, added 2026-07-07).
==================================================================
Rules are FROZEN at v3.1.4. This script only REPORTS: ranked-card cohort vs
vetoed/watchlist shadow cohort since 2026-06-24 — W-L-P, win% (pushes
excluded), and flat 1u P/L — plus the escalation trigger: when both cohorts
have >= 40 graded rows AND a two-proportion z-test on win% gives p < 0.05,
flag it prominently and propose inverting/retiring the divergence gate.

Classification is keyword-based on the note field of calibration_log.csv:
  shadow  : note contains VETO or WATCHLIST (checked first — a vetoed play
            stays shadow even if it was manually bet)
  excluded: NO BET / graded for calib / PASSED / EXCLUDED / no edge / below
  ranked  : note contains RANKED or "placed", or states an edge >= +5%
Rows can also carry an explicit "cohort=ranked" / "cohort=shadow" /
"cohort=excluded" tag in the note, which overrides the keywords — use the
tag on every new row so the tallies stay exact.

Usage: python3 cohort_report.py [--since 2026-06-24] [--log calibration_log.csv]
"""
import argparse
import csv
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SINCE = "2026-06-24"
MIN_ROWS = 40
ALPHA = 0.05


def parse_odds(s):
    m = re.search(r"[-+]?\d{3,4}", s or "")
    return int(m.group()) if m else None


def payout(ml):
    ml = ml if ml is not None else -110
    return 100 / -ml if ml < 0 else ml / 100


def classify(note):
    n = (note or "").upper()
    tag = re.search(r"COHORT=(RANKED|SHADOW|EXCLUDED)", n)
    if tag:
        return tag.group(1).lower()
    if "VETO" in n or "WATCHLIST" in n:
        return "shadow"
    if ("NO BET" in n or "GRADED FOR CALIB" in n or "PASSED" in n
            or "EXCLUDED" in n or "NO EDGE" in n or "BELOW" in n):
        return "excluded"
    if "RANKED" in n or "PLACED" in n:
        return "ranked"
    m = re.search(r"EDGE \+(\d+(?:\.\d+)?)%", n)
    if m and float(m.group(1)) >= 5.0:
        return "ranked"
    return "excluded"


def two_prop_p(w1, n1, w2, n2):
    """Two-sided two-proportion z-test p-value (pushes already excluded)."""
    if n1 == 0 or n2 == 0:
        return 1.0
    p1, p2 = w1 / n1, w2 / n2
    p = (w1 + w2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = (p1 - p2) / se
    return math.erfc(abs(z) / math.sqrt(2))


def run(log_path, since):
    cohorts = {"ranked": [], "shadow": []}
    with open(log_path) as f:
        for r in csv.DictReader(f):
            if (r.get("date") or "") < since:
                continue
            res = (r.get("result") or "").strip().upper()
            if res not in ("W", "L", "P"):
                continue  # PPD/void/blank — not graded
            c = classify(r.get("note"))
            if c in cohorts:
                cohorts[c].append((res, parse_odds(r.get("odds"))))

    print(f"## Cohort watch since {since} (rules FROZEN at v3.1.4 — report, don't retune)")
    stats = {}
    for name, rows in cohorts.items():
        w = sum(1 for res, _ in rows if res == "W")
        l = sum(1 for res, _ in rows if res == "L")
        p = sum(1 for res, _ in rows if res == "P")
        pl = sum(payout(ml) if res == "W" else -1 if res == "L" else 0
                 for res, ml in rows)
        wl = w + l
        pct = 100 * w / wl if wl else 0.0
        stats[name] = (w, l, p, wl)
        label = "Ranked card" if name == "ranked" else "Veto/watchlist shadow"
        print(f"- **{label}**: {w}-{l}-{p} ({pct:.0f}%, {pl:+.1f}u flat, {len(rows)} graded)")

    (w1, _, _, n1), (w2, _, _, n2) = stats["ranked"], stats["shadow"]
    pval = two_prop_p(w1, n1, w2, n2)
    total1, total2 = sum(stats["ranked"][:3]), sum(stats["shadow"][:3])
    print(f"- Two-proportion test (win%, pushes excl): p = {pval:.3f}")
    if total1 >= MIN_ROWS and total2 >= MIN_ROWS and pval < ALPHA:
        print("\n### 🚨 ESCALATION TRIGGER MET — \"we caught something\"")
        print(f"Both cohorts have >= {MIN_ROWS} graded rows and p = {pval:.3f} < {ALPHA}.")
        print("Per RUNBOOK: flag prominently and PROPOSE inverting/retiring the "
              "divergence gate. Do not change rules unilaterally.")
    else:
        need = []
        if total1 < MIN_ROWS:
            need.append(f"ranked {total1}/{MIN_ROWS}")
        if total2 < MIN_ROWS:
            need.append(f"shadow {total2}/{MIN_ROWS}")
        gate = f"; rows needed: {', '.join(need)}" if need else ""
        print(f"- Escalation gate: NOT met (need both cohorts >= {MIN_ROWS} rows "
              f"AND p < {ALPHA}{gate})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=os.path.join(HERE, "calibration_log.csv"))
    ap.add_argument("--since", default=SINCE)
    a = ap.parse_args()
    run(a.log, a.since)
