"""
tier_gate.py — SHADOW: what if the card were gated on TIER instead of EDGE?
==========================================================================
Finding (2026-08-24 review, 197 graded ranked plays since 6/24):

  * edge magnitude does NOT rank winners — 5-6% +10% ROI, 6-7% -22%,
    7-8% -1%, 8-9% +13%, 9%+ -46%. That is scatter, not signal.
  * the fade-vs-market TIER does rank them — CONFIRMED +4.0% ROI vs
    None-tier -2.6%.

So the live card is selected by a metric that doesn't sort and merely
labelled by the one that does. This script quantifies the alternative
without touching daily_run.py (rules FROZEN at v3.1.4).

SHADOW ONLY by default. `CARD_MODE = "tier"` in this file flips the
recommendation printed at the bottom; the live card is still whatever
daily_run.py produces. Nothing here changes a bet until a human says so.

Usage: python3 tier_gate.py            # backtest + today's alternative card
"""
import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "calibration_log.csv")
SINCE = "2026-06-24"

# "edge" = live behaviour (all ranked plays). "tier" = CONFIRMED-only card.
CARD_MODE = "edge"


def payout(ml):
    return 100 / -ml if ml < 0 else ml / 100


def load():
    out = []
    for r in csv.DictReader(open(LOG)):
        d, res = r.get("date", ""), (r.get("result") or "").strip().upper()
        if d < SINCE or res not in ("W", "L"):
            continue
        n = (r.get("note") or "").upper()
        if "RANKED" not in n:
            continue
        m = re.search(r"[-+]?\d{3,4}", r.get("odds") or "")
        if not m:
            continue
        out.append(dict(res=res, ml=int(m.group()), n=n,
                        confirmed="CONFIRMED" in n, half="HALF" in n))
    return out


def tally(sub, label):
    if not sub:
        print(f"  {label:28} (no rows)"); return 0.0
    w = sum(1 for r in sub if r["res"] == "W")
    pl = sum(payout(r["ml"]) if r["res"] == "W" else -1 for r in sub)
    print(f"  {label:28} {w:3}-{len(sub)-w:<3} ({w/len(sub):3.0%})  "
          f"{pl:+6.1f}u   ROI {pl/len(sub):+6.1%}   n={len(sub)}")
    return pl


def backtest():
    rows = load()
    print(f"=== BACKTEST since {SINCE} ({len(rows)} graded ranked plays) ===")
    live = tally(rows, "LIVE (edge-gated, all)")
    tier = tally([r for r in rows if r["confirmed"]], "TIER-GATED (CONFIRMED only)")
    tally([r for r in rows if not r["confirmed"]], "  ...excluded (None/CAUTION)")
    print()
    tally([r for r in rows if r["confirmed"] and not r["half"]],
          "CONFIRMED + full stake")
    tally([r for r in rows if r["confirmed"] and r["half"]],
          "CONFIRMED + half stake")
    print(f"\n  swing if tier-gated: {tier - live:+.1f}u "
          f"on {len([r for r in rows if r['confirmed']])} bets "
          f"instead of {len(rows)}")
    print("  CAVEAT: one backtest over one window, and this cohort was chosen")
    print("  AFTER seeing the data. Treat as a hypothesis, not a proven edge.")


def todays_alternative():
    """Re-derive today's card from the engine and split it by tier."""
    import sys
    sys.path.insert(0, HERE)
    from daily_run import run
    from mlb_edge_model_v3 import DIVERGENCE_VETO, HARD_VETO
    try:
        date, rows = run()
    except Exception as e:
        print(f"\n[today's alternative unavailable] {e}")
        return
    keep, drop = [], []
    for game, rec, skip in rows:
        if skip or "edge" not in rec or rec["edge"] < 0.05:
            continue
        sig, tier, pok, why = rec["fade"]
        if tier == "REJECT" or rec.get("gap", 0) > HARD_VETO:
            continue
        half = DIVERGENCE_VETO < rec.get("gap", 0) <= HARD_VETO
        entry = (rec["bet"], rec["edge"], tier, half)
        (keep if tier == "CONFIRMED" else drop).append(entry)

    print(f"\n=== TODAY {date}: tier-gated card vs live card ===")
    if keep:
        print("  WOULD BET (CONFIRMED):")
        for b, e, t, h in sorted(keep, key=lambda x: -x[1]):
            print(f"    {b:4} {e:+.1%}  {'half' if h else 'full'} stake")
    else:
        print("  WOULD BET: nothing — no CONFIRMED plays today")
    if drop:
        print("  WOULD SKIP (on the live card, not CONFIRMED):")
        for b, e, t, h in sorted(drop, key=lambda x: -x[1]):
            print(f"    {b:4} {e:+.1%}  {t or 'None'}-tier")
    print(f"\n  CARD_MODE = {CARD_MODE!r} — live card is unchanged"
          f"{' (tier mode is advisory only)' if CARD_MODE == 'tier' else ''}.")


if __name__ == "__main__":
    backtest()
    todays_alternative()
