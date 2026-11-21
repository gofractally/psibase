// Display gates mirror native market capabilities. They never replace the
// service's own immutable-token, funding, or liquidation-certificate checks.
export function fundingPaused(market) {
  return market?.legacy_unsupported === true || market?.escrow_base?.funded === false || market?.escrow_quote?.funded === false;
}
export function creditStatus(market) {
  if (fundingPaused(market)) return { enabled: false, label: 'Funding paused', reason: 'New funding is paused because this market’s token backing is unavailable. Existing position actions remain available.' };
  if (market?.margin_enabled !== true) return { enabled: false, label: 'Spot only', reason: 'This book supports spot trading. Choose a margin-enabled market to borrow or supply a lending vault. Margin eligibility is fixed when a market is created.' };
  if (market?.escrow_base?.funded !== true || market?.escrow_quote?.funded !== true) return { enabled: false, label: 'Margin enabled', reason: 'Waiting for the market’s native backing status before accepting new credit.' };
  return { enabled: true, label: 'Margin enabled', reason: '' };
}
