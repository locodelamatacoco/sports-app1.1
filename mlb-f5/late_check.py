"""
late_check.py — ADDITIVE second pass for games the morning run had to skip.
==========================================================================
The routine fires ~10:20 ET, before some clubs have posted a probable. A
game where either side is unannounced is dropped whole by daily_run's
both-SPs-confirmed gate (daily_run.py:140) — the model never even looks at
the arms. Over 2026-08-17..09-07 that cost ~1.4 games/day, 17 in twelve
days, six on 09/06 alone.

That is a SAMPLING problem (when we read statsapi), not a modelling one.
The v3.1.4 gates are untouched here: this script re-fetches later in the
day, re-runs the SAME frozen engine, and reports only games that were
skipped in the morning and have since become eligible.

STRICTLY ADDITIVE. Two guarantees:
  1. It fetches into data/late/ (via MLB_F5_DATA), so the morning
     snapshot in data/ is never overwritten and the morning card stays
     reproducible.
  2. It writes model_run_<date>_v3_addendum.md. It never rewrites
     model_run_<date>_v3.md — the posted card is the record and stands.

Games are matched to the morning card by the skip reasons that are purely
about timing:
  "away/home SP not confirmed"  — probable not posted yet
  "pitcher stats missing"       — probable posted, stats not yet indexed
UNSTABLE SP (<20 IP) is NOT re-checked: that is a real model verdict about
sample size, not a timing artifact, and it will not change later today.

Usage:
  python3 late_check.py              # today (ET)
  python3 late_check.py --date 2026-09-07
"""
import argparse
import datetime
import os
import re
import shutil
import subprocess
import sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
LATE = os.path.join(HERE, "data", "late")
ET = ZoneInfo("America/New_York")

# Skip reasons that are timing artifacts and worth re-checking later.
RETRY_REASONS = ("SP not confirmed", "pitcher stats missing")
MIN_EDGE = 0.05          # same ranked-play bar as the live card


def morning_skips(date):
    """{'AAB@HAB': reason} for games the morning card dropped on timing."""
    path = os.path.join(HERE, f"model_run_{date}_v3.md")
    if not os.path.exists(path):
        raise SystemExit(f"no morning card at {os.path.basename(path)} — "
                         "run the daily pipeline first")
    skips = {}
    for line in open(path):
        m = re.match(r"- \*\*([A-Z]{2,3}@[A-Z]{2,3})\*\* — (.+?) — no bet", line)
        if m and any(r in m.group(2) for r in RETRY_REASONS):
            skips[m.group(1)] = m.group(2).strip()
    return skips


