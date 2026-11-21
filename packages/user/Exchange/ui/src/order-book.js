const n = value => BigInt(value?.value ?? value ?? 0);

// Native order-book entries are combined by price, just as in a conventional
// exchange display. Only executable whole market lots enter public depth.
export function depthRows(levels, market, bid, limit = 14) {
  const sorted = levels.filter(row => Boolean(row.bid) === bid && row.active !== false && n(row.outgoing) > 0n)
    .sort((a, b) => n(a.price) === n(b.price) ? 0 : (n(a.price) < n(b.price) ? -1 : 1) * (bid ? -1 : 1));
  let totalBase = 0n, totalQuote = 0n;
  return sorted.slice(0, limit).map(row => {
    const lotQuote = n(row.price) * n(market.quote_tick);
    const size = (bid ? n(row.outgoing) / lotQuote : n(row.outgoing) / n(market.base_lot)) * n(market.base_lot);
    const quote = size / n(market.base_lot) * lotQuote;
    totalBase += size; totalQuote += quote;
    return { ...row, size, quote, totalBase, totalQuote };
  });
}
export function orderSpread(levels, market) {
  const bid = depthRows(levels, market, true, 1)[0];
  const ask = depthRows(levels, market, false, 1)[0];
  if (!bid || !ask) return null;
  const difference = n(ask.price) - n(bid.price);
  if (difference < 0n) return null;
  return { ticks: difference, percentScaled: difference * 2n * 1_000_000n / (n(ask.price) + n(bid.price)) };
}
export function quoteForSize(size, tick, market) {
  size = n(size);
  const lot = n(market.base_lot);
  if (size <= 0n || size % lot) throw new Error('Order size must match this market’s minimum size increment.');
  return size / lot * n(tick) * n(market.quote_tick);
}
export function maximumBidSize(quote, tick, market) {
  return n(quote) / (n(tick) * n(market.quote_tick)) * n(market.base_lot);
}
export function unitsFromAmount(amount, perUnit, name = 'Amount') {
  amount = n(amount); perUnit = n(perUnit);
  if (amount <= 0n || perUnit <= 0n || amount % perUnit) throw new Error(`${name} must match the displayed amount increment.`);
  return amount / perUnit;
}
export function ownershipForDeposit(baseAmount, market) {
  return n(baseAmount) * n(market.lp_supply) / n(market.x);
}
export function ownershipForWithdrawal(amount, owned, supply, assets) {
  amount = n(amount); owned = n(owned); supply = n(supply); assets = n(assets);
  const maximum = owned * assets / supply;
  if (amount <= 0n || amount > maximum) throw new Error('Withdrawal exceeds your available position.');
  if (amount === maximum) return owned;
  const result = amount * supply / assets;
  if (!result) throw new Error('Withdrawal amount is too small.');
  return result;
}
export function tradePriceAtoms(trade, basePrecision) {
  const base = n(trade.base_amount);
  if (!base) return null;
  return n(trade.quote_amount) * 10n ** BigInt(basePrecision) / base;
}
