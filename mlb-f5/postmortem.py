"""
postmortem.py — what the 2026 v3.1.4 record says about each gate.
=================================================================
REPORT ONLY. Changes nothing. Rules stay FROZEN at v3.1.4.

The season closed 2026-10-29 (Milwaukee over Tampa Bay 4-1). The ranked
card finished 198-168-50, 54.1% hit, -15.17u, ROI -4.1% over 416 graded
plays. That is the number to explain: a card that hits better than
coin-flip and still loses money.

METHOD. calibration_log.csv has the outcome and the price but not the
inputs. model_run_<date>_v3.md has the inputs — every ranked play was
written with a `why:` line in one fixed shape:

  - **BOS F5** +7.9% — None, straight only (None fade) ◐ HALF STAKE (...)
    - why: BOS bats 4.4 R/G season, L10 5.4, OPS 0.721 vs PIT SP Jared
      Jones (5.03 ERA, 1.20 WHIP, 59 IP); BOS sends Sonny Gray (2.79 ERA)

So this joins the two on (date, bet side) and recovers, for every settled
ranked play: edge, divergence gap, stake, tier, the FADED starter's ERA /
WHIP / IP, our own starter's ERA, and the bats line. That gives real
inputs against real outcomes instead of a re-simulation.

READ THE CAVEAT BEFORE THE NUMBERS. Everything below except the two
pre-registered trials is a post-hoc slice of one season. Eight-odd
dimensions are examined; at p<0.05 roughly one spurious "finding" is
expected for free. The tier gate looked this convincing in August
(CONFIRMED 65% / +3.1% on n=88) and then went 5-6 / -23.1% forward.
Nothing here is a rule. Candidates for v3.1.5 have to be pre-registered
and run forward before they touch the engine.

Usage: python3 postmortem.py            # prints the report
       python3 postmortem.py --write     # also writes POSTMORTEM-2026.md
"""
import argparse
import csv
import math
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "calibration_log.csv")
SINCE = "2026-06-24"          # v3.1.4 cohort window, as cohort_report uses

sys.path.insert(0, HERE)
from cohort_report import classify, payout      # the engine's own classifier

# ── parsing ───────────────────────────────────────────────────────────────
RANKED_RE = re.compile(
    r"^- \*\*(?P<team>[A-Z]{2,3}) F5\*\* (?P<edge>[+-]?\d+(?:\.\d+)?)%(?P<rest>.*)$")
WHY_RE = re.compile(
    r"why: (?P<team>[A-Z]{2,3}) bats (?P<rpg>[\d.]+) R/G season, "
    r"L10 (?P<l10>[\d.]+)(?: \((?P<temp>hot|cold)\))?, OPS (?P<ops>[\d.]+) "
    r"vs (?P<opp>[A-Z]{2,3}) SP (?P<fname>.+?) "
    r"\((?P<fera>[\d.]+) ERA, (?P<fwhip>[\d.]+) WHIP, (?P<fip>[\d.]+) IP\); "
    r"(?P<team2>[A-Z]{2,3}) sends (?P<oname>.+?) \((?P<oera>[\d.]+) ERA\)")


def parse_runs():
    """(date, team) -> input record, from every model_run_*_v3.md."""
    out = {}
    for fn in sorted(os.listdir(HERE)):
        m = re.fullmatch(r"model_run_(\d{4}-\d{2}-\d{2})_v3\.md", fn)
        if not m:
            continue
        date = m.group(1)
        head = None
        for line in open(os.path.join(HERE, fn)):
            line = line.rstrip("\n")
            r = RANKED_RE.match(line)
            if r:
                head = r
                continue
            w = WHY_RE.search(line)
            if not (w and head):
                continue
            rest = head.group("rest")
            gap = re.search(r"divergence gap (\d+)%", rest)
            wall = re.search(r"PLAYABLE TO ([+-]?\d+)", rest)
            tier = ("CONFIRMED" if "CONFIRMED" in rest
                    else "CAUTION" if "CAUTION" in rest else None)
            out[(date, head.group("team"))] = dict(
                date=date, team=head.group("team"),
                edge=float(head.group("edge")) / 100.0,
                gap=int(gap.group(1)) / 100.0 if gap else None,
                half="HALF STAKE" in rest,
                steep="STEEP PRICE" in rest,
                wall=int(wall.group(1)) if wall else None,
                tier=tier,
                faded=w.group("fname"), fera=float(w.group("fera")),
                fwhip=float(w.group("fwhip")), fip=float(w.group("fip")),
                ours=w.group("oname"), oera=float(w.group("oera")),
                rpg=float(w.group("rpg")), l10=float(w.group("l10")),
                ops=float(w.group("ops")), temp=w.group("temp"),
            )
            head = None
    return out


