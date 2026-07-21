"""NFL spread & moneyline value model.

A leakage-safe Ridge regression that projects a single quantity -- the home
team's expected point margin -- and reads BOTH markets off that one projection:

    projected margin  ->  P(cover the spread)   (normal CDF vs the book line)
                      ->  P(win the game)        (normal CDF vs zero) -> moneyline

This mirrors the philosophy already used in the UFC model (``src/models/
ufcSimulator.js``): simulate/project an outcome distribution once, then compare
every market against it to surface positive expected-value bets.
"""

__version__ = "0.1.0"
