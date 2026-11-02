"""The ladder must agree with the gate rung by rung."""
from nfl_model import edges, ladder, simulation as sim

SIGMA = 12.9175


def _qualifies(pred, side, line, price):
    home = sim.home_cover_prob(pred, line, SIGMA)
    prob = home if side == "home" else 1 - home
    return edges._wager("spread", side, "", prob, price, line=line,
                        push_prob=sim.push_prob(pred, line, SIGMA)).qualifies


def _one_worse(price):
    if price == 100:
        return -101
    return price - 1


def test_threshold_is_exact():
    for pred, side, line in [(5.33, "home", 3.0), (5.33, "home", 3.5),
                             (-6.0, "away", -3.0), (2.0, "away", 3.0)]:
        worst = ladder.worst_price(pred, SIGMA, side, line)
        assert worst is not None
        assert _qualifies(pred, side, line, worst)
        assert not _qualifies(pred, side, line, _one_worse(worst))


def test_ladder_gets_stricter_as_the_line_gets_worse():
    rungs = ladder.game_ladder("SEA", "CHI", 5.33, SIGMA, 3.0)["home"]
    pays = [ladder._payout(r["worstPrice"]) for r in rungs]   # SEA -1 .. -5
    assert pays == sorted(pays)
    assert rungs[0]["teamLine"] == -1.0 and rungs[-1]["teamLine"] == -5.0


def test_model_on_the_market_needs_plus_money_at_the_market_line():
    # Projection equals the line: neither side bets at standard juice there.
    rungs = ladder.game_ladder("SEA", "CHI", 3.0, SIGMA, 3.0)
    for side in ("home", "away"):
        at_market = next(r for r in rungs[side] if r["line"] == 3.0)
        assert ladder._payout(at_market["worstPrice"]) > ladder._payout(-110)
