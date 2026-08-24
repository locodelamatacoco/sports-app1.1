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

# ─────────────────────────────────────────────────────────────────────────
# FORWARD SHADOW TRIAL — decision rule PRE-REGISTERED 2026-08-24, before
# any forward data existed. This is the whole point: the divergence gate
# looked like a 71% lock on a backward-selected cohort and regressed to
# 60% once it had to prove itself forward. Tier-gating gets the same test.
#
#   Window : 2026-08-25 .. 2026-09-07 (14 days)
#   Live   : unchanged (CARD_MODE stays "edge" for the whole window)
#   Metrics: CONSISTENCY is the stated goal, so it is co-primary with ROI.
#            (a) flat-1u ROI and win% vs the None/CAUTION cohort
#            (b) daily-P/L stdev and worst losing streak vs that cohort
#
#   ADOPT   if CONFIRMED ROI > 0 AND CONFIRMED win% > None-tier win%
#              AND CONFIRMED daily sd <= None-tier daily sd
#              AND n_confirmed >= 8
#   REJECT  if CONFIRMED ROI < -5% OR CONFIRMED win% < None-tier win%
#   EXTEND  if n_confirmed < 8 (not enough volume to say anything)
#
# Backtest consistency (6/24..8/24, for reference — NOT the trial):
#   live edge-gated : -0.12u/day  sd 1.76  maxDD 7.90u  47% green  worst 8L
#   tier-gated      : +0.06u/day  sd 0.94  maxDD 5.57u  55% green  worst 2L
# Half the daily volatility and a 2-loss worst streak vs 8 is a bigger
# argument for tier-gating than the ROI gap is.
#
# NOTE ON POWER: CONFIRMED plays run ~0.7/day, so expect n≈10 over the
# window. That is NOT enough for significance — this trial can only catch
# a directional reversal, i.e. tell us the backtest was a fluke. It cannot
# prove the edge is real. No mid-window rule changes. No sub-segment
# mining after the fact.
# ─────────────────────────────────────────────────────────────────────────
TRIAL_START = "2026-08-25"
TRIAL_END = "2026-09-07"
TRIAL_MIN_N = 8


def payout(ml):
    return 100 / -ml if ml < 0 else ml / 100


def load(since=SINCE, until=None):
    out = []
    for r in csv.DictReader(open(LOG)):
        d, res = r.get("date", ""), (r.get("result") or "").strip().upper()
        if d < since or res not in ("W", "L"):
            continue
        if until and d > until:
            continue
        n = (r.get("note") or "").upper()
        if "RANKED" not in n:
            continue
        m = re.search(r"[-+]?\d{3,4}", r.get("odds") or "")
        if not m:
            continue
        out.append(dict(date=d, res=res, ml=int(m.group()), n=n,
                        confirmed="CONFIRMED" in n, half="HALF" in n))
    return out


def consistency(sub, label):
    """Consistency, not just ROI: day-to-day variance, drawdown, streaks.

    Jonathan's stated goal is a CONSISTENT card, so a cohort that returns
    the same units with smaller swings is strictly better. A 0-6 day
    followed by 7-1 nets out fine on paper and is miserable to ride."""
    if not sub:
        print(f"  {label:26} (no rows)"); return
    days = {}
    for r in sub:
        days.setdefault(r["date"], []).append(r)
    dpl = []
    for d in sorted(days):
        dpl.append(sum(payout(r["ml"]) if r["res"] == "W" else -1 for r in days[d]))
    n = len(dpl)
    mean = sum(dpl) / n
    sd = (sum((x - mean) ** 2 for x in dpl) / n) ** 0.5 if n > 1 else 0.0
    # max peak-to-trough drawdown on the cumulative curve
    cum = peak = dd = 0.0
    for x in dpl:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    green = sum(1 for x in dpl if x > 0)
    # longest losing streak, bet by bet in date order
    streak = worst = 0
    for r in sorted(sub, key=lambda r: r["date"]):
        streak = streak + 1 if r["res"] == "L" else 0
        worst = max(worst, streak)
    print(f"  {label:26} {mean:+5.2f}u/day  sd {sd:4.2f}  maxDD {dd:5.2f}u  "
          f"green {green}/{n} ({green/n:.0%})  worst streak {worst}L")


