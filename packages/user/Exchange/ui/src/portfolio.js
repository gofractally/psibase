import { fundingPaused } from './market-policy.js';
import { ownStops, stopPayouts, stopRemaining } from './stop-orders.js';

const key = value => String(value?.value ?? value ?? '');
const amount = value => BigInt(value?.value ?? value ?? 0);
const add = (map, token, value) => map.set(key(token), (map.get(key(token)) || 0n) + value);

// Build once per authenticated snapshot, then make ticket/asset lookups O(1).
// Native refund/proceeds DTOs remain authoritative; public depth cannot replace
// an owner's exact entitlement and ordinarily contains no generation ID.
export function projectPortfolio(snapshot, owner) {
  const markets = new Map((snapshot?.markets || []).map(row => [key(row.id), row]));
  const loans = new Map((snapshot?.loans || []).map(row => [key(row.generation ?? row.id), row]));
  const levels = new Map((snapshot?.levels || []).filter(row => row.id !== undefined || row.generation !== undefined).map(row => [key(row.id ?? row.generation), row]));
  const balances = new Map((snapshot?.balances || []).map(row => [key(row.token ?? row.token_id), row]));
  const accrued = new Map(), committed = new Map();
  const own = row => key(row.owner ?? row.account) === owner;
  for (const position of snapshot?.positions || []) {
    if (!own(position)) continue;
    const market = markets.get(key(position.market));
    if (!market) continue;
    const input = position.bid ? market.quote : market.base;
    const output = position.bid ? market.base : market.quote;
    if (!fundingPaused(market)) add(accrued, output, amount(position.proceeds));
    if (position.refund !== undefined) add(committed, input, amount(position.refund));
    else {
      const level = levels.get(key(position.generation));
      if (level) add(committed, input, amount(position.shares) * amount(level.outgoing) / (amount(level.shares) || 1n));
    }
  }
  for (const position of snapshot?.loan_positions || []) {
    if (!own(position)) continue;
    const market = markets.get(key(position.market));
    const loan = loans.get(key(position.generation));
    if (!market || !loan) continue;
    if (loan.active === false) {
      if (!fundingPaused(market)) add(accrued, loan.long ? market.quote : market.base,
        loan.claimable_surplus !== undefined ? amount(loan.claimable_surplus) : amount(position.units) * amount(loan.original_surplus) / (amount(loan.original_units) || 1n));
    } else add(committed, loan.long ? market.base : market.quote, amount(position.units) * amount(loan.collateral_unit));
  }
  for (const position of ownStops(snapshot, owner)) {
    const market = markets.get(key(position.market));
    if (!market) continue;
    const input = position.sell_base ? market.base : market.quote;
    const output = position.sell_base ? market.quote : market.base;
    add(committed, input, stopRemaining(position));
    if (!fundingPaused(market)) {
      const payout = stopPayouts(position);
      add(accrued, input, payout.input);
      add(accrued, output, payout.output);
    }
  }
  return {
    balance: token => balances.get(key(token)) || {},
    available: token => {
      const row = balances.get(key(token)) || {};
      return amount(row.spendable ?? amount(row.incoming) + amount(row.outgoing)) + (accrued.get(key(token)) || 0n);
    },
    committed: token => committed.get(key(token)) || 0n,
  };
}
