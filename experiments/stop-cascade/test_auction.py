#!/usr/bin/env python3
"""Exact-rational auction examples; no native service or live transactions."""
from fractions import Fraction as F
from math import isqrt
import unittest


def auction(x, y, seed, stops):
    k = x * y
    price = lambda amount: k / (x + amount) ** 2
    output = lambda amount: y - k / (x + amount)
    total, rounds = seed, []
    while True:
        included = [(trigger, amount) for trigger, amount in stops if trigger >= price(total)]
        rounds.append(total)
        following = seed + sum((amount for _, amount in included), F(0))
        if following == total:
            break
        total = following
    first = output(seed)
    stop_input = total - seed
    stop_price = (output(total) - first) / stop_input if stop_input else None
    return {'x': x + total, 'y': k / (x + total), 'total': total, 'rounds': rounds,
            'output': output(total), 'initiator': first, 'stop_price': stop_price,
            'included': included, 'remaining': [stop for stop in stops if stop not in included]}


class AuctionExamples(unittest.TestCase):
    def test_joint_forecast_includes_liquidation_price_impact(self):
        stop_only = auction(F(100), F(10000), F(10), [(F(90), F(10)), (F(65), F(10))])
        self.assertEqual(stop_only['total'], 20)
        self.assertLess(stop_only['y'] / stop_only['x'], 80)
        joint = auction(F(100), F(10000), F(10), [(F(90), F(10)), (F(80), F(10)), (F(65), F(10))])
        self.assertEqual(joint['rounds'], [10, 20, 30, 40])

    def test_margin_first_preserves_conservative_debt_bound(self):
        k, early, certified = 1_000_000, 100, 100
        for trigger, collateral, debt in [(80, 10, 400), (60, 10, 300)]:
            certified = max(certified, isqrt(k // trigger))
            lower = lambda reserve: k * collateral // (reserve * (reserve + collateral))
            self.assertLessEqual(early, certified)
            self.assertGreaterEqual(lower(early), lower(certified))
            self.assertGreaterEqual(lower(certified), debt)
            early += collateral
            certified += collateral

    def test_reordering_can_remove_the_initiating_limit(self):
        p = lambda sold: F(1_000_000, (100 + sold) ** 2)
        self.assertGreaterEqual(p(10), 80)  # Entire seed executable by itself.
        self.assertLessEqual(p(10), 90)  # Forecast would select the cohort at 90.
        self.assertLess(p(20), 80)  # Its 20 collateral first leaves zero seed.

    def test_common_stop_price_conserves_actual_output(self):
        a = auction(F(100), F(10000), F(10), [(F(90), F(10)), (F(75), F(20)), (F(60), F(10))])
        self.assertEqual(a['rounds'], [10, 20, 40, 50])
        self.assertEqual(a['output'], F(10000, 3))
        self.assertEqual(a['initiator'], F(10000, 11))
        self.assertEqual(a['stop_price'], F(2000, 33))
        self.assertEqual(a['initiator'] + 40 * a['stop_price'], a['output'])
        self.assertGreaterEqual(a['initiator'] / 10, 80)
        self.assertNotEqual(a['stop_price'], a['y'] / a['x'])

    def test_transaction_splitting_changes_which_stops_share_a_batch(self):
        stops = [(F(90), F(5)), (F(80), F(5))]
        combined = auction(F(100), F(10000), F(10), stops)
        first = auction(F(100), F(10000), F(6), stops)
        second = auction(first['x'], first['y'], F(4), first['remaining'])
        self.assertEqual((combined['x'], combined['y']), (second['x'], second['y']))
        self.assertNotEqual(first['stop_price'], second['stop_price'])
        self.assertNotEqual(first['stop_price'], combined['stop_price'])
        self.assertEqual(first['output'] + second['output'], combined['output'])

    def test_common_auction_price_does_not_preserve_prior_credit_certificate(self):
        solo = F(100) - F(10000, 110)
        self.assertGreaterEqual(solo, 8)
        combined_output = F(100) - F(10000, 200)
        collateral_allocation = combined_output * F(10, 100)
        self.assertEqual(collateral_allocation, 5)
        self.assertLess(collateral_allocation, 8)


if __name__ == '__main__':
    unittest.main(verbosity=2)
