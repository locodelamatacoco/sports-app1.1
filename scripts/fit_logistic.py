#!/usr/bin/env python3
"""
Fit a logistic regression on the derived fighter profiles and compare it,
out of sample, against the hand-specified Monte Carlo simulation.

The simulation's hazard coefficients (KO_STRIKE_COEFF, DAMAGE_PER_STRIKE, the
0-10 rating weights) were all chosen by hand and never fitted to anything.
This asks the obvious question: does fitting the same inputs to actual
outcomes do better?

Train: fights before TEST_FROM. Test: fights on/after it. Every feature is a
difference (A minus B), and the training set is mirrored (A-B with label, and
B-A with the flipped label) so the model cannot learn a corner-position bias.
"""
import json, math, random, sys

CORPUS = sys.argv[1] if len(sys.argv) > 1 else 'corpus_all.json'
TEST_FROM = sys.argv[2] if len(sys.argv) > 2 else '2023-01-01'

fights = json.load(open(CORPUS))

def feats(a, b):
    sa, sb = a['striking'], b['striking']
    ga, gb = a['grappling'], b['grappling']
    fa, fb = a['factors'], b['factors']
    return [
        sa['sigStrikesPerMin'] - sb['sigStrikesPerMin'],
        sb['strikesAbsorbedPerMin'] - sa['strikesAbsorbedPerMin'],  # absorbing less is good
        sa['strikeAccuracy'] - sb['strikeAccuracy'],
        sa['strikeDefense'] - sb['strikeDefense'],
        sa['knockdownRate'] - sb['knockdownRate'],
        sa['powerRating'] - sb['powerRating'],
        sa['pace'] - sb['pace'],
        ga['takedownsPer15'] - gb['takedownsPer15'],
        ga['takedownAccuracy'] - gb['takedownAccuracy'],
        ga['takedownDefense'] - gb['takedownDefense'],
        ga['subAttemptsPer15'] - gb['subAttemptsPer15'],
        ga['controlRating'] - gb['controlRating'],
        ga['scrambleAbility'] - gb['scrambleAbility'],
        fb['age'] - fa['age'],                                       # younger is better
        fa['reach'] - fb['reach'],
        fa['height'] - fb['height'],
        fa['cardio'] - fb['cardio'],
        fa['durability'] - fb['durability'],
        fa['recentForm'] - fb['recentForm'],
        fb['damageLastThree'] - fa['damageLastThree'],               # less damage is better
        fa['activityLevel'] - fb['activityLevel'],
        fa['oppStrength'] - fb['oppStrength'],
        fa['ufcFights'] - fb['ufcFights'],
        fa['finishRate'] - fb['finishRate'],
        fb['varianceRating'] - fa['varianceRating'],
        (1 if fb['recentKOLoss'] else 0) - (1 if fa['recentKOLoss'] else 0),
    ]

NAMES = ['slpm','absorbed','str_acc','str_def','kd15','power','pace',
         'td15','td_acc','td_def','sub15','control','scramble',
         'age','reach','height','cardio','durability','recentForm',
         'damage3','activity','oppStrength','ufcFights','finishRate',
         'variance','koLoss']

train, test = [], []
for f in fights:
    x = feats(f['fighterA'], f['fighterB'])
    y = 1 if f['result']['winner'] == 'A' else 0
    (test if f['date'] >= TEST_FROM else train).append((x, y, f))

# mirror the training set so the model is symmetric in A/B
mirrored = []
for x, y, f in train:
    mirrored.append((x, y))
    mirrored.append(([-v for v in x], 1 - y))

# standardise using training statistics only
d = len(NAMES)
mean = [sum(x[i] for x, _ in mirrored) / len(mirrored) for i in range(d)]
var = [sum((x[i] - mean[i]) ** 2 for x, _ in mirrored) / len(mirrored) for i in range(d)]
sd = [math.sqrt(v) if v > 1e-12 else 1.0 for v in var]
def z(x): return [(x[i] - mean[i]) / sd[i] for i in range(d)]

def sigmoid(t): return 1 / (1 + math.exp(-max(-30, min(30, t))))

def fit(data, l2=1.0, epochs=400, lr=0.25):
    w = [0.0] * d
    b = 0.0
    n = len(data)
    idx = list(range(n))
    for ep in range(epochs):
        random.Random(ep).shuffle(idx)
        gw = [0.0] * d
        gb = 0.0
        for j in idx:
            x, y = data[j]
            p = sigmoid(sum(w[i] * x[i] for i in range(d)) + b)
            e = p - y
            for i in range(d):
                gw[i] += e * x[i]
            gb += e
        for i in range(d):
            w[i] -= lr * (gw[i] / n + l2 * w[i] / n)
        b -= lr * gb / n
    return w, b

Z = [(z(x), y) for x, y in mirrored]
random.seed(0)
W, B = fit(Z)

def predict(x): return sigmoid(sum(W[i] * v for i, v in enumerate(z(x))) + B)

def brier(p): return sum((q - y) ** 2 for q, y in p) / len(p)
def logloss(p):
    return -sum(math.log(max(1e-6, q if y else 1 - q)) for q, y in p) / len(p)

test_pairs = [(predict(x), y) for x, y, _ in test]
train_pairs = [(predict(x), y) for x, y, _ in train]
acc = sum(1 for q, y in test_pairs if (q >= 0.5) == (y == 1)) / len(test_pairs)

print(f'train fights {len(train)} (mirrored {len(mirrored)}), test fights {len(test)} from {TEST_FROM}')
print()
print(f'LOGISTIC  test  brier {brier(test_pairs):.4f}  logloss {logloss(test_pairs):.4f}  acc {100*acc:.1f}%')
print(f'LOGISTIC  train brier {brier(train_pairs):.4f}  (gap indicates overfit)')
print(f'COIN FLIP test  brier {brier([(0.5, y) for _, y in test_pairs]):.4f}  logloss {math.log(2):.4f}')
print()

# calibration bins on the favoured side
folded = [(q if q >= 0.5 else 1 - q, (q >= 0.5) == (y == 1)) for q, y in test_pairs]
edges = [0.55, 0.6, 0.65, 0.7, 0.8, 1.01]
lo = 0.5
print('LOGISTIC calibration (test, favoured side):')
for hi in edges:
    b = [p for p in folded if lo <= p[0] < hi]
    if b:
        pred = sum(p[0] for p in b) / len(b)
        act = sum(1 for p in b if p[1]) / len(b)
        print(f'  {lo*100:.0f}-{min(hi,1)*100:.0f}'.ljust(10)
              + f'n={len(b):<5} predicted {100*pred:.1f}% -> actual {100*act:.1f}%  {100*(act-pred):+.1f}')
    lo = hi
print()
print('feature weights (standardised, most important first):')
for nm, wt in sorted(zip(NAMES, W), key=lambda t: -abs(t[1]))[:14]:
    print(f'  {nm:<14} {wt:+.3f}')

json.dump({'weights': dict(zip(NAMES, W)), 'bias': B, 'mean': mean, 'sd': sd,
           'names': NAMES, 'testFrom': TEST_FROM,
           'metrics': {'brier': brier(test_pairs), 'logloss': logloss(test_pairs),
                       'accuracy': acc, 'nTest': len(test), 'nTrain': len(train)}},
          open('logistic_model.json', 'w'), indent=1)
print('\nwrote logistic_model.json')
