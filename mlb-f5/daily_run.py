"""
daily_run.py — v3.1 daily MLB F5 engine with AUTOMATED real-L10.
================================================================
Wires the real last-10 runs pull into the daily flow so every slate uses
actual recent form instead of the season-RPG proxy (the fix from the 6/17
review — cold CLE bats turned a "+9% bet" into a -3% no-bet).

Network note: the sandbox has no outbound network, so the JSON is fetched by
the agent via the web_fetch tool and dropped into ./data/ (see RUNBOOK.md).
This script is pure offline computation over those files — deterministic and
testable. compute_l10() is the wired-in L10 pull.

Inputs (all under ./data/, fetched per RUNBOOK.md):
  schedule_today.json   schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,team
  pitchers.json         people?personIds=...&hydrate=stats(group=[pitching],type=[season],season=YYYY)
  hitting.json          teams/stats?season=YYYY&group=hitting&stats=season&sportId=1
  recent_*.json         one or more schedule pulls (league-wide or per-team, NO linescore
                        hydrate) covering the trailing ~14 days — used for L10.
  odds.csv (optional)   columns: away,home,bet_team,bet_ml,opp_ml   (American odds)

Run:  python3 daily_run.py            (reads ./data, writes model_run_<date>.md)
      python3 daily_run.py --selftest (runs unit checks, no data needed)
"""
import sys, os, json, glob, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlb_edge_model_v3 import (simulate, offense_score, implied, calibrated_prob,
                               fade_is_bettable, stable_ip, MIN_STABLE_IP,
                               market_gap, DIVERGENCE_VETO, HARD_VETO)

import numpy as np

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PARK = {  # run multiplier by home venue id (100=avg)
 2681:1.04, 3309:1.01, 3:1.06, 3313:1.02, 2602:1.08, 4705:1.01, 32:1.01,
 2889:0.97, 17:1.00, 5325:0.98, 2392:0.99, 15:1.02, 2529:1.04, 680:0.93,
 22:0.99, 19:1.15, 2:1.01, 5:0.99, 7:1.02, 2680:0.95, 2394:0.99, 4169:0.98,
 2395:0.92, 3289:0.97, 3312:1.00, 31:0.99, 1:0.97, 14:1.00, 12:1.00, 4:1.00,
}
# v3.1.1: team id -> home-park run factor, for L10 de-park-adjust (fix #1).
# ~half of a team's last-10 are home, so we neutralize half the home-park bias.
TEAM_HOME_PF = {
 147:1.02,116:0.99,118:1.02,139:1.00,146:0.98,143:1.04,120:1.01,112:1.00,121:0.97,
 158:1.01,113:1.08,119:0.99,142:1.00,114:0.99,145:1.00,109:1.02,138:0.97,110:1.01,
 108:0.97,117:0.99,141:1.00,136:0.93,134:0.99,111:1.06,115:1.15,133:1.04,137:0.92,
 140:0.98,135:0.95,144:1.01,
}


def _load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)


def compute_l10(*schedule_jsons):
    """WIRED-IN L10 PULL. Given one or more schedule responses (league-wide or
    per-team, Final games carry teams.away/home.score), return {teamId: l10_rpg}
    using each team's most recent <=10 finished games. Deduplicates by gamePk."""
    seen = {}                       # gamePk -> game (dedupe across files)
    for sj in schedule_jsons:
        for day in sj.get("dates", []):
            for g in day.get("games", []):
                if g.get("status", {}).get("detailedState") == "Final":
                    seen[g["gamePk"]] = (day["date"], g)
    runs = {}                       # teamId -> list[(date, gamePk, runs)]
    for pk, (date, g) in seen.items():
        for side in ("away", "home"):
            t = g["teams"][side]
            sc = t.get("score")
            if sc is None:
                continue
            runs.setdefault(t["team"]["id"], []).append((date, pk, sc))
    out = {}
    for tid, lst in runs.items():
        last = sorted(lst)[-10:]
        if last:
            out[tid] = round(sum(r for _, _, r in last) / len(last), 2)
    return out


