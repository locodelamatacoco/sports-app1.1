"""
MLB Edge Model v3.1 — F5-PRIMARY
================================
Built 2026-06-11 (v3) from v2 + 6/10 lessons. v3.1 (2026-06-17) adds the
fade-vs-market gate, a symmetric IP-stability gate, and divergence-scaled
calibration after the CLE@MIL loss + parlay review. See calibration_log.csv.

PHILOSOPHY: F5 moneyline is the PRIMARY market (SP vs offense). Full-game ML
is computed but INFORMATIONAL ONLY (bullpen noise the model can't see).

V3.1 CHANGES (each fixes a logged failure):
  A. FADE-VS-MARKET GATE — fade_market_ok(): a bad-pitcher fade is only
     bettable if OUR team is favored or no worse than ~+115 pickem. If the
     market favors the team WITH the bad starter, PASS. Logged: market-agreed
     fades 2-0 (MIL 6/12, MIA 6/17); market-disagreed fades 0-2 (COL 6/11,
     CLE 6/17). The market sees bullpen/true-talent/lineup the model can't.
  B. SYMMETRIC IP-STABILITY GATE — stable_ip(): any SP < 20 IP is unstable on
     BOTH sides (not just fades). Low-IP elite ERAs broke v3 (Hunter Brown
     0.84/10.2IP -> lambda 1.20; Sullivan 0.00/3IP -> div-by-zero). era is
     also floored at 1.0 to prevent division blow-ups.
  C. DIVERGENCE-SCALED CALIBRATION — calibrated_prob() now lowers the model
     weight as |model - market| grows (the market has won every large-gap
     disagreement). w_model slides 0.65 -> 0.50 as the gap exceeds 10 pts.

UNCHANGED v3/v2 RULES:
  - ERA blend 35% last-3 / 65% season; ERA cap 7.00; PitcherFactor ERA-only, cap 2.0
  - lambda_scale 1.31; HFA +/-4%; hard full-game floor 2.5
  - L10 park-adjusted; OPS-proxy wRC+ regressed 50%
  - Push-adjusted EV for F5 ML; Edge >= 5%, confirmed SPs, stable data, no extreme wx
"""
import numpy as np

LG_OFF = 3.76
LG_RPG = 4.40
HFA = 0.04
ERA_CAP = 7.00
ERA_FLOOR = 1.00          # v3.1: prevent div-by-zero / absurd low-IP factors
PF_CAP = 2.00
LAMBDA_SCALE = 1.31
FLOOR_FULL = 2.5
MIN_STABLE_IP = 20.0      # v3.1: symmetric stability gate (both sides)
FADE_MAX_DOG = 115        # v3.1: max American price our fade team may be (+115)
N_SIMS = 20000
DIVERGENCE_VETO = 0.20   # v3.1.4: gap above this => HALF STAKE (was hard veto; shadow record 11-6-3 through 7/3)
HARD_VETO = 0.30         # v3.1.4: gap above this => trap, no bet (Senga 6/22 gap 35, KC 6/25 gap 33 both live here)


def blend_era(season_era, last3_era=None):
    if last3_era is None:
        return season_era
    return 0.35 * last3_era + 0.65 * season_era


def offense_score(rpg, last10_rpg, wrc_plus=None, ops=None, lg_ops=0.714,
                  l10_park_adj=1.0):
    l10 = last10_rpg / l10_park_adj
    if wrc_plus is None:
        raw = 100 * ops / lg_ops
        wrc_plus = 100 + 0.5 * (raw - 100)
    return rpg * 0.4 + l10 * 0.4 + (wrc_plus / 100) * 0.2


def lambdas(off, opp_blend_era, park_mult, is_home):
    park_mult = min(max(park_mult, 0.80), 1.25)
    era = min(max(opp_blend_era, ERA_FLOOR), ERA_CAP)   # v3.1 floor added
    pf = min(4.5 / era, PF_CAP)
    lf5 = (off / pf) * 0.55 * park_mult * LAMBDA_SCALE
    lf5 *= (1 + HFA) if is_home else (1 - HFA)
    lfull = lf5 + (off / LG_OFF) * (LG_RPG * 4 / 9) * park_mult
    lfull = max(lfull, FLOOR_FULL)
    return lf5, lfull


