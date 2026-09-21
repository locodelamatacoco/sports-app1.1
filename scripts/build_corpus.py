#!/usr/bin/env python3
"""
Build a no-lookahead backtest corpus for the UFC model.

Reads the UFCStats mirror CSVs and, for every fight in a target window,
reconstructs BOTH fighters' statistical profiles using ONLY their bouts that
happened strictly before that fight's date. The output is a JSON fixture the
JS model can be run against.

The point of the exercise is to replace hand-entered, hindsight-contaminated
fighter ratings with derived ones. Every 0-10 rating here is a percentile of a
measured quantity, and the percentile scales are fitted on fights BEFORE the
backtest window so nothing from the evaluation period leaks into the scaling.
"""
import csv, json, re, sys, statistics
from datetime import datetime
from collections import defaultdict

DATA = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'backtest.json'
WINDOW_START = datetime(2016, 1, 1)   # build profiles from here on
SCALE_CUTOFF = datetime(2016, 1, 1)   # percentile scales fitted strictly before this

def parse_date(s):
    return datetime.strptime(s.strip(), '%B %d, %Y')

def of(s):
    """'13 of 27' -> (13, 27)"""
    if not s or ' of ' not in s:
        return (0, 0)
    a, b = s.split(' of ')
    try:
        return (int(float(a)), int(float(b)))
    except ValueError:
        return (0, 0)

def num(s, default=0):
    try:
        return int(float(str(s).strip()))
    except (TypeError, ValueError):
        return default

def ctrl_secs(s):
    if not s or ':' not in s:
        return 0
    m, sec = s.split(':')[:2]
    try:
        return int(float(m)) * 60 + int(float(sec))
    except ValueError:
        return 0

# ---------------------------------------------------------------- load
events = {}
for r in csv.DictReader(open(f'{DATA}/ufc_event_details.csv')):
    try:
        events[r['EVENT'].strip()] = parse_date(r['DATE'])
    except Exception:
        pass

tott = {}
for r in csv.DictReader(open(f'{DATA}/ufc_fighter_tott.csv')):
    name = r['FIGHTER'].strip()
    height = None
    m = re.match(r"(\d+)' (\d+)", r['HEIGHT'] or '')
    if m:
        height = int(m.group(1)) * 12 + int(m.group(2))
    reach = None
    m = re.match(r'(\d+)"', (r['REACH'] or '').strip())
    if m:
        reach = int(m.group(1))
    dob = None
    try:
        dob = parse_date(r['DOB'])
    except Exception:
        pass
    tott[name] = {'height': height, 'reach': reach,
                  'stance': (r['STANCE'] or '').strip() or 'Orthodox', 'dob': dob}

# per-fight, per-fighter aggregated stats (summed over rounds)
FightStat = lambda: {'kd': 0, 'sl': 0, 'sa': 0, 'td': 0, 'tda': 0, 'sub': 0,
                     'rev': 0, 'ctrl': 0, 'head': 0, 'body': 0, 'leg': 0,
                     'rounds': 0, 'r1_sl': 0, 'late_sl': 0, 'late_rounds': 0,
                     'per_round_sl': []}
stats = defaultdict(FightStat)      # (event, bout, fighter) -> stats
for r in csv.DictReader(open(f'{DATA}/ufc_fight_stats.csv')):
    key = (r['EVENT'].strip(), r['BOUT'].strip(), r['FIGHTER'].strip())
    s = stats[key]
    rnd_m = re.search(r'(\d+)', r['ROUND'] or '')
    rnd = int(rnd_m.group(1)) if rnd_m else 1
    sl, sa = of(r['SIG.STR.'])
    td, tda = of(r['TD'])
    h, _ = of(r['HEAD']); b, _ = of(r['BODY']); l, _ = of(r['LEG'])
    s['kd'] += num(r['KD'])
    s['sl'] += sl; s['sa'] += sa
    s['td'] += td; s['tda'] += tda
    s['sub'] += num(r['SUB.ATT'])
    s['rev'] += num(r['REV.'])
    s['ctrl'] += ctrl_secs(r['CTRL'])
    s['head'] += h; s['body'] += b; s['leg'] += l
    s['rounds'] += 1
    s['per_round_sl'].append(sl)
    if rnd == 1:
        s['r1_sl'] += sl
    if rnd >= 3:
        s['late_sl'] += sl; s['late_rounds'] += 1

