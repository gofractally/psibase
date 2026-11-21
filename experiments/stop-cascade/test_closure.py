#!/usr/bin/env python3
"""Proposal-only exact-integer cascade experiment; not a deployed-contract test.

Run with Python 3.10+: python3 experiments/stop-cascade/test_closure.py
Only the standard library is used. No network, database, or chain is accessed.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from fractions import Fraction
from math import isqrt
from random import Random
import unittest


@dataclass(frozen=True, slots=True)
class Node:
    stop_input: int
    required_seed: int
    count: int
    height: int
    left: Node | None = None
    right: Node | None = None


def merge(left: Node, right: Node) -> Node:
    """Ordered concatenation: H=max(H_left, H_right-C_left)."""
    return Node(left.stop_input + right.stop_input,
                max(left.required_seed, right.required_seed - left.stop_input),
                left.count + right.count, 1 + max(left.height, right.height),
                left, right)


def tree(levels: list[tuple[int, int]]) -> Node:
    """Levels are (required cumulative sale, funded stop input), in trigger order."""
    assert levels
    assert all(r >= 0 and c >= 0 for r, c in levels)
    assert all(a[0] <= b[0] for a, b in zip(levels, levels[1:]))

    def build(lo: int, hi: int) -> Node:
        if hi - lo == 1:
            required, size = levels[lo]
            return Node(size, required, 1, 0)
        mid = (lo + hi) // 2
        return merge(build(lo, mid), build(mid, hi))

    return build(0, len(levels))


def linear_closure(levels: list[tuple[int, int]], seed: int) -> tuple[int, int]:
    """Causal reference: a stop cannot finance reaching its own trigger."""
    assert seed >= 0
    sale, count = seed, 0
    for required, size in levels:
        if sale < required:
            break
        sale += size
        count += 1
    return count, sale


def tree_closure(node: Node, sale: int) -> tuple[int, int, int]:
    """Return (activated levels, final sale, summary nodes read).

    Does not visit an accepted node's children or enumerate its owners.
    This is discovery only; it does not execute trades or mutate a database.
    """
    assert sale >= 0
    if sale >= node.required_seed:
        return node.count, sale + node.stop_input, 1
    if node.left is None:
        return 0, sale, 1
    assert node.right is not None
    count, sale, reads = tree_closure(node.left, sale)
    if count != node.left.count:
        return count, sale, reads + 1
    more, sale, right_reads = tree_closure(node.right, sale)
    return count + more, sale, reads + right_reads + 1


class ClosureExperiment(unittest.TestCase):
    def test_25600_random_exact_linear_comparisons_and_node_bound(self):
        rng = Random(721)
        cases, maximum_reads = 0, 0
        for n in range(1, 257):
            for _ in range(100):
                thresholds = sorted(rng.randrange(10_000) for _ in range(n))
                levels = list(zip(thresholds, [rng.randrange(150) for _ in range(n)]))
                seed = rng.randrange(10_000)
                root = tree(levels)
                count, sale, reads = tree_closure(root, seed)
                self.assertEqual((count, sale), linear_closure(levels, seed))
                self.assertLessEqual(reads, 2 * root.height + 1)
                maximum_reads = max(maximum_reads, reads)
                cases += 1
        self.assertEqual(cases, 25_600)
        print(f"\nExact random cases: {cases}; maximum summary reads: {maximum_reads}")

    def test_dense_65536_level_domino_cascade_reads_only_root(self):
        n = 65_536
        root = tree([(i, 1) for i in range(1, n + 1)])
        self.assertEqual(root.required_seed, 1)
        self.assertEqual(tree_closure(root, 1), (n, n + 1, 1))

    def test_multiple_fixed_points_require_causal_barrier(self):
        levels, seed = [(10, 20)], 5
        # T(k)=number of thresholds reached by seed + input of the first k stops.
        # Both k=0 and k=1 solve T(k)=k, but only k=0 is causally reachable.
        prefixes = [0, 20]
        fixed_points = [k for k in (0, 1)
                        if bisect_right([10], seed + prefixes[k]) == k]
        self.assertEqual(fixed_points, [0, 1])
        self.assertEqual(tree_closure(tree(levels), seed)[:2], (0, 5))
        self.assertEqual(tree_closure(tree(levels), 10)[:2], (1, 30))

    def test_inclusive_thresholds_and_unreachable_gap(self):
        levels = [(10, 7), (17, 4), (100, 100)]
        self.assertEqual(tree_closure(tree(levels), 10)[:2], (2, 21))
        self.assertEqual(tree_closure(tree(levels), 9)[:2], (0, 9))
        # The third stop's own 100 cannot be used to cross the preceding gap.
        self.assertEqual(tree(levels).required_seed, 89)

    def test_summary_merge_is_associative(self):
        a, b, c = (Node(size, required, 1, 0)
                   for required, size in [(10, 7), (17, 4), (100, 100)])
        left, right = merge(merge(a, b), c), merge(a, merge(b, c))
        self.assertEqual((left.stop_input, left.required_seed, left.count),
                         (right.stop_input, right.required_seed, right.count))

    def test_lot_nonmonotonic_warning_math_model_not_deployed_contract(self):
        # Model the native router's branch that skips a bid when the remaining
        # base input is smaller than one input lot. This is a math model only;
        # it neither invokes nor certifies the deployed router.
        k, initial_x, initial_y = 10**10, 10_000, 1_000_000
        base_lot, quote_tick, bid_tick = 100, 100, 100
        self.assertEqual(isqrt(k * base_lot // (bid_tick * quote_tick)), initial_x)
        # 99 atoms cannot fill a 100-atom book lot, so they enter the relay.
        x99 = initial_x + 99
        y99 = (k + x99 - 1) // x99
        output99 = initial_y - y99
        # 100 atoms fill one funded bid lot, leaving relay reserves unchanged.
        x100, output100 = initial_x, bid_tick * quote_tick
        self.assertGreater(Fraction(k, x100 * x100), Fraction(k, x99 * x99))
        self.assertGreater(output100, output99)
        trigger99 = isqrt(k * base_lot // (99 * quote_tick))
        self.assertGreaterEqual(x99, trigger99)
        self.assertLess(x100, trigger99)
        # Consequently a monotone total-sale threshold model cannot be assumed
        # for arbitrary atom quantities under this branch policy.


if __name__ == "__main__":
    unittest.main(verbosity=2)
