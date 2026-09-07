"""
divergence_trial.py — SHADOW: should the 20-30% gap band be bet at all?
=======================================================================
Finding (2026-09-07 review, 254 settled ranked plays since 6/24 — the
first cut of this used only the explicitly cohort-tagged rows and so
dropped 32 real ranked plays from 6/26..7/07, before tagging started;
these are the fuller numbers):

  KEPT  (gap <= 20%)         88-69   hit 56.1%   +2.05u   ROI +1.3%   n=157
  BAND  (gap 20-30%)         51-46   hit 52.6%   -6.74u   ROI -6.9%   n= 97

The 20-30% band is 38% of the card's volume and more than all of its
losses. Whole card with that band removed: 56.1% hit / +1.3% ROI /
50% green days / daily sd 1.55, against the live 54.7% / -1.8% / 45% /
1.73. A real improvement on every consistency metric, and a modest one:
+1.4 points of hit rate, +3.1 points of ROI.

WHY THIS IS NOT THE TIER-GATE MISTAKE AGAIN — and why it still gets a
forward trial anyway:

  * The tier gate was a cohort invented from the data (n=43) with no
    prior reason to believe it. It duly reversed out of sample.
  * This is not a new hypothesis. The divergence gate already exists and
    already encodes this exact mechanism: the further the model is from
    the market, the less the model is worth trusting. That is why the
    >30% HARD_VETO exists at all. The 20-30% half-stake was an explicit
    compromise made 2026-07-04 off an 11-6-3 shadow record.
  * So the question is narrow: was that 7/4 compromise set at the right
    number? It now has 94 more plays of evidence, and they say no.

That is a better starting position, not a licence to skip the test. The
tier-gate backtest also looked convincing. Pre-register, run it forward,
and let the rule decide.

SHADOW ONLY. This file changes nothing. HARD_VETO stays 0.30 in
mlb_edge_model_v3.py for the whole window; a human flips it or doesn't.

Usage: python3 divergence_trial.py
"""
import csv
import datetime
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "calibration_log.csv")
SINCE = "2026-06-24"

# ─────────────────────────────────────────────────────────────────────────
# FORWARD SHADOW TRIAL — decision rule PRE-REGISTERED 2026-09-07, before
# any forward data existed. Criteria are fixed for the whole window: no
# mid-window edits, no sub-segment mining afterwards, and if it fails it
# does NOT get re-run on the same cohort until it passes.
#
#   Change under test : HARD_VETO 0.30 -> 0.20
#                       (gap 20-30% becomes a no-bet instead of half stake)
#   Window            : 2026-09-08 .. 2026-09-21 (14 days)
#   Live card         : UNCHANGED. The band keeps being played at half
#                       stake for the entire window; this only reports.
#   Metrics           : consistency is the stated goal, so hit rate is
#                       co-primary with ROI.
#
#   ADOPT  if BAND roi < 0 AND KEPT hit% > LIVE hit% AND n_band >= 25
#   REJECT if BAND roi > 0 OR KEPT hit% < LIVE hit%
#   EXTEND if n_band < 25
#
#   where BAND = plays with 20% < gap <= 30% (what we would stop betting)
#         KEPT = plays with gap <= 20% (what would remain on the card)
#         LIVE = every ranked play, i.e. the card as actually played.
#
#   POWER: the band runs ~2.5 plays/day, so expect n_band ~= 30-35 over
#   the window — a genuinely bigger sample than the tier trial ever had
#   (n=11). Still not significance: this can show the band is not
#   profitable, it cannot prove the tightened card is better.
# ─────────────────────────────────────────────────────────────────────────
TRIAL_START = "2026-09-08"
TRIAL_END = "2026-09-21"
TRIAL_MIN_N = 25

# Live behaviour. "tight" would mean the band is dropped; advisory only.
BAND_MODE = "half"


def payout(ml):
    return 100 / -ml if ml < 0 else ml / 100


def load(since=SINCE, until=None):
    """Ranked, settled plays, split by which side of the 20% gap they sit on.

    `half` is read from the note tag the daily brief writes ("HALF(gapNN)"),
    which daily_run sets from DIVERGENCE_VETO < gap <= HARD_VETO — so it is
    the engine's own classification, not a re-derivation here.
    """
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
        gap = re.search(r"GAP(\d+)", n)
        out.append(dict(date=d, res=res, ml=int(m.group()),
                        band="HALF" in n, gap=int(gap.group(1)) if gap else None))
    return out


def _stat(sub):
    if not sub:
        return 0, 0, 0.0, 0.0
    w = sum(1 for r in sub if r["res"] == "W")
    pl = sum(payout(r["ml"]) if r["res"] == "W" else -1 for r in sub)
    return w, len(sub), w / len(sub), pl / len(sub)