def _stat(sub):
    if not sub:
        return 0, 0, 0.0, 0.0
    w = sum(1 for r in sub if r["res"] == "W")
    pl = sum(payout(r["ml"]) if r["res"] == "W" else -1 for r in sub)
    return w, len(sub), w / len(sub), pl / len(sub)


def trial():
    """Forward shadow trial against the PRE-REGISTERED rule above."""
    import datetime
    rows = load(since=TRIAL_START, until=TRIAL_END)
    conf = [r for r in rows if r["confirmed"]]
    rest = [r for r in rows if not r["confirmed"]]
    cw, cn, cpct, croi = _stat(conf)
    rw, rn, rpct, rroi = _stat(rest)

    today = datetime.date.today().isoformat()
    start = datetime.date.fromisoformat(TRIAL_START)
    end = datetime.date.fromisoformat(TRIAL_END)
    day = (min(datetime.date.fromisoformat(today), end) - start).days + 1

    print(f"\n=== TIER-GATE FORWARD TRIAL (pre-registered {TRIAL_START}..{TRIAL_END}) ===")
    print(f"  day {max(day,0)}/14   live card unchanged (CARD_MODE={CARD_MODE!r})")
    print(f"  CONFIRMED : {cw}-{cn-cw} ({cpct:.0%})  ROI {croi:+.1%}  n={cn}")
    print(f"  None/CAUT : {rw}-{rn-rw} ({rpct:.0%})  ROI {rroi:+.1%}  n={rn}")
    if conf:
        consistency(conf, "  CONFIRMED consistency")
    if rest:
        consistency(rest, "  None/CAUT consistency")

    if today <= TRIAL_END:
        print(f"  verdict pending — decide on {TRIAL_END}")
        return
    def _sd(sub):
        days = {}
        for r in sub:
            days.setdefault(r["date"], []).append(r)
        s = [sum(payout(x["ml"]) if x["res"] == "W" else -1 for x in v)
             for v in days.values()]
        if len(s) < 2:
            return 0.0
        m = sum(s) / len(s)
        return (sum((x - m) ** 2 for x in s) / len(s)) ** 0.5

    csd, rsd = _sd(conf), _sd(rest)
    if cn < TRIAL_MIN_N:
        print(f"  >>> EXTEND: only {cn} CONFIRMED plays (< {TRIAL_MIN_N}); no call.")
    elif croi < -0.05 or cpct < rpct:
        print("  >>> REJECT tier-gating: forward result failed the pre-set bar.")
    elif croi > 0 and cpct > rpct and csd <= rsd:
        print("  >>> ADOPT candidate: met ROI, win%, AND consistency bars "
              f"(sd {csd:.2f} vs {rsd:.2f}).")
        print("      Human decision required — do not flip CARD_MODE unattended.")
    else:
        print("  >>> INCONCLUSIVE: neither adopt nor reject condition met "
              f"(sd {csd:.2f} vs {rsd:.2f}).")


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
    print("\n=== HIT RATE (the actual goal: bets landing, day after day) ===")
    print("  Note the tension: hit rate rises with price, ROI does not.")
    print("  Chasing hit rate alone lands you on -250 favourites that hit")
    print("  71% and still lose money. We want hit rate at a FAIR price.")
    segs = [
        ("CONFIRMED tier", [r for r in rows if r["confirmed"]]),
        ("None/CAUTION tier", [r for r in rows if not r["confirmed"]]),
        ("dogs (+money)", [r for r in rows if r["ml"] > 0]),
        ("fav -101..-149", [r for r in rows if -150 < r["ml"] < 0]),
        ("fav -150..-199", [r for r in rows if -200 < r["ml"] <= -150]),
        ("fav -200 or worse", [r for r in rows if r["ml"] <= -200]),
    ]
    print(f"  {'segment':22} {'hit':>6} {'ROI':>8}   verdict")
    for lab, sub in segs:
        if not sub:
            continue
        w, n, pct, roi_ = _stat(sub)
        v = ("hits AND pays" if pct >= .60 and roi_ > 0 else
             "hits, no profit (price too steep)" if pct >= .60 else
             "too streaky" if pct < .50 else "")
        print(f"  {lab:22} {pct:5.0%} {roi_:+8.1%}   {v}")

    print("\n=== DAY-TO-DAY STEADINESS ===")
    consistency(rows, "LIVE (edge-gated)")
    consistency([r for r in rows if r["confirmed"]], "TIER-GATED (CONFIRMED)")

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
    trial()
    todays_alternative()