def parse_hitting(hjson):
    """teamId -> (rpg, ops) from season hitting response."""
    out = {}
    for sp in hjson["stats"][0]["splits"]:
        st = sp["stat"]
        g = st["gamesPlayed"] or 1
        out[sp["team"]["id"]] = (round(st["runs"] / g, 3), float(st["ops"]))
    return out


def parse_pitchers(pjson):
    """playerId -> (era, whip, ip)."""
    out = {}
    for p in pjson["people"]:
        s = p.get("stats")
        if not s or not s[0]["splits"]:
            continue
        st = s[0]["splits"][0]["stat"]
        out[p["id"]] = (float(st["era"]), float(st["whip"]), float(st["inningsPitched"]))
    return out


def load_odds(date):
    """fix #3: odds are DATE-KEYED (odds_YYYY-MM-DD.csv). A generic odds.csv is
    ignored so yesterday's lines can never leak into today's edges. Returns
    (odds_dict, source_filename_or_None)."""
    path = os.path.join(DATA, f"odds_{date}.csv")
    odds = {}
    if not os.path.exists(path):
        return odds, None
    import csv
    with open(path) as f:
        for r in csv.DictReader(f):
            odds[(r["away"], r["home"])] = (r["bet_team"], int(r["bet_ml"]), int(r["opp_ml"]))
    return odds, os.path.basename(path)


def run(date=None, seed=42):
    sched = _load("schedule_today.json")
    if not sched.get("dates"):   # empty slate (All-Star break, off day)
        return date or datetime.date.today().isoformat(), []
    hit = parse_hitting(_load("hitting.json"))
    pit = parse_pitchers(_load("pitchers.json"))
    recent_files = [os.path.basename(p) for p in glob.glob(os.path.join(DATA, "recent_*.json"))]
    l10 = compute_l10(*[_load(f) for f in recent_files]) if recent_files else {}
    date = date or sched["dates"][0]["date"]
    odds, odds_src = load_odds(date)
    if odds_src is None:
        print(f"[warn] no odds_{date}.csv found — running lean-only (no edges/tiers)")
    rng = np.random.default_rng(seed)
    rows = []
    for g in sched["dates"][0]["games"]:
        if g["status"]["abstractGameState"] != "Preview":
            continue
        a, h = g["teams"]["away"], g["teams"]["home"]
        aid, hid = a["team"]["id"], h["team"]["id"]
        aab, hab = a["team"]["abbreviation"] if "abbreviation" in a["team"] else str(aid), \
                   h["team"]["abbreviation"] if "abbreviation" in h["team"] else str(hid)
        asp = a.get("probablePitcher", {}).get("id")
        hsp = h.get("probablePitcher", {}).get("id")
        if not asp or not hsp:
            rows.append((f"{aab}@{hab}", None, "away/home SP not confirmed — no bet")); continue
        if asp not in pit or hsp not in pit:
            rows.append((f"{aab}@{hab}", None, "pitcher stats missing — no bet")); continue
        if aid not in hit or hid not in hit:   # exhibition squads (All-Star Game)
            rows.append((f"{aab}@{hab}", None, "no team stats (exhibition) — no bet")); continue
        # stability gate (both sides)
        unstable = [pid for pid in (asp, hsp) if not stable_ip(pit[pid][2])]
        if unstable:
            rows.append((f"{aab}@{hab}", None, f"UNSTABLE SP (<{int(MIN_STABLE_IP)} IP) — no bet")); continue
        def off(tid):
            rpg, ops = hit[tid]
            hp = TEAM_HOME_PF.get(tid, 1.0)
            l10_adj = 1 + (hp - 1) * 0.5      # fix #1: de-park-adjust L10 (Coors double-count)
            return offense_score(rpg, l10.get(tid, rpg), ops=ops, l10_park_adj=l10_adj)
        pk_mult = PARK.get(g["venue"]["id"], 1.0)
        r = simulate(off(aid), off(hid), pit[asp][0], pit[hsp][0], pk_mult, rng=rng)
        ca, ch = r["f5_cond"]
        rec = dict(game=f"{aab}@{hab}", aab=aab, hab=hab, lam=r["lam_f5"],
                   f5=r["f5"], cond=(ca, ch), total=r["avg_total"],
                   l10=(l10.get(aid), l10.get(hid)),
                   # for the per-play "why" line: SP name/era/ip and bats per side
                   sp={aab: (a["probablePitcher"].get("fullName", "?"), *pit[asp]),
                       hab: (h["probablePitcher"].get("fullName", "?"), *pit[hsp])},
                   bats={aab: hit[aid], hab: hit[hid]},
                   l10_by={aab: l10.get(aid), hab: l10.get(hid)})
        # market + fade gating if odds present
        o = odds.get((aab, hab))
        if o:
            betteam, ml, oppml = o
            cond = ca if betteam == aab else ch
            cp = calibrated_prob(cond, ml, oppml); rec["edge"] = cp - implied(ml)
            rec["bet"] = betteam; rec["ml"] = ml; rec["calib"] = cp
            rec["gap"] = market_gap(cond, ml, oppml)   # v3.1.2 divergence veto
            fsp = asp if betteam == hab else hsp   # we fade the OPPONENT's SP
            # BUGFIX 2026-08-24: parse_pitchers yields (era, whip, ip), so `*pit[fsp]`
            # was feeding WHIP into fade_is_bettable's last3_era slot. WHIP never
            # reaches the 5.40 STRONG threshold, so STRONG was unreachable and a
            # non-ERA stat was being read as an ERA. We have no last-3 feed yet, so
            # pass None explicitly (is_bad_pitcher_fade then rates on season ERA only).
            f_era, _f_whip, f_ip = pit[fsp]
            sig, tier, parlay_ok, why = fade_is_bettable(f_era, None, f_ip, ml)
            rec["fade"] = (sig, tier, parlay_ok, why)
        rows.append((rec["game"], rec, None))
    return date, rows