def simulate(away_off, home_off, awaySP_era, homeSP_era, park_mult,
             n=N_SIMS, rng=None):
    rng = rng or np.random.default_rng()
    a5, af = lambdas(away_off, homeSP_era, park_mult, is_home=False)
    h5, hf = lambdas(home_off, awaySP_era, park_mult, is_home=True)
    ra5, rh5 = rng.poisson(a5, n), rng.poisson(h5, n)
    f5_away, f5_home = (ra5 > rh5).mean(), (rh5 > ra5).mean()
    f5_tie = 1 - f5_away - f5_home
    raf, rhf = rng.poisson(af, n), rng.poisson(hf, n)
    tie = raf == rhf
    while tie.any():
        raf[tie] += rng.poisson(af / 9, tie.sum())
        rhf[tie] += rng.poisson(hf / 9, tie.sum())
        tie = raf == rhf
    return dict(
        lam_f5=(a5, h5), lam_full=(af, hf),
        f5=(f5_away, f5_tie, f5_home),
        f5_cond=(f5_away / (f5_away + f5_home), f5_home / (f5_away + f5_home)),
        ml=((raf > rhf).mean(), (rhf > raf).mean()),
        avg_total=(raf + rhf).mean(),
    )


def implied(american):
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def fair_line(p):
    return round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def devig_two(odds, opp_odds):
    """Two-way de-vig: fair prob of `odds` given the opposite side."""
    p, q = implied(odds), implied(opp_odds)
    return p / (p + q)


def market_gap(model_p, market_odds, opp_market_odds=None):
    """|raw model prob - de-vigged market prob|. v3.1.2: large gaps (> DIVERGENCE_VETO)
    empirically mean the model is missing info (small-sample ERA, injury return,
    bullpen) rather than holding real edge. Used to veto trap spots (e.g. Senga 6/22:
    model .87 vs market .52)."""
    if market_odds is None:
        return 0.0
    pm = devig_two(market_odds, opp_market_odds) if opp_market_odds is not None else implied(market_odds)
    return abs(model_p - pm)


def calibrated_prob(model_p, market_odds=None, opp_market_odds=None,
                    w_model=0.65, cap=0.78):
    """v3.1: divergence-scaled blend. With a market line, blend toward the
    market as |model - market| grows (large disagreements have always gone
    the market's way). w_model slides from 0.65 down to a 0.50 floor once the
    gap exceeds 0.10. Without a market line, hard cap at 0.78."""
    if market_odds is not None:
        p_mkt = implied(market_odds)
        if opp_market_odds is not None:
            q = implied(opp_market_odds)
            p_mkt = p_mkt / (p_mkt + q)          # de-vig two-way
        gap = abs(model_p - p_mkt)
        if gap > 0.10:
            w_model = max(0.40, w_model - (gap - 0.10) * 1.5)
        return w_model * model_p + (1 - w_model) * p_mkt
    return min(model_p, cap)


def f5_edge_push_adjusted(f5_cond_win, f5_ml_odds, opp_ml_odds=None):
    """F5 ML with tie=push: edge on CALIBRATED conditional win prob vs implied."""
    return calibrated_prob(f5_cond_win, f5_ml_odds, opp_ml_odds) - implied(f5_ml_odds)


def stable_ip(season_ip):
    """v3.1: a starter is only stable data with >= MIN_STABLE_IP innings.
    Applies to BOTH sides — elite and bad — to block small-sample ERAs."""
    return season_ip >= MIN_STABLE_IP


def fade_market_ok(team_american_odds, max_dog=FADE_MAX_DOG):
    """v3.1 FADE-VS-MARKET GATE (three tiers). team_american_odds is the price
    on OUR (fade) team.
      'CONFIRMED' : our team is the market favorite (odds < 0). Full-confidence,
                    parlay-eligible. Logged record of favored fades is clean.
      'CAUTION'   : pickem band (0 .. +max_dog). Bettable small, NOT parlay-
                    eligible. NOTE: MIA(+104,W) and CLE(+100,L) on 6/17 were
                    BOTH here — the market did not separate them, so these are
                    coin-flippy. Never stack two CAUTION fades in a parlay.
      'REJECT'    : our team a clear dog (> +max_dog) => market favors the bad-
                    arm team => PASS (COL +134, Senga/Perkins traps).
      None        : no line to verify.
    """
    if team_american_odds is None:
        return None
    if team_american_odds < 0:
        return 'CONFIRMED'
    if team_american_odds <= max_dog:
        return 'CAUTION'
    return 'REJECT'


def is_bad_pitcher_fade(season_era, last3_era=None, season_ip=0.0):
    """Fade gate: season ERA creates the fade, last-3 only strengthens.
    Requires >= MIN_STABLE_IP season IP (v3.1 raised 15 -> 20 for stability)."""
    if season_ip < MIN_STABLE_IP or season_era < 5.40:
        return None
    if last3_era is not None and last3_era >= 5.40:
        return 'STRONG'
    return 'FADE'