def refetch(date):
    """Pull a fresh snapshot into data/late/ — never touches data/."""
    os.makedirs(LATE, exist_ok=True)
    env = dict(os.environ, MLB_F5_DATA=LATE)
    subprocess.run([sys.executable, "fetch_data.py", "--date", date],
                   cwd=HERE, env=env, check=True,
                   stdout=subprocess.DEVNULL)
    # odds are best-effort, exactly as in run_daily.sh
    r = subprocess.run([sys.executable, "odds_fetch.py"], cwd=HERE, env=env,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("[warn] late odds fetch failed — newly eligible games will be "
              "lean-only (no edge shown)")
    return env


def run_late(env):
    """Run the frozen engine against data/late/ in a clean subprocess.

    A subprocess (not an import) keeps daily_run's module-level DATA bound
    to the late directory without mutating this process's already-imported
    copy — no chance of the morning and late views being mixed.
    """
    code = (
        "import json, daily_run\n"
        "d, rows = daily_run.run()\n"
        "out = []\n"
        "for g, rec, skip in rows:\n"
        "    if rec is None:\n"
        "        out.append(dict(game=g, skip=skip)); continue\n"
        "    ca, ch = rec['cond']\n"
        "    e = dict(game=g, aab=rec['aab'], hab=rec['hab'],\n"
        "             sp={k: [v[0], v[1], v[2], v[3]] for k, v in rec['sp'].items()},\n"
        "             bats={k: list(v) for k, v in rec['bats'].items()},\n"
        "             l10=rec['l10_by'])\n"
        "    if 'edge' in rec:\n"
        "        sig, tier, pok, _why = rec['fade']\n"
        "        e.update(bet=rec['bet'], ml=rec['ml'], edge=rec['edge'],\n"
        "                 gap=rec['gap'], calib=rec['calib'], tier=tier,\n"
        "                 parlay=bool(pok), sig=sig)\n"
        "    out.append(e)\n"
        "print(json.dumps(dict(date=d, rows=out)))\n")
    r = subprocess.run([sys.executable, "-c", code], cwd=HERE, env=env,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"late engine run failed:\n{r.stderr[-1500:]}")
    import json
    return json.loads(r.stdout.strip().splitlines()[-1])


def playable_to(calib, ml, min_edge=MIN_EDGE):
    """v3.1.3 bet-time wall: worst price still leaving >= min_edge."""
    p = calib - min_edge
    if p <= 0 or p >= 1:
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    a = ap.parse_args()
    date = a.date or datetime.datetime.now(ET).date().isoformat()

    skips = morning_skips(date)
    print(f"## LATE PASS {date} — {len(skips)} game(s) the morning card "
          f"dropped on timing")
    for g, why in skips.items():
        print(f"   {g}: {why}")
    if not skips:
        print("   nothing to re-check — no timing skips this morning")
        return

    env = refetch(date)
    res = run_late(env)

    recovered, still_out = [], []
    for e in res["rows"]:
        if e["game"] not in skips:
            continue
        if "skip" in e:
            still_out.append((e["game"], e["skip"]))
        elif "edge" in e:
            recovered.append(e)
        else:
            still_out.append((e["game"], "eligible but unpriced — lean-only"))

    lines = [f"\n# ADDENDUM — late pass {date}",
             "",
             "Games the morning card dropped because a probable had not posted",
             "at fetch time, re-run later against the same frozen v3.1.4 engine.",
             "**The morning card is unchanged and stands as posted.**",
             ""]

    ranked = sorted([e for e in recovered if e["edge"] >= MIN_EDGE],
                    key=lambda e: -e["edge"])
    if ranked:
        lines.append("## Newly eligible ranked plays (edge >= 5%)")
        for e in ranked:
            b = e["bet"]
            o = e["hab"] if b == e["aab"] else e["aab"]
            on, oe, ow, oip = e["sp"][o]
            mn, me, _mw, _mip = e["sp"][b]
            wall = playable_to(e["calib"], e["ml"])
            flags = []
            if e["gap"] > 0.30:
                flags.append("DIVERGENCE-VETO (gap >30%) — NOT a bet")
            elif e["gap"] > 0.20:
                flags.append(f"HALF STAKE (gap {e['gap']:.0%})")
            if e["tier"]:
                flags.append(f"{e['tier']}{', parlay-eligible' if e['parlay'] else ''}")
            rpg, ops = e["bats"][b]
            lines.append(
                f"- **{b} F5** {e['edge']:+.1%} — {e['ml']:+d}"
                + (f" | PLAYABLE TO {wall:+d}" if wall else "")
                + (f" | {'; '.join(flags)}" if flags else ""))
            lines.append(
                f"  - why: {b} bats {rpg:.1f} R/G, L10 {e['l10'][b]}, OPS {ops:.3f} "
                f"vs {o} SP {on} ({oe:.2f} ERA, {ow:.2f} WHIP, {oip:.0f} IP); "
                f"{b} sends {mn} ({me:.2f} ERA)")
    else:
        lines.append("## No newly eligible ranked plays")
        if recovered:
            lines.append("Games became eligible but none cleared the 5% edge bar:")
            for e in sorted(recovered, key=lambda e: -e["edge"]):
                # 2dp: a 4.96% edge must not print as "+5.0% — under the bar"
                lines.append(f"- {e['game']}: bet {e['bet']} {e['ml']:+d}, "
                             f"edge {e['edge']:+.2%} — under the bar")

    if still_out:
        lines.append("")
        lines.append("## Still out")
        for g, why in still_out:
            lines.append(f"- {g} — {why}")

    body = "\n".join(lines)
    print(body)
    out = os.path.join(HERE, f"model_run_{date}_v3_addendum.md")
    with open(out, "w") as f:
        f.write(body + "\n")
    print(f"\nwrote {out}")
    shutil.rmtree(LATE, ignore_errors=True)   # snapshot is transient


if __name__ == "__main__":
    main()
