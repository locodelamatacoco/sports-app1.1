"""Check a price you found by hand against the model.

The model shops OddsTrader automatically. Other odds screens -- Shurzy, a
sportsbook app -- can only be checked by hand, so this takes the number you see
and runs it through the same gate the model uses:

    python scripts/check_price.py SEA -3 -118
    python scripts/check_price.py SEA -3 -118  SEA -3.5 +102  CHI +3 -102
    python scripts/check_price.py --ladder SEA     # every nearby line, worst price that bets

Each check is TEAM LINE PRICE, the line written the way the book shows it for
that team (-3 = laying three). It uses the projections from the last model run
(output/nfl_edges.json), so run the model first if QB news has moved anything.
It never writes to the ledger: if a price is worth taking, record it the usual
way.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nfl_model import edges, ladder, simulation as sim  # noqa: E402
from nfl_model import odds as odds_math  # noqa: E402

EDGES_PATH = ROOT / "output" / "nfl_edges.json"


def find_game(games, team: str):
    team = team.upper()
    matches = [g for g in games if team in (g["home"], g["away"])]
    if not matches:
        raise SystemExit(f"{team} is not on the last run's slate -- run the model first.")
    return sorted(matches, key=lambda g: g.get("kickoff") or "")[-1]


def check(game: dict, sigma: float, team: str, team_line: float, price: float) -> dict:
    """Price one side at one number, exactly as the model's gate would."""
    team = team.upper()
    side = "home" if team == game["home"] else "away"
    # nflverse convention: positive = home favoured. SEA (home) -3 -> +3;
    # CHI (away) +3 -> +3.
    line = -team_line if side == "home" else team_line
    # The gate prices on the honest projection (the model's number pulled
    # toward the market line); older exports only carry the raw one.
    pred = _pricing_margin(game)
    prob = edges._cover_prob(pred, line, sigma, side)
    push = sim.push_prob(pred, line, sigma)
    label = edges._spread_label(team, team_line)
    wager = edges._wager("spread", side, label, prob, price, line=line, push_prob=push)
    claimed = edges._cover_prob(float(game["projectedMargin"]), line, sigma, side)
    return {"wager": wager, "push": push, "required": edges.required_edge(price),
            "claimed": claimed}


def _pricing_margin(game: dict) -> float:
    honest = game.get("honestMargin")
    return float(game["projectedMargin"] if honest is None else honest)


def parse_checks(tokens):
    if len(tokens) % 3:
        raise SystemExit("Give each check as TEAM LINE PRICE, e.g. SEA -3 -118")
    out = []
    for i in range(0, len(tokens), 3):
        team, line, price = tokens[i:i + 3]
        try:
            line_f, price_f = float(line), float(price)
        except ValueError:
            raise SystemExit(f"Could not read '{line} {price}' as a line and a price.")
        if not odds_math.is_valid_american(price_f):
            raise SystemExit(f"{price} is not an American price.")
        out.append((team, line_f, price_f))
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("checks", nargs="*", help="TEAM LINE PRICE [TEAM LINE PRICE ...]")
    ap.add_argument("--ladder", metavar="TEAM", action="append", default=[],
                    help="show the price ladder for this team's game")
    ap.add_argument("--edges", default=str(EDGES_PATH))
    args = ap.parse_args(argv)

    payload = json.loads(Path(args.edges).read_text())
    sigma = float(payload["model"]["sigma"])
    print(f"Projections from the run at {payload.get('generatedAt', '?')}\n")
    if not args.checks and not args.ladder:
        raise SystemExit("Give TEAM LINE PRICE checks, or --ladder TEAM.")
    for team in args.ladder:
        game = find_game(payload["games"], team)
        rungs = ladder.game_ladder(game["home"], game["away"],
                                   _pricing_margin(game), sigma,
                                   float(game["market"]["spreadLine"]))
        print(f"-- {game['away']} @ {game['home']}: model {game['home']} "
              f"{float(game['projectedMargin']):+.2f}, honest {game['home']} "
              f"{_pricing_margin(game):+.2f}, market {game['home']} "
              f"{-float(game['market']['spreadLine']):+g}. Bets at the price shown or better:")
        for side in ("home", "away"):
            print(f"   {game[side]:<4} {ladder.format_rungs(rungs[side])}")
        print()
    if not args.checks:
        return
    print(f"{'price':<18}{'claims':>7}{'honest':>8}{'push':>7}{'edge':>8}{'needs':>7}{'EV':>8}   verdict")

    shown = set()
    for team, line, price in parse_checks(args.checks):
        game = find_game(payload["games"], team)
        r = check(game, sigma, team, line, price)
        w = r["wager"]
        gid = game["id"]
        if gid not in shown:
            shown.add(gid)
            best = game.get("bestBet")
            pick = (f"bet {best['label']} {best['book_odds']:+.0f}"
                    if best and best.get("qualifies") else "no bet on the honest number")
            print(f"-- {game['away']} @ {game['home']}: projected "
                  f"{game['home']} {float(game['projectedMargin']):+.2f}; {pick}")
        verdict = "BET -- clears the gate" if w.qualifies else "pass"
        print(f"{w.label + ' ' + format(price, '+.0f'):<18}{r['claimed']:>7.1%}{w.model_prob:>8.1%}{r['push']:>7.1%}"
              f"{w.edge:>+8.1%}{r['required']:>7.1%}{w.ev:>+8.1%}   {verdict}")


if __name__ == "__main__":
    main()