def pass_price(cp, min_edge=0.05):
    """v3.1.3 (from the 7/2 MIA@COL loss): worst American price that still keeps
    >=min_edge at bet time. Book worse than this -> PASS. The 7/2 card said MIA
    -125 (+5.3%); the placed line was -135 (implied 57.4% >= calib 57%) — edge
    was gone at the counter. implied boundary = cp - min_edge."""
    p = cp - min_edge
    if p >= 0.5:
        return -int(round(100 * p / (1 - p)))
    return int(round(100 * (1 - p) / p))


def why_line(rec):
    """One-line rationale per play: the bet side's bats vs the faded arm."""
    b = rec["bet"]
    o = rec["hab"] if b == rec["aab"] else rec["aab"]
    osp_n, osp_era, osp_whip, osp_ip = rec["sp"][o]
    bsp_n, bsp_era, _, _ = rec["sp"][b]
    rpg, ops = rec["bats"][b]
    l10b = rec["l10_by"][b]
    l10s = f"{l10b:.1f}" if l10b is not None else "n/a"
    hot = " (hot)" if l10b is not None and l10b >= rpg + 1 else \
          " (cold)" if l10b is not None and l10b <= rpg - 1 else ""
    return (f"  - why: {b} bats {rpg:.1f} R/G season, L10 {l10s}{hot}, OPS {ops:.3f} "
            f"vs {o} SP {osp_n} ({osp_era:.2f} ERA, {osp_whip:.2f} WHIP, {osp_ip:.0f} IP); "
            f"{b} sends {bsp_n} ({bsp_era:.2f} ERA)")