# ---------------------------------------------------------------- fights
FINISH_KO = 'ko'
FINISH_SUB = 'sub'
FINISH_DEC = 'dec'

def classify(method):
    m = (method or '').lower()
    if 'ko/tko' in m or 'tko' in m or m.strip().startswith('ko'):
        return FINISH_KO
    if 'submission' in m:
        return FINISH_SUB
    if 'decision' in m:
        return FINISH_DEC
    return None

fights = []
for r in csv.DictReader(open(f'{DATA}/ufc_fight_results.csv')):
    ev = r['EVENT'].strip()
    bout = r['BOUT'].strip()
    date = events.get(ev)
    if not date or ' vs. ' not in bout:
        continue
    a, b = [x.strip() for x in bout.split(' vs. ', 1)]
    outcome = (r['OUTCOME'] or '').strip()
    if outcome == 'W/L':
        winner = 'A'
    elif outcome == 'L/W':
        winner = 'B'
    else:
        continue  # draw / NC — excluded from scoring
    method = classify(r['METHOD'])
    if method is None:
        continue
    rnd = num(r['ROUND'], 0)
    if rnd <= 0:
        continue
    mm, ss = (r['TIME'] or '0:00').split(':')[:2]
    try:
        end_min = (rnd - 1) * 5 + int(float(mm)) + int(float(ss)) / 60
    except ValueError:
        continue
    five_round = '5 Rnd' in (r['TIME FORMAT'] or '')
    fights.append({
        'event': ev, 'bout': bout, 'date': date, 'a': a, 'b': b,
        'winner': winner, 'method': method, 'round': rnd,
        'end_min': end_min, 'five_round': five_round,
        'weightclass': (r['WEIGHTCLASS'] or '').strip(),
    })

fights.sort(key=lambda f: f['date'])
print(f'parsed {len(fights)} decisive fights, {len(events)} events', file=sys.stderr)

# ------------------------------------------------- per-fighter career log
career = defaultdict(list)
for f in fights:
    for side, me, opp in (('A', f['a'], f['b']), ('B', f['b'], f['a'])):
        mine = stats.get((f['event'], f['bout'], me))
        theirs = stats.get((f['event'], f['bout'], opp))
        if not mine or not theirs:
            continue
        won = (f['winner'] == side)
        career[me].append({
            'date': f['date'], 'opp': opp, 'won': won, 'method': f['method'],
            'minutes': f['end_min'], 'five_round': f['five_round'],
            'me': mine, 'them': theirs,
        })
for k in career:
    career[k].sort(key=lambda x: x['date'])