def load_plays():
    """Settled ranked plays with inputs joined on (date, bet side)."""
    runs = parse_runs()
    plays, unjoined = [], 0
    for r in csv.DictReader(open(LOG)):
        d = r.get("date") or ""
        if d < SINCE or classify(r.get("note")) != "ranked":
            continue
        res = (r.get("result") or "").strip().upper()
        if res not in ("W", "L"):            # pushes carry no P/L either way
            continue
        ml = re.search(r"[-+]?\d{3,4}", r.get("odds") or "")
        side = (r.get("bet_side") or "").strip()
        if not ml:
            continue
        rec = runs.get((d, side))
        if rec is None:
            unjoined += 1
            continue
        plays.append(dict(rec, res=res, ml=int(ml.group()), game=r.get("game")))
    return plays, unjoined


# ── stats ─────────────────────────────────────────────────────────────────
def agg(sub):
    n = len(sub)
    if not n:
        return None
    w = sum(1 for p in sub if p["res"] == "W")
    pl = sum(payout(p["ml"]) if p["res"] == "W" else -1 for p in sub)
    return dict(w=w, l=n - w, n=n, hit=w / n, u=pl, roi=pl / n)


def two_prop_p(w1, n1, w2, n2):
    if not n1 or not n2:
        return 1.0
    p = (w1 + w2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    return math.erfc(abs(w1 / n1 - w2 / n2) / se / math.sqrt(2))


L = []


def say(s=""):
    print(s)
    L.append(s)


def table(title, groups, note=None):
    """groups: [(label, subset)] printed in the given order."""
    say(f"\n### {title}")
    if note:
        say(f"_{note}_")
    say("")
    say("| segment | W-L | hit | units | ROI | n |")
    say("|---|---|---|---|---|---|")
    for label, sub in groups:
        a = agg(sub)
        if not a:
            say(f"| {label} | — | — | — | — | 0 |")
            continue
        say(f"| {label} | {a['w']}-{a['l']} | {a['hit']:.1%} | "
            f"{a['u']:+.2f}u | {a['roi']:+.1%} | {a['n']} |")


def consistency(sub, label):
    """Day-level P/L shape — the thing 'bets hitting consistently' means."""
    if not sub:
        return f"  {label:28} (none)"
    days = defaultdict(float)
    for p in sub:
        days[p["date"]] += payout(p["ml"]) if p["res"] == "W" else -1
    v = [days[d] for d in sorted(days)]
    n = len(v)
    mean = sum(v) / n
    sd = (sum((x - mean) ** 2 for x in v) / n) ** 0.5 if n > 1 else 0.0
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    green = sum(1 for x in v if x > 0)
    streak = worst = 0
    for p in sorted(sub, key=lambda p: p["date"]):
        streak = streak + 1 if p["res"] == "L" else 0
        worst = max(worst, streak)
    return (f"| {label} | {mean:+.3f}u | {sd:.2f} | {dd:.2f}u | "
            f"{green}/{n} ({green/n:.0%}) | {worst}L |")


# ── report ────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    plays, unjoined = load_plays()
    bad = [p for p in plays if p["fera"] >= 5.40 and p["fip"] >= 20.0]
    ok = [p for p in plays if not (p["fera"] >= 5.40 and p["fip"] >= 20.0)]

    say("# v3.1.4 post-mortem — 2026 season")
    say("")
    say(f"Joined **{len(plays)} settled ranked plays** (W/L; pushes carry no "
        f"P/L) from {SINCE} to season end, matching each log row to the inputs "
        f"recorded in its `model_run` card. {unjoined} log rows could not be "
        "joined (card predates the `why:` format or the side was renamed) and "
        "are excluded from every split below — so these totals run slightly "
        "under `cohort_report.py`'s 198-168-50, which counts all 416.")
    say("")
    say("**Everything here except the two pre-registered trials is a post-hoc "
        "slice of a single season.** Roughly eight dimensions are examined; at "
        "p<0.05 about one spurious finding is expected for free. The tier gate "
        "looked exactly this convincing in August (65% hit, +3.1% ROI, n=88) "
        "and then went 5-6 / −23.1% forward. Treat what follows as a list of "
        "hypotheses ranked by plausibility, not as results.")

    whole = agg(plays)
    say(f"\n**Joined card:** {whole['w']}-{whole['l']}, {whole['hit']:.1%} hit, "
        f"{whole['u']:+.2f}u, ROI {whole['roi']:+.1%}")

    # 1. the selection variable itself
    def eb(lo, hi):
        return [p for p in plays if lo <= p["edge"] < hi]
    table("1. Edge magnitude — the variable the card actually ranks on",
          [("edge 5-6%", eb(0.05, 0.06)), ("edge 6-7%", eb(0.06, 0.07)),
           ("edge 7-9%", eb(0.07, 0.09)), ("edge 9%+", eb(0.09, 9))],
          "If edge is a real signal, hit rate and ROI should climb down this "
          "table. This is the single most important table in the file.")

    # 2. the bad-arm fade signal
    table("2. Bad-arm fade signal (faded SP ERA >= 5.40 AND IP >= 20)",
          [("bad arm faded", bad), ("no fade signal", ok)],
          "The September finding, re-cut on the full season.")
    if bad and ok:
        ab, ao = agg(bad), agg(ok)
        say(f"\nTwo-proportion p on hit rate = "
            f"**{two_prop_p(ab['w'], ab['n'], ao['w'], ao['n']):.3f}**")

    # 3. faded IP depth
    def ipb(sub, lo, hi):
        return [p for p in sub if lo <= p["fip"] < hi]
    table("3. Faded starter's innings — stability of the arm we attack",
          [("bad arm, <60 IP", ipb(bad, 0, 60)),
           ("bad arm, 60-109 IP", ipb(bad, 60, 110)),
           ("bad arm, 110+ IP", ipb(bad, 110, 9999)),
           ("no fade, <60 IP", ipb(ok, 0, 60)),
           ("no fade, 60-109 IP", ipb(ok, 60, 110)),
           ("no fade, 110+ IP", ipb(ok, 110, 9999))])

    # 4. ERA gap — the October observation
    for p in plays:
        p["eragap"] = p["fera"] - p["oera"]
    def gb(lo, hi):
        return [p for p in plays if lo <= p["eragap"] < hi]
    table("4. ERA gap (faded SP ERA − our SP ERA)",
          [("gap < 0.00 (we send the worse arm)", gb(-99, 0)),
           ("gap 0.00-0.50", gb(0, 0.5)), ("gap 0.50-1.00", gb(0.5, 1.0)),
           ("gap 1.00-2.00", gb(1.0, 2.0)), ("gap 2.00+", gb(2.0, 99))],
          "Flagged in October after three straight small-gap plays lost. The "
          "card prints this column but explicitly does NOT rank on it.")

    # 5. price
    def pb(lo, hi):
        return [p for p in plays if lo <= p["ml"] <= hi]
    table("5. Price bucket",
          [("dog (+money)", [p for p in plays if p["ml"] > 0]),
           ("-101..-125", pb(-125, -101)), ("-126..-149", pb(-149, -126)),
           ("-150..-199", pb(-199, -150)),
           ("-200 or worse", [p for p in plays if p["ml"] <= -200])],
          "Hit rate rises with price and ROI does not. This is the shape "
          "behind a 54% card losing money.")

    # 6. divergence — an existing gate
    def dg(lo, hi):
        return [p for p in plays if p["gap"] is not None and lo <= p["gap"] < hi]
    nog = [p for p in plays if p["gap"] is None]
    table("6. Divergence gap — an existing gate, graded on its own terms",
          [("gap <= 20% (no flag printed)", nog),
           ("gap 20-25% (half stake)", dg(0.20, 0.25)),
           ("gap 25-30% (half stake)", dg(0.25, 0.30))],
          "Gaps over 30% are hard-vetoed and never became ranked plays, so "
          "they are absent here by construction — see the shadow cohort.")

    # 7. bats — already shown non-predictive, re-verified
    table("7. Bats temperature flag",
          [("hot", [p for p in plays if p["temp"] == "hot"]),
           ("cold", [p for p in plays if p["temp"] == "cold"]),
           ("neither", [p for p in plays if p["temp"] is None])],
          "Flagged in the brief for weeks before the audit found it was not "
          "predictive. Re-cut here on the full season.")

    # 8. tier — the rejected trial
    table("8. Fade tier (the REJECTED forward trial, for the record)",
          [("CONFIRMED", [p for p in plays if p["tier"] == "CONFIRMED"]),
           ("CAUTION", [p for p in plays if p["tier"] == "CAUTION"]),
           ("None", [p for p in plays if p["tier"] is None])],
          "Backtested at 65% / +3.1% on n=88, then went 5-6 / −23.1% in the "
          "pre-registered forward window. Kept here as the cautionary case.")

    # 9. the one cross-tab worth running
    strong = [p for p in bad if p["ml"] >= -149]
    rest = [p for p in plays if p not in strong]
    table("9. Cross-tab: bad-arm fade AND price better than -150",
          [("bad arm + price >= -149", strong), ("everything else", rest)],
          "The two most plausible single signals, intersected. Smallest n in "
          "the file and the most post-hoc thing in it — shown because it is "
          "the shape a v3.1.5 would take, not because it is established.")

    # 10. THE finding about the tier trial, which changes how to read #2 and #8
    TS, TE = "2026-08-25", "2026-09-07"
    say("\n### 10. The bad-arm cohort IS the tier cohort")
    say("")
    say(f"CONFIRMED ({len([p for p in plays if p['tier']=='CONFIRMED'])}) + "
        f"CAUTION ({len([p for p in plays if p['tier']=='CAUTION'])}) = "
        f"{len(bad)} = the bad-arm fade set, exactly. A tier only exists when "
        "a fade signal fired; `fade_market_ok` then splits those plays by "
        "whether our fade side is priced as a favourite. So **the tier gate's "
        "forward trial was already a forward test of the bad-arm signal**, and "
        "it returned REJECT. That has to be reckoned with before anyone calls "
        "table 2 a finding.")
    table("Bad-arm fades, split at the tier trial's pre-registered window",
          [("before 2026-08-25 (backtest period)", [p for p in bad if p["date"] < TS]),
           (f"{TS}..{TE} (the FORWARD window)",
            [p for p in bad if TS <= p["date"] <= TE]),
           ("after 2026-09-07 (post-trial)", [p for p in bad if p["date"] > TE])])
    table("Faded SP 60-109 IP — the one slice that reverses nowhere",
          [("all", [p for p in bad if 60 <= p["fip"] < 110]),
           ("before 2026-08-25",
            [p for p in bad if 60 <= p["fip"] < 110 and p["date"] < TS]),
           (f"{TS}..{TE} (forward)",
            [p for p in bad if 60 <= p["fip"] < 110 and TS <= p["date"] <= TE]),
           ("after 2026-09-07",
            [p for p in bad if 60 <= p["fip"] < 110 and p["date"] > TE])])

    say("\n### Day-to-day shape")
    say("")
    say("| cohort | mean/day | sd | max DD | green days | worst streak |")
    say("|---|---|---|---|---|---|")
    say(consistency(plays, "whole joined card"))
    say(consistency(bad, "bad-arm fades only"))
    say(consistency(strong, "bad arm + price >= -149"))

    # ── conclusions ──────────────────────────────────────────────────────
    e59 = [p for p in plays if p["edge"] >= 0.09]
    say("""
## What the season actually says

**1. The card's selection variable does not predict.** Table 1 is the whole
post-mortem in four rows. Edge 5-6% hit 57.1%; edge 6-7% hit 50.0%; edge
7-9% hit 55.1%; edge 9%+ hit 38.5% on {n9} plays at -27.2% ROI. No order,
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

The log is the binding constraint on all of this. {unj} of 366 settled
rows could not be joined to their inputs, and real stake, real price and
real result for the bets actually placed were never recorded — so there is
still no answer to whether this card was +EV *as played*, parlayed, at
Hard Rock's prices. Adding stake/price/result columns costs nothing and
would make next season's post-mortem about money rather than about units.
""".format(n9=len(e59), unj=unjoined))

    if a.write:
        out = os.path.join(HERE, "POSTMORTEM-2026.md")
        with open(out, "w") as f:
            f.write("\n".join(L) + "\n")
        print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