def consistency(sub, label):
    if not sub:
        print(f"  {label:24} (no rows)")
        return
    days = {}
    for r in sub:
        days.setdefault(r["date"], []).append(r)
    dpl = [sum(payout(r["ml"]) if r["res"] == "W" else -1 for r in days[d])
           for d in sorted(days)]
    n = len(dpl)
    mean = sum(dpl) / n
    sd = (sum((x - mean) ** 2 for x in dpl) / n) ** 0.5 if n > 1 else 0.0
    cum = peak = dd = 0.0
    for x in dpl:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    green = sum(1 for x in dpl if x > 0)
    streak = worst = 0
    for r in sorted(sub, key=lambda r: r["date"]):
        streak = streak + 1 if r["res"] == "L" else 0
        worst = max(worst, streak)
    print(f"  {label:24} {mean:+5.2f}u/day  sd {sd:4.2f}  maxDD {dd:5.2f}u  "
          f"green {green}/{n} ({green/n:.0%})  worst streak {worst}L")


def _line(label, sub):
    w, n, pct, roi = _stat(sub)
    print(f"  {label:24} {w:3}-{n-w:3}  hit {pct:5.1%}  "
          f"{roi*n:+6.2f}u  ROI {roi:+6.1%}  n={n:3}")


def backtest():
    rows = load()
    band = [r for r in rows if r["band"]]
    kept = [r for r in rows if not r["band"]]
    print(f"\n=== BACKTEST since {SINCE} ({len(rows)} settled ranked plays) ===")
    _line("LIVE (as played)", rows)
    _line("KEPT (gap <= 20%)", kept)
    _line("BAND (gap 20-30%)", band)
    print("\n  day-to-day consistency:")
    consistency(rows, "LIVE (as played)")
    consistency(kept, "KEPT (tightened card)")
    print("\n  CAVEAT: one window, and the band was isolated AFTER seeing")
    print("  these results. The mechanism predates the finding, the sample")
    print(f"  band sample is {len(band)}, and it still gets a forward test.")


def trial():
    rows = load(since=TRIAL_START, until=TRIAL_END)
    band = [r for r in rows if r["band"]]
    kept = [r for r in rows if not r["band"]]
    bw, bn, bpct, broi = _stat(band)
    kw, kn, kpct, kroi = _stat(kept)
    lw, ln, lpct, lroi = _stat(rows)

    today = datetime.date.today().isoformat()
    start = datetime.date.fromisoformat(TRIAL_START)
    day = (datetime.date.fromisoformat(min(today, TRIAL_END)) - start).days + 1
    print(f"\n=== DIVERGENCE-BAND FORWARD TRIAL "
          f"(pre-registered {TRIAL_START}..{TRIAL_END}) ===")
    if today < TRIAL_START:
        print(f"  opens {TRIAL_START} — no forward data yet")
        print(f"  live card unchanged for the whole window (BAND_MODE='{BAND_MODE}')")
        return
    print(f"  day {max(day,0)}/14   live card unchanged (BAND_MODE='{BAND_MODE}')")
    _line("BAND (would drop)", band)
    _line("KEPT (would remain)", kept)
    _line("LIVE (as played)", rows)
    consistency(kept, "KEPT consistency")
    consistency(rows, "LIVE consistency")

    if today < TRIAL_END:
        print(f"  verdict pending — decide on {TRIAL_END}")
        return
    if bn < TRIAL_MIN_N:
        print(f"  VERDICT: EXTEND — band n={bn} < {TRIAL_MIN_N}")
    elif broi > 0 or kpct < lpct:
        why = []
        if broi > 0:
            why.append(f"band ROI {broi:+.1%} > 0")
        if kpct < lpct:
            why.append(f"kept hit {kpct:.1%} < live {lpct:.1%}")
        print(f"  VERDICT: REJECT — {'; '.join(why)}. Keep the half-stake band.")
    else:
        print(f"  VERDICT: ADOPT — band ROI {broi:+.1%} < 0, kept hit "
              f"{kpct:.1%} > live {lpct:.1%}, n={bn}. "
              "A human sets HARD_VETO = 0.20.")


def todays_band():
    """What today's card would lose if the band were dropped."""
    import daily_run
    date, rows = daily_run.run()
    drop, keep = [], []
    for _g, rec, _skip in rows:
        if not rec or rec.get("edge", 0) < 0.05:
            continue
        if rec["gap"] > 0.30:
            continue                      # already hard-vetoed, not on the card
        (drop if rec["gap"] > 0.20 else keep).append(rec)
    print(f"\n=== TODAY {date}: tightened card vs live card ===")
    if drop:
        print("  WOULD DROP (gap 20-30%, currently half stake):")
        for r in sorted(drop, key=lambda r: -r["edge"]):
            print(f"    {r['bet']:4} {r['edge']:+.1%}  gap {r['gap']:.0%}")
    else:
        print("  WOULD DROP: nothing — no plays in the 20-30% band today")
    if keep:
        print("  WOULD KEEP:")
        for r in sorted(keep, key=lambda r: -r["edge"]):
            print(f"    {r['bet']:4} {r['edge']:+.1%}  gap {r['gap']:.0%}")
    print(f"\n  BAND_MODE = '{BAND_MODE}' — live card is unchanged.")


if __name__ == "__main__":
    backtest()
    trial()
    try:
        todays_band()
    except Exception as e:                      # no slate / no odds today
        print(f"\n[today's comparison unavailable: {e}]")