# ------------------------------------------------- profile as of a date
def agg(log):
    """Aggregate a list of career entries into raw measured quantities."""
    mins = sum(e['minutes'] for e in log) or 1e-9
    sl = sum(e['me']['sl'] for e in log); sa = sum(e['me']['sa'] for e in log)
    osl = sum(e['them']['sl'] for e in log); osa = sum(e['them']['sa'] for e in log)
    td = sum(e['me']['td'] for e in log); tda = sum(e['me']['tda'] for e in log)
    otd = sum(e['them']['td'] for e in log); otda = sum(e['them']['tda'] for e in log)
    kd = sum(e['me']['kd'] for e in log); okd = sum(e['them']['kd'] for e in log)
    head = sum(e['me']['head'] for e in log)
    body = sum(e['me']['body'] for e in log)
    leg = sum(e['me']['leg'] for e in log)
    ctrl = sum(e['me']['ctrl'] for e in log)
    rev = sum(e['me']['rev'] for e in log)
    sub = sum(e['me']['sub'] for e in log)
    # cardio proxy: late-round output rate vs round-1 output rate
    r1 = sum(e['me']['r1_sl'] for e in log)
    r1n = sum(1 for e in log if e['me']['rounds'] >= 1)
    late = sum(e['me']['late_sl'] for e in log)
    laten = sum(e['me']['late_rounds'] for e in log)
    cardio_ratio = None
    if laten >= 3 and r1n >= 3 and r1 > 0:
        cardio_ratio = (late / laten) / (r1 / r1n)
    # pace consistency: coefficient of variation of per-round output
    per_round = [x for e in log for x in e['me']['per_round_sl']]
    cv = None
    if len(per_round) >= 6 and statistics.mean(per_round) > 0:
        cv = statistics.pstdev(per_round) / statistics.mean(per_round)
    wins = [e for e in log if e['won']]
    finishes = [e for e in wins if e['method'] != FINISH_DEC]
    losses = [e for e in log if not e['won']]
    finished_losses = [e for e in losses if e['method'] != FINISH_DEC]
    return {
        'n': len(log), 'minutes': mins,
        'slpm': sl / mins, 'sapm': osl / mins,
        'str_acc': sl / sa if sa else 0.45,
        'str_def': 1 - (osl / osa) if osa else 0.55,
        'kd15': kd * 15 / mins, 'okd_per_100': okd * 100 / max(osl, 1),
        'head_pct': head / max(head + body + leg, 1),
        'td15': td * 15 / mins, 'td_acc': td / tda if tda else 0.4,
        'td_def': 1 - (otd / otda) if otda else 0.55,
        'sub15': sub * 15 / mins, 'ctrl_per_min': ctrl / 60 / mins,
        'rev15': rev * 15 / mins,
        'cardio_ratio': cardio_ratio, 'cv': cv,
        'finish_rate': len(finishes) / len(wins) if wins else 0.5,
        'finished_rate': len(finished_losses) / len(log),
        'volatility': (len(finishes) + len(finished_losses)) / len(log),
        'five_round_exp': sum(1 for e in log if e['five_round']),
        'wins': len(wins), 'losses': len(losses),
    }

# percentile scales fitted on pre-window data only
def build_scales():
    pools = defaultdict(list)
    for name, log in career.items():
        pre = [e for e in log if e['date'] < SCALE_CUTOFF]
        if len(pre) < 3:
            continue
        a = agg(pre)
        for k in ('kd15', 'sa_per_min', 'ctrl_per_min', 'rev15', 'okd_per_100',
                  'volatility', 'cardio_ratio', 'cv', 'sapm'):
            v = a.get(k)
            if k == 'sa_per_min':
                v = a['slpm'] / max(a['str_acc'], 0.1)
            if v is not None:
                pools[k].append(v)
    return {k: sorted(v) for k, v in pools.items() if v}

SCALES = build_scales()

def pct_rank(key, value):
    """Map a raw value to 0-10 by percentile against the pre-window pool."""
    pool = SCALES.get(key)
    if not pool or value is None:
        return 5.0
    lo, hi = 0, len(pool)
    while lo < hi:
        mid = (lo + hi) // 2
        if pool[mid] < value:
            lo = mid + 1
        else:
            hi = mid
    return round(10 * lo / len(pool), 1)