def fade_is_bettable(season_era, last3_era, season_ip, team_american_odds):
    """v3.1 convenience: combine fade signal + IP stability + market tier.
    Returns (signal, tier, parlay_ok, reason).
      tier in {None,'CONFIRMED','CAUTION','REJECT'}; parlay_ok True only for
      CONFIRMED. CAUTION = bet small straight, never parlay."""
    sig = is_bad_pitcher_fade(season_era, last3_era, season_ip)
    if sig is None:
        return None, None, False, 'no fade signal (ERA<5.40 or <20 IP)'
    tier = fade_market_ok(team_american_odds)
    if tier is None:
        return sig, None, False, 'no market line to confirm — PASS until priced'
    if tier == 'REJECT':
        return sig, tier, False, f'MARKET FAVORS BAD-ARM TEAM (our team {team_american_odds:+d}) — PASS'
    if tier == 'CAUTION':
        return sig, tier, False, f'{sig} but pickem ({team_american_odds:+d}) — small straight only, NO parlay'
    return sig, tier, True, f'{sig}, our team favored ({team_american_odds:+d}) — full, parlay-eligible'


if __name__ == "__main__":
    r = simulate(LG_OFF, LG_OFF, 4.2, 4.2, 1.0, rng=np.random.default_rng(1))
    print("league-avg matchup ml:", tuple(round(float(x), 3) for x in r['ml']),
          "f5_cond:", tuple(round(float(x), 3) for x in r['f5_cond']),
          "total:", round(float(r['avg_total']), 2))
    # fade gate (v3.1: 20 IP threshold)
    assert is_bad_pitcher_fade(9.64, 14.34, 18.2) is None       # Scherzer 18.2 IP now < 20 -> unstable
    assert is_bad_pitcher_fade(9.64, 14.34, 22.0) == 'STRONG'
    assert is_bad_pitcher_fade(4.99, 9.53, 57.2) is None        # Cabrera lesson
    assert is_bad_pitcher_fade(8.01, 12.00, 60.2) == 'STRONG'   # Lorenzen
    assert is_bad_pitcher_fade(5.50, 3.80, 80.0) == 'FADE'
    # IP stability gate
    assert stable_ip(10.2) is False and stable_ip(20.0) is True
    # ERA floor (no div-by-zero on Sullivan 0.00)
    _ = lambdas(3.8, 0.0, 1.0, True)
    # fade-vs-market gate (three tiers)
    assert fade_market_ok(-130) == 'CONFIRMED'   # our team favored
    assert fade_market_ok(+104) == 'CAUTION'      # pickem band
    assert fade_market_ok(+150) == 'REJECT'       # market favors bad-arm team
    assert fade_market_ok(None) is None
    # 6/17 reality check: MIA(+104) and CLE(+100) are BOTH CAUTION -> neither
    # parlay-eligible. Parlaying them together was the actual mistake.
    _, t_mia, pe_mia, _ = fade_is_bettable(6.43, None, 63.0, +104)
    _, t_cle, pe_cle, _ = fade_is_bettable(5.70, None, 60.0, +100)
    assert t_mia == 'CAUTION' and t_cle == 'CAUTION'
    assert pe_mia is False and pe_cle is False     # no parlay leg from CAUTION
    # WSH (favored) is the lone CONFIRMED, parlay-eligible play:
    _, t_wsh, pe_wsh, _ = fade_is_bettable(6.19, None, 32.0, -120)
    assert t_wsh == 'CONFIRMED' and pe_wsh is True
    # divergence-scaled calibration: large gap leans market harder
    assert calibrated_prob(0.70, -120) > calibrated_prob(0.90, -120) - 0.30  # sanity
    assert abs(calibrated_prob(0.90, -120) - (0.40*0.90 + 0.60*implied(-120))) < 1e-9  # 0.40 floor
    assert calibrated_prob(0.908) == 0.78         # no-market cap unchanged
    assert market_gap(0.87, -112, -104) > DIVERGENCE_VETO   # Senga 6/22 trap is vetoed
    assert market_gap(0.87, -112, -104) > HARD_VETO      # Senga 6/22 trap (gap 35) still hard-vetoed
    assert market_gap(0.62, -188, +158) < DIVERGENCE_VETO  # TB 6/23 fair-priced, not a trap
    assert DIVERGENCE_VETO < 0.25 < HARD_VETO              # v3.1.4 two-tier band exists
    print("v3.1.4 all gate/stability/calibration/divergence checks pass")
