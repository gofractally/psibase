#!/usr/bin/env python3
"""Read-only financial acceptance checks against the running native service.

Owner snapshots use authenticated native HTTP through the local demo wallet;
this script does not place trades, create accounts, or change token balances.
The actual-chain test suite separately audits every native escrow/table row.
"""
import json
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location("exchange_demo_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

MAX = (1 << 40) - 1


def verify(states):
    """Audit the public health and EACH owner's view, without private pool access.

    Requests can span blocks while the bot trades. A single HTTP response is
    consistent; records from different owners must not be treated as one ledger
    snapshot. The native test suite audits the complete escrow/risk schedule.
    """
    markets_seen, active_positions, checks = set(), set(), 0
    for state in states:
        owner = state['owner']
        markets = {int(m['id']): m for m in state['markets']}
        markets_seen.update(markets)
        for mid, market in markets.items():
            x, y, k = int(market['x']), int(market['y']), int(market['k'])
            assert 0 < x <= MAX and 0 < y <= MAX and 0 < k <= x * y
            assert 0 < int(market['lp_supply']) <= MAX
            assert int(market['base_lot']) > 0 and int(market['quote_tick']) > 0
            for key in ('escrow_base', 'escrow_quote'):
                cash = market[key]
                assert cash['funded'] and int(cash['actual']) == int(cash['expected']), (mid, key, 'native escrow deficit')
            if int(market['debt_base']) or int(market['debt_quote']):
                assert market['margin_enabled']
            for side in ('base', 'quote'):
                assert int(market['vault_' + side]) + int(market['debt_' + side]) <= MAX
            checks += 1
        for level in state['levels']:
            assert set(level) == {'market', 'bid', 'price', 'outgoing', 'active'}
            assert int(level['market']) in markets
            assert 0 < int(level['price']) <= (1 << 32) - 1
            assert 0 < int(level['outgoing']) <= MAX
        for name in ('positions', 'loan_positions', 'lenders', 'relay_shares'):
            assert all(row['owner'] == owner for row in state.get(name, [])), (owner, name, 'foreign owner exposed')
        for row in state.get('balances', []):
            assert int(row['spendable']) == int(row['incoming']) + int(row['outgoing'])
            assert all(int(row[key]) >= 0 for key in ('wallet', 'incoming', 'outgoing'))
        for pos in state.get('positions', []):
            m = markets[int(pos['market'])]
            for field, asset in (('refund', 'quote' if pos['bid'] else 'base'),
                                 ('proceeds', 'base' if pos['bid'] else 'quote')):
                assert 0 <= int(pos[field]) <= int(m['escrow_' + asset]['expected'])
            checks += 1
        loans = {int(g['generation']): g for g in state.get('loans', [])}
        positions = {int(p['generation']): p for p in state.get('loan_positions', [])}
        assert set(loans) == set(positions), (owner, 'unrelated loan generation exposed')
        for generation, loan in loans.items():
            pos = positions[generation]
            assert loan['scope'] == 'own-position'
            assert int(loan['units']) == int(pos['units']) > 0
            assert int(loan['original_units']) == int(pos['units'])
            claim = int(loan['claimable_surplus'])
            assert claim == int(loan['original_surplus']) == int(loan['surplus']) >= 0
            if loan['active']:
                active_positions.add((owner, generation))
                m = markets[int(loan['market'])]
                assert claim == 0
                assert int(loan['units']) * int(loan['face_unit']) <= int(m['debt_quote' if loan['long'] else 'debt_base'])
            checks += 1
    return {'market_count': len(markets_seen), 'known_active_loan_position_count': len(active_positions),
            'known_wallet_count': len(states), 'verified_public_health_and_owner_checks': checks,
            'scope': 'Public market backing and authenticated own views; complete ledger/risk audit is in native tests'}


if __name__ == "__main__":
    states = [bridge.read_state(account) for account in sorted(bridge.ACCOUNTS)]
    result = verify(states)
    output = Path(__file__).with_name("live-verification.json")
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
