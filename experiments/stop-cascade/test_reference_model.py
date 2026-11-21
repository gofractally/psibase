#!/usr/bin/env python3
"""Seeded independent spec/metamorphic tests, not deployed-service tests."""
from copy import deepcopy
from random import Random
import unittest

from reference_model import (MAX, Ledger, Loan, Stop, apply, apply_causal,
                             atomic_auction, causal, entitlement, plan, relay)


def funded(u, v, seed, stops, loans=()):
    ledger = Ledger()
    ledger.fund("relay", "in", u); ledger.fund("relay", "out", v)
    ledger.fund("seed", "in", seed)
    for s in stops: ledger.fund(f"stop-{s.generation}", "in", s.amount)
    for g in loans: ledger.fund(f"loan-{g.generation}", "in", g.collateral)
    return ledger


class ReferenceModelTests(unittest.TestCase):
    def test_2000_seeded_escrow_and_claim_conservation_cases(self):
        rng = Random(20261121)
        for _ in range(2000):
            u, v = rng.randrange(100, 10000), rng.randrange(100, 10000)
            seed = rng.randrange(1, 100)
            stops = tuple(Stop(i, u + rng.randrange(1, 300), rng.randrange(1, 100))
                          for i in range(rng.randrange(1, 20)))
            ledger = funded(u, v, seed, stops)
            result = plan(u * v, u, v, seed, stops, stop_input_cap=rng.randrange(0, 400))
            apply(ledger, result, {})
            self.assertLessEqual(result.discovery_rounds, len(stops) + 1)
            self.assertLessEqual(result.inspections, len(stops) * (len(stops) + 1))
            selected = [s for s in stops if s.generation in result.stop_ids]
            paid_out = paid_in = 0
            for s in selected:
                output, refund = entitlement(s.amount, result.stop_total,
                                             result.stop_output, result.stop_refund)
                ledger.withdraw("batch", "out", output)
                ledger.withdraw("batch", "in", refund)
                paid_out += output; paid_in += refund
            self.assertLessEqual(paid_out, result.stop_output)
            self.assertLessEqual(paid_in, result.stop_refund)
            ledger.audit()

    def test_same_price_thousands_owners_have_identical_planning_work(self):
        # Owner records are deliberately absent from the planner's API.
        one = plan(10**8, 10000, 10000, 100, (Stop(1, 10050, 5000),))
        shares = [1] * 5000
        many = plan(10**8, 10000, 10000, 100, (Stop(1, 10050, sum(shares)),))
        self.assertEqual(one, many)
        self.assertEqual(one.inspections, 2)

    def test_minimum_seed_sixty_four_level_domino_always_bounded(self):
        stops = tuple(Stop(i, 100 + i, 1) for i in range(1, 65))
        result = plan(1000000, 100, 10000, 1, stops)
        self.assertEqual(len(result.stop_ids), 64)
        self.assertEqual(result.discovery_rounds, 65)
        self.assertEqual(result.inspections, 64 * 65)
        # The 65th price bucket is rejected at admission, not after freezing cash.
        with self.assertRaisesRegex(ValueError, "capacity"):
            plan(1000000, 100, 10000, 1, stops + (Stop(65, 165, 1),))

    def test_partial_forecast_does_not_trigger_from_refunded_input(self):
        stops = (Stop(1, 110, 100), Stop(2, 130, 100))
        limited = plan(1000000, 100, 10000, 10, stops, stop_input_cap=5)
        self.assertEqual(limited.stop_ids, (1,))
        self.assertEqual((limited.stop_used, limited.stop_refund), (5, 95))
        unlimited = plan(1000000, 100, 10000, 10, stops)
        self.assertEqual(unlimited.stop_ids, (1, 2))

    def test_zero_stop_work_finishes_refunded_without_phantom_margin(self):
        stops = (Stop(1, 110, 100),)
        loans = (Loan(2, 120, 10, 10),)
        result = plan(1000000, 100, 10000, 10, stops, loans, stop_input_cap=0)
        self.assertEqual(result.loan_ids, ())
        self.assertEqual((result.stop_used, result.stop_output, result.stop_refund), (0, 0, 100))

    def test_joint_margin_expansion_seniority_and_physical_cash(self):
        stops = (Stop(1, 105, 10), Stop(2, 125, 10))
        loans = (Loan(3, 115, 10, 100),)
        result = plan(1000000, 100, 10000, 10, stops, loans)
        self.assertEqual(result.stop_ids, (1, 2))
        self.assertEqual(result.loan_ids, (3,))
        self.assertEqual(result.final_u, 140)
        ledger = funded(100, 10000, 10, stops, loans)
        apply(ledger, result, {g.generation:g for g in loans})
        self.assertEqual(ledger.buckets["vault", "out"], 100)
        later = relay(1000000, 110, (1000000 + 109) // 110, 10)[2]
        self.assertGreaterEqual(result.margin_outputs[0], later)

    def test_invalid_seed_noop_overflow_and_oversized_snapshot_leave_cash_unchanged(self):
        stops = (Stop(1, 105, 10),)
        loans = (Loan(2, 110, 20, 100),)
        ledger = funded(100, 10000, 10, stops, loans)
        before = deepcopy(ledger)
        invalid = [dict(seed=0), dict(seed=10, seed_max_reserve=115),
                   dict(seed=10, seed_min_output=MAX), dict(seed=10, ordinary_prices=129)]
        for kw in invalid:
            with self.assertRaises(ValueError):
                plan(1000000, 100, 10000, stops=stops, loans=loans, **kw)
            self.assertEqual(ledger, before)
        with self.assertRaisesRegex(ValueError, "bound"):
            plan(MAX * MAX, MAX, MAX, 1, ())
        self.assertEqual(ledger, before)

    def test_permutations_and_direction_orientation_do_not_change_plan(self):
        stops = (Stop(1, 105, 5), Stop(2, 110, 6), Stop(3, 120, 7))
        loans = (Loan(4, 114, 3, 10), Loan(5, 124, 4, 10))
        a = plan(1000000, 100, 10000, 10, stops, loans)
        b = plan(1000000, 100, 10000, 10, tuple(reversed(stops)), tuple(reversed(loans)))
        self.assertEqual(a, b)
        # Generic in/out orientation covers buy-side collateral by swapping names;
        # mixing signed flows inside this same closure is explicitly unsupported.
        ledger = funded(100, 10000, 10, stops, loans)
        apply(ledger, b, {g.generation:g for g in loans})
        ledger.audit()

    def test_claim_order_and_wallet_splitting_cannot_overdraw(self):
        rng = Random(7)
        for _ in range(1000):
            parts = [rng.randrange(1, 100) for _ in range(50)]
            total = sum(parts); output = rng.randrange(10000); refund = rng.randrange(total + 1)
            claims = [entitlement(s, total, output, refund) for s in parts]
            self.assertLessEqual(sum(x for x, _ in claims), output)
            self.assertLessEqual(sum(x for _, x in claims), refund)
            a, b = parts[0], parts[1]
            merged = entitlement(a + b, total, output, refund)
            split_a, split_b = claims[0], claims[1]
            self.assertGreaterEqual(merged[0], split_a[0] + split_b[0])
            self.assertGreaterEqual(merged[1], split_a[1] + split_b[1])
            rng.shuffle(claims)
            self.assertEqual(sum(x for x, _ in claims), sum(x for x, _ in reversed(claims)))


class AtomicFallbackTests(unittest.TestCase):
    def test_invalidated_limit_falls_back_instead_of_freezing_price(self):
        stops = (Stop(1, 105, 10),)
        loans = (Loan(2, 110, 20, 100),)
        args = (1000000, 100, 10000, 10, stops, loans)
        original = causal(*args, seed_max_reserve=115)
        result = atomic_auction(*args, seed_max_reserve=115)
        self.assertEqual(result, original)
        self.assertFalse(result.margin_first)
        self.assertGreater(result.seed_used, 0)
        ledger = funded(100, 10000, 10, stops, loans)
        apply_causal(ledger, result, {2: loans[0]})
        ledger.audit()

    def test_minout_invalid_replay_keeps_original_valid_plan(self):
        stops = (Stop(1, 105, 10),)
        loans = (Loan(2, 115, 10, 100),)
        args = (1000000, 100, 10000, 10, stops, loans)
        original = causal(*args)
        result = atomic_auction(*args, seed_min_output=original.seed_output)
        self.assertEqual(result, original)
        self.assertFalse(result.margin_first)

    def test_budget_one_returns_pooled_refunds_without_later_phantom_triggers(self):
        stops = (Stop(1, 101, 100), Stop(2, 102, 100))
        result = atomic_auction(1000000, 100, 10000, 1, stops, route_budget=1)
        self.assertEqual(result.stop_ids, (1,))
        self.assertEqual((result.stop_used, result.stop_output, result.stop_refund), (0, 0, 100))
        self.assertEqual(result.final_u, 101)
        self.assertEqual(result.routing_steps, 1)

    def test_current_due_margin_processed_even_on_last_routing_boundary(self):
        loans = (Loan(1, 101, 10, 100),)
        result = causal(1000000, 100, 10000, 1, (), loans, route_budget=1)
        self.assertEqual(result.loan_ids, (1,))
        self.assertEqual(result.final_u, 111)
        self.assertEqual(result.routing_steps, 1)

    def test_zero_output_dust_returns_input_and_cannot_loop(self):
        result = atomic_auction(100, 100, 1, 1, ())
        self.assertEqual((result.seed_used, result.seed_output, result.seed_refund), (0, 0, 1))
        self.assertEqual(result.final_u, 100)
        self.assertEqual(result.routing_steps, 0)

    def test_process_has_no_hypothetical_seed_and_cannot_self_support(self):
        result = atomic_auction(1000000, 100, 10000, 0, (Stop(1, 110, 100),))
        self.assertEqual(result.stop_ids, ())
        self.assertEqual(result.final_u, 100)
        actual = atomic_auction(1000000, 110, (1000000 + 109) // 110,
                                0, (Stop(1, 110, 100),))
        self.assertEqual(actual.stop_ids, (1,))
        self.assertGreater(actual.stop_used, 0)

    def test_3000_seeded_atomic_cash_replay_and_permutation_cases(self):
        rng = Random(1234567)
        for _ in range(3000):
            u, v = rng.randrange(100, 1000), rng.randrange(1000, 10000)
            seed = rng.randrange(0, 100)
            stops = tuple(Stop(i, u + rng.randrange(1, 120), rng.randrange(1, 30))
                          for i in range(rng.randrange(0, 10)))
            loans = tuple(Loan(100+i, u + rng.randrange(1, 120), rng.randrange(1, 10), 1)
                          for i in range(rng.randrange(0, 5)))
            kwargs = dict(route_budget=rng.randrange(1, 20), stop_input_cap=rng.randrange(0, 100))
            result = atomic_auction(u*v, u, v, seed, stops, loans, **kwargs)
            permuted = atomic_auction(u*v, u, v, seed, tuple(reversed(stops)),
                                      tuple(reversed(loans)), **kwargs)
            self.assertEqual(result, permuted)
            self.assertLessEqual(result.routing_steps, kwargs['route_budget'])
            self.assertLessEqual(len(result.legs), kwargs['route_budget'] + len(loans))
            self.assertEqual(result.stop_used + result.stop_refund, result.stop_total)
            self.assertEqual(result.seed_used + result.seed_refund, seed)
            ledger = funded(u, v, seed, stops, loans)
            apply_causal(ledger, result, {g.generation:g for g in loans})
            ledger.audit()
            self.assertTrue(all(leg.output >= {g.generation:g.debt for g in loans}[leg.generation]
                                for leg in result.legs if leg.kind == 'margin'))

    def test_corrupted_plan_cannot_partially_mutate_reference_escrow(self):
        from dataclasses import replace
        stops = (Stop(1, 105, 10),)
        ledger = funded(100, 10000, 10, stops)
        before = deepcopy(ledger)
        result = atomic_auction(1000000, 100, 10000, 10, stops)
        broken = replace(result, final_u=result.final_u + 1)
        with self.assertRaises(AssertionError):
            apply_causal(ledger, broken, {})
        self.assertEqual(ledger, before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