def top_by_era(plays):
    """Rank the ranked plays by starting-pitcher ERA gap (faded arm − our arm).
    Presentation only — ERAs/IP are the season numbers from pitchers.json
    (statsapi), the same values the model simulates on. Small-sample faded arms
    (<40 IP) and a shaky own SP (>=5.40) are flagged so a noisy ERA isn't
    overweighted. CONFIRMED full-stake plays break ties upward."""
    ranked = []
    for e, b, tier, pok, sig, steep, cp, half, gap, rec in plays:
        o = rec["hab"] if b == rec["aab"] else rec["aab"]
        our_n, our_era, _, our_ip = rec["sp"][b]
        fad_n, fad_era, _, fad_ip = rec["sp"][o]
        era_gap = fad_era - our_era
        rpg, _ = rec["bats"][b]
        l10b = rec["l10_by"][b]
        flags = []
        if our_era >= 5.40:
            flags.append(f"own arm {our_n} shaky ({our_era:.2f})—no ERA edge")
        if fad_ip < 40:
            flags.append(f"faded arm only {fad_ip:.0f} IP—small sample")
        if l10b is not None and l10b <= rpg - 1:
            flags.append("bats cold")
        if tier == "CAUTION":
            flags.append("CAUTION pickem")
        if steep:
            flags.append("steep price")
        confirmed_full = (tier == "CONFIRMED" and not half)
        ranked.append(dict(gap=era_gap, cf=confirmed_full, b=b, o=o, our_n=our_n,
                           our_era=our_era, fad_n=fad_n, fad_era=fad_era,
                           fad_ip=fad_ip, half=half, flags=flags))
    ranked.sort(key=lambda r: (r["gap"], r["cf"]), reverse=True)
    return ranked


def top_plays_block(plays):
    tb = top_by_era(plays)
    out = ["\n## Top plays by pitching edge (SP ERA gap — season numbers, statsapi)"]
    for i, r in enumerate(tb, 1):
        star = " ★ CONFIRMED full-stake" if r["cf"] else (" ◐ half-stake" if r["half"] else "")
        fl = f" — {'; '.join(r['flags'])}" if r["flags"] else ""
        out.append(f"{i}. **{r['b']} F5** — {r['b']} arm {r['our_n']} {r['our_era']:.2f} "
                   f"vs {r['o']} {r['fad_n']} {r['fad_era']:.2f} ERA ({r['fad_ip']:.0f} IP) "
                   f"| ERA edge {r['gap']:+.2f}{star}{fl}")
    clean = [r for r in tb if not r["flags"]]
    lead = clean[:2] if len(clean) >= 2 else tb[:2]
    if lead:
        out.append(f"→ **Lead with: {', '.join(r['b'] for r in lead)}** "
                   f"(biggest clean arm edge — still obey PLAYABLE TO at the counter)")
    return out


