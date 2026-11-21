#!/usr/bin/env python3
"""Read-only financial acceptance checks against the running native service.

Owner snapshots are authenticated chain actions through the local demo wallet;
this script does not place trades, create accounts, or change token balances.
The actual-chain test suite separately audits every native escrow/table row.
"""
import json
from math import isqrt
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location("exchange_demo_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

MAX = (1 << 40) - 1
Q = 1 << 40


def verify(states):
    market_map = {}
    loans = {}
    levels = {}
    for state in states:
        for market in state["markets"]:
            mid = int(market["id"])
            # Snapshot actions may span blocks; without economic mutations the
            # economic market records remain identical.
            assert market_map.setdefault(mid, market) == market
        for loan in state.get("loans", []):
            loans[int(loan["generation"])] = loan
        for pool in state.get("levels", []):
            levels[int(pool["id"])] = pool
    checks = 0
    for mid, market in market_map.items():
        x, y, k = int(market["x"]), int(market["y"]), int(market["k"])
        assert 0 < x <= MAX and 0 < y <= MAX and 0 < k <= x * y
        assert 0 < int(market["lp_supply"]) <= MAX
        for key in ("escrow_base", "escrow_quote"):
            cash = market[key]
            assert cash["funded"] and int(cash["actual"]) == int(cash["expected"]), (mid, key, "native escrow deficit")
        if int(market["debt_base"]) or int(market["debt_quote"]):
            assert market["margin_enabled"], "credit in market not certified immutable at creation"
        lot, tick = int(market["base_lot"]), int(market["quote_tick"])
        assert lot > 0 and tick > 0
        for long in (True, False):
            rows = sorted((g for g in loans.values() if int(g["market"]) == mid and g["long"] == long and g["active"]),
                          key=lambda g: -int(g["price"]) if long else int(g["price"]))
            assert len(rows) <= 64
            u = x if long else y
            face = collateral = 0
            for g in rows:
                p = int(g["price"])
                c = int(g["units"]) * int(g["collateral_unit"])
                debt = int(g["units"]) * int(g["face_unit"])
                h = isqrt(k * lot // (p * tick)) if long else isqrt(k * p * tick // lot)
                u = max(u, h)
                assert 0 < h <= MAX and c > 0 and debt > 0 and u + c <= MAX
                assert k * c // (u * (u + c)) >= debt, (mid, long, p, "undercovered")
                u += c
                face += debt
                collateral += c
                checks += 1
            assert collateral <= MAX
            assert face == int(market["debt_quote"] if long else market["debt_base"]), "snapshot truncated active loans"
            cash = int(market["vault_quote"] if long else market["vault_base"])
            assert cash + face <= MAX
        checks += 1
    for state in states:
        for row in state.get("balances", []):
            assert int(row["spendable"]) == int(row["incoming"]) + int(row["outgoing"])
            assert all(int(row[key]) >= 0 for key in ("wallet", "incoming", "outgoing"))
        for pos in state.get("positions", []):
            pool = levels.get(int(pos["generation"]))
            if pool is not None:
                shares, supply = int(pos["shares"]), int(pool["shares"])
                earned = shares * int(pool["index"]) - int(pos["debt"])
                assert earned >= 0 and 0 < shares <= supply
                assert int(pos["refund"]) == shares * int(pool["outgoing"]) // supply
                assert int(pos["proceeds"]) == earned // Q
                assert int(pos["proceeds"]) <= int(pool["incoming"])
                checks += 1
        for pos in state.get("loan_positions", []):
            g = loans[int(pos["generation"])]
            assert 0 < int(pos["units"]) <= int(g["units"])
            if not g["active"]:
                claim = int(pos["units"]) * int(g["original_surplus"]) // int(g["original_units"])
                assert claim <= int(g["surplus"])
                checks += 1
    return {"market_count": len(market_map), "active_cohort_count": sum(bool(g["active"]) for g in loans.values()),
            "known_wallet_count": len(states), "verified_financial_checks": checks}


if __name__ == "__main__":
    states = [bridge.read_state(account) for account in sorted(bridge.ACCOUNTS)]
    result = verify(states)
    output = Path(__file__).with_name("live-verification.json")
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
