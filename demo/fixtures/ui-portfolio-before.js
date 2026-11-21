// Previous actual UI balance helpers, preserved only as a benchmark baseline.
// This module is never imported by the exchange UI. Native DTO formulas match
// the pre-optimization app source; keep them independent of portfolio.js.
import {fundingPaused} from '../../packages/user/Exchange/ui/src/market-policy.js';
import {ownStops,stopPayouts,stopRemaining} from '../../packages/user/Exchange/ui/src/stop-orders.js';
export function beforePortfolio(state) {
 const value=v=>BigInt(v?.value??v??0), key=v=>String(v?.value??v??''), own=row=>key(row.owner??row.account)===state.account;
function accrued(id) {
  if (!state.data) return 0n;
  let amount = 0n;
  for (const p of state.data.positions || []) if (own(p)) {
    const m = (state.data.markets || []).find(m => key(m.id) === key(p.market));
    if (m && !fundingPaused(m) && key(p.bid ? m.base : m.quote) === key(id)) amount += value(p.proceeds);
  }
  for (const p of state.data.loan_positions || []) if (own(p)) {
    const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation));
    const m = (state.data.markets || []).find(m => key(m.id) === key(p.market));
    if (g && g.active === false && m && !fundingPaused(m) && key(g.long ? m.quote : m.base) === key(id)) amount += g.claimable_surplus!==undefined?value(g.claimable_surplus):value(p.units) * value(g.original_surplus) / (value(g.original_units) || 1n);
  }
  for(const p of ownStops(state.data,state.account)){
    const m=state.data.markets?.find(m=>key(m.id)===key(p.market));
    if(!m||fundingPaused(m))continue;
    const paid=stopPayouts(p);
    if(key(p.sell_base?m.base:m.quote)===key(id))amount+=paid.input;
    if(key(p.sell_base?m.quote:m.base)===key(id))amount+=paid.output;
  }
  return amount;
}

function committed(id) {
  let total = 0n;
  for (const p of state.data.positions || []) if (own(p)) {
    const m = state.data.markets.find(m => key(m.id) === key(p.market)); if (!m || key(p.bid ? m.quote : m.base) !== key(id)) continue;
    const l = (state.data.levels || []).find(l => key(l.id ?? l.generation) === key(p.generation));
    if (p.refund !== undefined) total += value(p.refund);
    else if (l) total += value(p.shares) * value(l.outgoing) / (value(l.shares) || 1n);
  }
  for (const p of state.data.loan_positions || []) if (own(p)) {
    const g = (state.data.loans || []).find(g => key(g.generation ?? g.id) === key(p.generation));
    const m = state.data.markets.find(m => key(m.id) === key(p.market));
    if (g && g.active !== false && m && key(g.long ? m.base : m.quote) === key(id)) total += value(p.units) * value(g.collateral_unit);
  }
  for(const p of ownStops(state.data,state.account)){
    const m=state.data.markets.find(m=>key(m.id)===key(p.market));
    if(m&&key(p.sell_base?m.base:m.quote)===key(id))total+=stopRemaining(p);
  }
  return total;
}
 const balance=id=>state.data.balances.find(b=>key(b.token)===key(id))||{};
 return ()=>state.data.tokens.map(t=>[value(balance(t.id).incoming)+value(balance(t.id).outgoing)+accrued(t.id),committed(t.id)]);
}
