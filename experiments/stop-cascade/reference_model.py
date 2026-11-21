"""Independent integer reference for an ATOMIC, one-direction stop auction.

This is a specification model, not a native implementation or a proof of the
hybrid router. It has no chain/network access. Trigger coordinates are supplied
explicitly; the counterexamples in test_closure.py explain why arbitrary-atom
hybrid routing cannot silently inherit this relay-only monotonicity proof.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

MAX = (1 << 40) - 1
MAX_STOPS = 64
MAX_BOOK_PRICES = 128
MAX_LOANS = 64


def checked(value: int) -> int:
    if type(value) is not int or not 0 <= value <= MAX:
        raise ValueError("amount outside checked native bound")
    return value


def relay(k: int, u: int, v: int, size: int) -> tuple[int, int, int]:
    checked(u); checked(v); checked(size)
    if k <= 0 or k > u * v or size <= 0:
        raise ValueError("invalid funded relay")
    end = checked(u + size)
    remaining = (k + end - 1) // end
    if remaining > v:
        raise ValueError("output reserve grew")
    return end, remaining, v - remaining


@dataclass(frozen=True)
class Stop:
    generation: int
    trigger_reserve: int
    amount: int


@dataclass(frozen=True)
class Loan:
    generation: int
    trigger_reserve: int
    collateral: int
    debt: int


@dataclass(frozen=True)
class Plan:
    stop_ids: tuple[int, ...]
    loan_ids: tuple[int, ...]
    margin_outputs: tuple[int, ...]
    seed_input: int
    seed_output: int
    stop_total: int
    stop_used: int
    stop_refund: int
    stop_output: int
    final_u: int
    final_v: int
    discovery_rounds: int
    inspections: int


def plan(k: int, u: int, v: int, seed: int, stops: tuple[Stop, ...],
         loans: tuple[Loan, ...] = (), *, stop_input_cap: int = MAX,
         seed_min_output: int = 0, seed_max_reserve: int | None = None,
         ordinary_prices: int = 0) -> Plan:
    """Least joint closure, senior ordered loans, seed, then pooled stops.

    A constant executable stop-input cap is part of this model's advertised
    partial-fill policy. Forecast and replay BOTH use that cap. The unused
    input and acquired output share the original sealed input denominator.
    Seed validation is full-seed-or-reject here; no partial seed is guessed.
    All errors happen before a Ledger is mutated.
    """
    checked(seed); checked(stop_input_cap); checked(seed_min_output)
    if seed <= 0:
        raise ValueError("no causal seed")
    if len(stops) > MAX_STOPS or len(loans) > MAX_LOANS:
        raise ValueError("active cohort capacity")
    if not 0 <= ordinary_prices <= MAX_BOOK_PRICES:
        raise ValueError("ordinary book capacity")
    if len({s.generation for s in stops}) != len(stops):
        raise ValueError("duplicate stop generation")
    if len({g.generation for g in loans}) != len(loans):
        raise ValueError("duplicate loan generation")
    for s in stops:
        checked(s.trigger_reserve); checked(s.amount)
        if not s.amount:
            raise ValueError("zero stop")
    for g in loans:
        checked(g.trigger_reserve); checked(g.collateral); checked(g.debt)
        if not g.collateral or not g.debt:
            raise ValueError("empty protected loan")
    # Aggregates need the same explicit bound as individual positions.
    checked(sum(s.amount for s in stops))
    checked(sum(g.collateral for g in loans))
    ordered = tuple(sorted(loans, key=lambda g: (g.trigger_reserve, g.generation)))
    selected_stops: set[int] = set()
    selected_loans: set[int] = set()
    rounds = inspections = 0
    while True:
        rounds += 1
        size = sum(s.amount for s in stops if s.generation in selected_stops)
        collateral = sum(g.collateral for g in loans if g.generation in selected_loans)
        reserve = checked(u + seed + collateral + min(size, stop_input_cap))
        new_stops = {s.generation for s in stops if s.trigger_reserve <= reserve}
        new_loans = {g.generation for g in loans if g.trigger_reserve <= reserve}
        inspections += len(stops) + len(loans)
        if new_stops == selected_stops and new_loans == selected_loans:
            break
        # With positive input and fixed partial cap, no selected trigger recedes.
        assert selected_stops <= new_stops and selected_loans <= new_loans
        selected_stops, selected_loans = new_stops, new_loans
        assert rounds <= len(stops) + len(loans)

    outputs = []
    active_loans = tuple(g for g in ordered if g.generation in selected_loans)
    for g in active_loans:
        u, v, output = relay(k, u, v, g.collateral)
        if output < g.debt:
            raise ValueError("senior debt underfunded")
        outputs.append(output)
    if seed_max_reserve is not None and u + seed > seed_max_reserve:
        raise ValueError("senior replay invalidated seed limit")
    u, v, seed_output = relay(k, u, v, seed)
    if seed_output < seed_min_output:
        raise ValueError("seed minimum output")
    stop_total = sum(s.amount for s in stops if s.generation in selected_stops)
    stop_used = min(stop_total, stop_input_cap)
    output = 0
    if stop_used:
        u, v, output = relay(k, u, v, stop_used)
    return Plan(tuple(sorted(selected_stops)), tuple(g.generation for g in active_loans),
                tuple(outputs), seed, seed_output, stop_total, stop_used,
                stop_total - stop_used, output, u, v, rounds, inspections)


@dataclass
class Ledger:
    """Native escrow/cache identity, with named disjoint financial categories."""
    physical: dict[str, int] = field(default_factory=lambda: {"in": 0, "out": 0})
    buckets: dict[tuple[str, str], int] = field(default_factory=dict)

    def fund(self, name: str, asset: str, amount: int) -> None:
        checked(amount)
        self.physical[asset] += amount
        key = (name, asset)
        self.buckets[key] = self.buckets.get(key, 0) + amount
        self.audit()

    def move(self, source: str, target: str, asset: str, amount: int) -> None:
        checked(amount)
        if amount == 0:
            self.audit()
            return
        source_key, target_key = (source, asset), (target, asset)
        if self.buckets.get(source_key, 0) < amount:
            raise ValueError("unfunded internal move")
        self.buckets[source_key] -= amount
        self.buckets[target_key] = self.buckets.get(target_key, 0) + amount
        self.audit()

    def withdraw(self, source: str, asset: str, amount: int) -> None:
        checked(amount)
        if amount == 0:
            self.audit()
            return
        if self.buckets.get((source, asset), 0) < amount:
            raise ValueError("unfunded withdrawal")
        self.buckets[source, asset] -= amount
        self.physical[asset] -= amount
        self.audit()

    def audit(self) -> None:
        assert all(v >= 0 for v in self.buckets.values())
        for asset in self.physical:
            assert self.physical[asset] == sum(v for (name, a), v in self.buckets.items()
                                               if a == asset)


def apply(ledger: Ledger, result: Plan, loans: Mapping[int, Loan]) -> None:
    """Apply a previously validated plan; no owner enumeration or new decisions."""
    for generation, output in zip(result.loan_ids, result.margin_outputs):
        g = loans[generation]
        name = f"loan-{generation}"
        ledger.move(name, "relay", "in", g.collateral)
        ledger.move("relay", "vault", "out", g.debt)
        ledger.move("relay", f"surplus-{generation}", "out", output - g.debt)
    ledger.move("seed", "relay", "in", result.seed_input)
    ledger.move("relay", "seed-proceeds", "out", result.seed_output)
    for generation in result.stop_ids:
        # Actual source-pool pooling is a bounded per-price operation, not owners.
        amount = ledger.buckets.get((f"stop-{generation}", "in"), 0)
        ledger.move(f"stop-{generation}", "batch", "in", amount)
    ledger.move("batch", "relay", "in", result.stop_used)
    ledger.move("relay", "batch", "out", result.stop_output)
    assert ledger.buckets["relay", "in"] == result.final_u
    assert ledger.buckets["relay", "out"] == result.final_v
    assert ledger.buckets.get(("batch", "in"), 0) == result.stop_refund
    ledger.audit()


def entitlement(contribution: int, total: int, output: int, refund: int) -> tuple[int, int]:
    """Exact ideal common-price claims; unallocated atom dust remains funded."""
    checked(contribution); checked(total); checked(output); checked(refund)
    if total <= 0 or contribution > total:
        raise ValueError("invalid sealed denominator")
    return contribution * output // total, contribution * refund // total


@dataclass(frozen=True)
class Leg:
    kind: str
    generation: int
    amount: int
    output: int


@dataclass(frozen=True)
class CausalResult:
    stop_ids: tuple[int, ...]
    loan_ids: tuple[int, ...]
    legs: tuple[Leg, ...]
    seed_used: int
    seed_output: int
    seed_refund: int
    stop_total: int
    stop_used: int
    stop_output: int
    stop_refund: int
    final_u: int
    final_v: int
    routing_steps: int
    margin_first: bool = False


def causal(k: int, initial_u: int, initial_v: int, seed: int,
           stops: tuple[Stop, ...], loans: tuple[Loan, ...] = (), *,
           route_budget: int = 256, stop_input_cap: int = MAX,
           seed_max_reserve: int | None = None, seed_min_output: int = 0,
           senior: tuple[int, ...] = ()) -> CausalResult:
    """Independent operational reference: actual reached boundaries latch triggers.

    One direction, relay only. Margin work is separately bounded by loan count;
    routing budget exhaustion returns unspent input instead of hanging. A zero
    output leg is NOT applied. New stops join the same output/refund denominator.
    `senior` is used only to test one proposed margin-first replay.
    """
    if not 0 < route_budget <= 256 or not 0 <= seed <= MAX:
        raise ValueError("invalid bounded execution request")
    if len(stops) > MAX_STOPS or len(loans) > MAX_LOANS:
        raise ValueError("active cohort capacity")
    checked(stop_input_cap)
    checked(sum(s.amount for s in stops)); checked(sum(g.collateral for g in loans))
    if any(s.amount <= 0 for s in stops) or any(g.collateral <= 0 or g.debt <= 0 for g in loans):
        raise ValueError("empty cohort")
    if len({s.generation for s in stops}) != len(stops) or len({g.generation for g in loans}) != len(loans):
        raise ValueError("duplicate generation")
    ordered_stops = tuple(sorted(stops, key=lambda s: (s.trigger_reserve, s.generation)))
    ordered_loans = tuple(sorted(loans, key=lambda g: (g.trigger_reserve, g.generation)))
    by_loan = {g.generation: g for g in loans}
    u, v = initial_u, initial_v
    armed: set[int] = set(); closed: set[int] = set()
    legs: list[Leg] = []
    remaining_seed, pending_stop = seed, 0
    stop_total = stop_allowed = seed_output = stop_output = stop_used = routing_steps = 0

    def close(g: Loan) -> None:
        nonlocal u, v
        u, v, out = relay(k, u, v, g.collateral)
        if out < g.debt:
            raise ValueError("senior debt underfunded")
        closed.add(g.generation)
        legs.append(Leg("margin", g.generation, g.collateral, out))

    for generation in senior:
        if generation in closed:
            raise ValueError("duplicate senior liquidation")
        close(by_loan[generation])

    while True:
        # Resolve every currently due protected cohort even if the final ordinary
        # routing step ended exactly at its boundary. This loop closes each once.
        due = next((g for g in ordered_loans
                    if g.generation not in closed and g.trigger_reserve <= u), None)
        if due is not None:
            close(due)
            continue
        for s in ordered_stops:
            if s.generation not in armed and s.trigger_reserve <= u:
                armed.add(s.generation)
                stop_total += s.amount
                admitted = min(s.amount, stop_input_cap - stop_allowed)
                pending_stop += admitted
                stop_allowed += admitted
        if routing_steps == route_budget:
            break
        kind = "seed" if remaining_seed else "stop"
        available = remaining_seed if remaining_seed else pending_stop
        if not available:
            break
        barriers = [g.trigger_reserve for g in ordered_loans if g.generation not in closed]
        barriers += [s.trigger_reserve for s in ordered_stops if s.generation not in armed]
        boundary = min(barriers, default=MAX)
        if kind == "seed" and seed_max_reserve is not None:
            boundary = min(boundary, seed_max_reserve)
        if boundary <= u:
            # Only an unexecutable seed limit can remain after due work resolves.
            assert kind == "seed" and seed_max_reserve is not None
            remaining_seed = 0
            continue
        amount = min(available, boundary - u, MAX - u)
        if amount <= 0:
            break
        next_u, next_v, out = relay(k, u, v, amount)
        if not out:
            break
        u, v = next_u, next_v
        legs.append(Leg(kind, 0, amount, out))
        routing_steps += 1
        if kind == "seed":
            remaining_seed -= amount
            seed_output += out
        else:
            pending_stop -= amount
            stop_used += amount
            stop_output += out
        assert len(legs) <= route_budget + len(loans)
    seed_used = sum(leg.amount for leg in legs if leg.kind == "seed")
    if seed_output < seed_min_output:
        raise ValueError("seed minimum output")
    return CausalResult(tuple(sorted(armed)), tuple(g.generation for g in ordered_loans if g.generation in closed),
                        tuple(legs), seed_used, seed_output, seed - seed_used,
                        stop_total, stop_used, stop_output, stop_total - stop_used,
                        u, v, routing_steps)


def atomic_auction(k: int, u: int, v: int, seed: int,
                   stops: tuple[Stop, ...], loans: tuple[Loan, ...] = (), **kwargs) -> CausalResult:
    """Final approved policy model: one causal plan, one replay, safe fallback.

    Do not iterate reordering to a fixed point. Do not reject a valid causal
    execution just because prospective senior order makes the seed unexecutable.
    This reference still does not model hybrid price levels or mixed directions.
    """
    original = causal(k, u, v, seed, stops, loans, **kwargs)
    try:
        replay = causal(k, u, v, seed, stops, loans, senior=original.loan_ids, **kwargs)
    except ValueError:
        return original
    if replay.seed_used < original.seed_used or not set(replay.loan_ids) <= set(original.loan_ids):
        return original
    return CausalResult(**{**replay.__dict__, "margin_first": True})


def apply_causal(ledger: Ledger, result: CausalResult, loans: Mapping[int, Loan]) -> None:
    """Apply operational legs to a copy, committing only a completely valid result."""
    from copy import deepcopy
    shadow = deepcopy(ledger)
    for generation in result.stop_ids:
        amount = shadow.buckets.get((f"stop-{generation}", "in"), 0)
        shadow.move(f"stop-{generation}", "batch", "in", amount)
    for leg in result.legs:
        if leg.kind == "margin":
            g = loans[leg.generation]
            shadow.move(f"loan-{g.generation}", "relay", "in", leg.amount)
            shadow.move("relay", "vault", "out", g.debt)
            shadow.move("relay", f"surplus-{g.generation}", "out", leg.output - g.debt)
        else:
            source = "seed" if leg.kind == "seed" else "batch"
            target = "seed-proceeds" if leg.kind == "seed" else "batch"
            shadow.move(source, "relay", "in", leg.amount)
            shadow.move("relay", target, "out", leg.output)
    assert shadow.buckets["relay", "in"] == result.final_u
    assert shadow.buckets["relay", "out"] == result.final_v
    assert shadow.buckets.get(("batch", "in"), 0) == result.stop_refund
    assert shadow.buckets.get(("batch", "out"), 0) == result.stop_output
    shadow.audit()
    ledger.physical, ledger.buckets = shadow.physical, shadow.buckets