def fmt(date, rows):
    out = [f"# MLB F5 v3.1 daily run — {date} (real-L10 auto)\n"]
    plays = []
    watch = []
    for game, rec, skip in rows:
        if skip:
            out.append(f"- **{game}** — {skip}"); continue
        a, h = rec["aab"], rec["hab"]
        la, lh = rec["lam"]; fa, ft, fh = rec["f5"]
        l10a, l10h = rec["l10"]
        line = (f"- **{game}** λ {a} {la:.2f}/{h} {lh:.2f} | F5 {fa:.0%}/{ft:.0%}/{fh:.0%} "
                f"| L10 {a}={l10a} {h}={l10h} | tot {rec['total']:.1f}")
        if "edge" in rec:
            sig, tier, pok, why = rec["fade"]
            steep = rec["ml"] <= -200          # heavy juice: flag, do NOT hide
            gap = rec.get("gap", 0.0)
            veto = gap > HARD_VETO             # v3.1.4: only extreme gaps are traps => no bet
            half = DIVERGENCE_VETO < gap <= HARD_VETO   # v3.1.4: mid gaps play at HALF STAKE
            line += f" | bet {rec['bet']} {rec['ml']:+d} edge {rec['edge']:+.1%} [{tier},{'parlay' if pok else 'straight'}]"
            if steep:
                line += " STEEP-PRICE"
            if veto:
                line += f" DIVERGENCE-VETO(gap {gap:.0%}—model vs market too wide, NO BET)"
            elif half:
                line += f" HALF-STAKE(gap {gap:.0%}—divergence band 20-30%, half stake per 7/4 policy)"
            if rec["edge"] >= 0.05 and tier != "REJECT":
                if veto:
                    watch.append((rec["edge"], rec["bet"], tier, pok, sig, steep, gap, rec))
                else:
                    # half-stake divergence plays are straights only (never parlay legs)
                    plays.append((rec["edge"], rec["bet"], tier, pok and not half, sig, steep,
                                  rec["calib"], half, gap, rec))
        out.append(line)
    if plays:
        out.append("\n## Ranked plays (edge >=5%, market-gated)")
        for e, b, tier, pok, sig, steep, cp, half, gap, rec in sorted(plays, key=lambda t: t[0], reverse=True):
            warn = " ⚠ STEEP PRICE (laying heavy juice — size down, value thin)" if steep else ""
            hw = f" ◐ HALF STAKE (divergence gap {gap:.0%} in 20-30% band — v3.1.4 two-tier policy)" if half else ""
            pp = pass_price(cp)
            out.append(f"- **{b} F5** {e:+.1%} — {tier}, {'parlay-eligible' if pok else 'straight only'} ({sig} fade){warn}{hw}"
                       f" | PLAYABLE TO {pp:+d} — worse price = PASS (v3.1.3 bet-time price recheck)")
            out.append(why_line(rec))
        out += top_plays_block(plays)
    if watch:
        out.append("\n## High-divergence watchlist (gap >30%, hard-vetoed, NOT auto-bet — your call)")
        out.append("> Model disagrees with the de-vigged market by >30 pts — the trap zone (Senga 6/22 "
                   "gap 35, KC 6/25 gap 33). Gaps of 20-30% now play at half stake (v3.1.4, from the "
                   "11-6-3 shadow record through 7/3). Listed per the flag-never-hide philosophy.")
        for e, b, tier, pok, sig, steep, gap, rec in sorted(watch, key=lambda t: t[0], reverse=True):
            warn = " ⚠ STEEP PRICE" if steep else ""
            out.append(f"- **{b} F5** {e:+.1%} (model-vs-market gap {gap:.0%}) — {tier or 'no-fade'}, "
                       f"divergence trap risk{warn}")
            out.append(why_line(rec))
    return "\n".join(out)


def selftest():
    # compute_l10: dedupe by gamePk + last-10 window
    days = [{"date": f"2026-06-{d:02d}", "games": [
        {"gamePk": 100 + d, "status": {"detailedState": "Final"},
         "teams": {"away": {"team": {"id": 7}, "score": d},
                   "home": {"team": {"id": 8}, "score": 0}}}]} for d in range(1, 12)]
    l = compute_l10({"dates": days})
    assert l[7] == round(sum(range(2, 12)) / 10, 2), l[7]   # 11 games -> last 10 (drops day1)
    # fix #1: L10 park de-adjust present for Coors team (COL home pf 1.15)
    assert TEAM_HOME_PF.get(115) == 1.15
    # fix #3: date-keyed odds; missing file -> empty + None source (no stale leak)
    o, src = load_odds("1999-01-01")
    assert o == {} and src is None
    assert market_gap(0.87, -112, -104) > HARD_VETO   # extreme trap still hard-vetoed
    assert DIVERGENCE_VETO < 0.25 < HARD_VETO         # v3.1.4 half-stake band exists
    print("daily_run selftest passed (v3.1.4: park-adj L10 + date-keyed odds + two-tier divergence gate)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest(); sys.exit(0)
    date, rows = run()
    md = fmt(date, rows)
    outpath = os.path.join(os.path.dirname(DATA), f"model_run_{date}_v3.md")
    with open(outpath, "w") as f:
        f.write(md)
    print(md)
    print(f"\nwrote {outpath}")