def profile_as_of(name, date, opp_strength_lookup):
    log = [e for e in career.get(name, []) if e['date'] < date]
    if len(log) < 2:
        return None  # not enough octagon history to model honestly
    a = agg(log)
    phys = tott.get(name, {})
    age = None
    if phys.get('dob'):
        age = int((date - phys['dob']).days / 365.25)
    recent = log[-3:]
    recent_pts = sum((1 if e['won'] else -1) * (1.3 if e['method'] != FINISH_DEC else 1)
                     for e in recent)
    recent_form = max(0, min(10, 5 + 1.6 * recent_pts))
    dmg3 = sum(e['them']['sl'] for e in recent)
    span_years = max((log[-1]['date'] - log[0]['date']).days / 365.25, 0.5)
    activity = len(log) / span_years
    last3_years = [e for e in log if (date - e['date']).days <= 365 * 3]
    activity_recent = len(last3_years) / 3 if last3_years else activity
    last = log[-1]
    # opponent strength: mean pre-fight UFC win rate of opponents faced
    opp_scores = [opp_strength_lookup(e['opp'], e['date']) for e in log]
    opp_scores = [s for s in opp_scores if s is not None]
    opp_strength = round(10 * (sum(opp_scores) / len(opp_scores)), 1) if opp_scores else 5.0

    return {
        'name': name,
        'record': f"{a['wins']}-{a['losses']} (UFC)",
        'striking': {
            'sigStrikesPerMin': round(a['slpm'], 2),
            'strikeDefense': round(max(0.25, min(0.8, a['str_def'])), 3),
            'strikeAccuracy': round(max(0.2, min(0.75, a['str_acc'])), 3),
            'knockdownRate': round(a['kd15'], 2),
            'headStrikePct': round(a['head_pct'], 3),
            'strikesAbsorbedPerMin': round(a['sapm'], 2),
            'powerRating': pct_rank('kd15', a['kd15']),
            'pace': pct_rank('sa_per_min', a['slpm'] / max(a['str_acc'], 0.1)),
        },
        'grappling': {
            'takedownsPer15': round(a['td15'], 2),
            'takedownAccuracy': round(max(0.1, min(0.8, a['td_acc'])), 3),
            'takedownDefense': round(max(0.2, min(0.95, a['td_def'])), 3),
            'subAttemptsPer15': round(a['sub15'], 2),
            'controlRating': pct_rank('ctrl_per_min', a['ctrl_per_min']),
            'scrambleAbility': round(min(10, 0.5 * pct_rank('rev15', a['rev15'])
                                         + 0.5 * (10 * max(0, min(1, a['td_def'])))), 1),
        },
        'factors': {
            'age': age if age else 30,
            'reach': phys.get('reach') or 72,
            'height': phys.get('height') or 70,
            'stance': phys.get('stance') or 'Orthodox',
            # high late-round output relative to round 1 = good cardio
            'cardio': pct_rank('cardio_ratio', a['cardio_ratio']),
            # getting dropped often per strike absorbed = poor chin
            'durability': round(10 - pct_rank('okd_per_100', a['okd_per_100']), 1),
            'recentForm': round(recent_form, 1),
            'damageLastThree': pct_rank('sapm', dmg3 / max(sum(e['minutes'] for e in recent), 1e-9)),
            'activityLevel': round(activity_recent, 2),
            'shortNotice': False,
            'weightCutConcerns': False,
            'fiveRoundExp': a['five_round_exp'],
            'oppStrength': opp_strength,
            'finishRate': round(a['finish_rate'], 3),
            'varianceRating': pct_rank('volatility', a['volatility']),
            'ufcFights': a['n'],
            'recentKOLoss': (not last['won']) and last['method'] == FINISH_KO,
            'inconsistentPace': (a['cv'] is not None and a['cv'] > 0.55),
        },
    }

# opponent strength lookup: a fighter's UFC win rate before a given date
def opp_strength_lookup(name, date):
    log = [e for e in career.get(name, []) if e['date'] < date]
    if len(log) < 2:
        return None
    return sum(1 for e in log if e['won']) / len(log)

# ---------------------------------------------------------------- emit
out = []
for f in fights:
    if f['date'] < WINDOW_START:
        continue
    pa = profile_as_of(f['a'], f['date'], opp_strength_lookup)
    pb = profile_as_of(f['b'], f['date'], opp_strength_lookup)
    if not pa or not pb:
        continue
    out.append({
        'id': f"{f['event']}|{f['bout']}",
        'event': f['event'],
        'date': f['date'].strftime('%Y-%m-%d'),
        'label': f['weightclass'],
        'rounds': 5 if f['five_round'] else 3,
        'fighterA': pa, 'fighterB': pb,
        'result': {'winner': f['winner'],
                   'method': {'ko': 'KO/TKO', 'sub': 'Submission', 'dec': 'Decision'}[f['method']],
                   'round': f['round'], 'timeMin': round(f['end_min'] - (f['round'] - 1) * 5, 2)},
    })

json.dump(out, open(OUT, 'w'))
print(f'wrote {len(out)} backtest fights to {OUT}', file=sys.stderr)
