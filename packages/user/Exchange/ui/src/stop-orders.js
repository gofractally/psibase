const n=value=>BigInt(value?.value??value??0);
const key=value=>String(value?.value??value??'');

// Private native rows are still checked against the selected wallet before
// their committed funds or exact payouts enter the interface.
export function ownStops(snapshot,account){
  return (snapshot?.stop_positions||[]).filter(row=>key(row.owner??snapshot.owner)===account);
}
export function stopPayouts(position){
  if(!['filled','partially_filled','unfilled'].includes(position.status)||position.can_claim===false)return {input:0n,output:0n};
  return {input:n(position.claimable_input),output:n(position.claimable_output)};
}
export function stopRemaining(position){return position.status==='armed'?n(position.remaining_outgoing):0n;}
export function canCancelStop(position){return position.status==='armed'&&position.can_cancel!==false&&stopRemaining(position)>0n;}
export function minimumStopAmount(market,sellBase,trigger,snapshot,account){
  const existing=ownStops(snapshot,account).some(position=>position.status==='armed'&&stopRemaining(position)>0n&&key(position.market)===key(market.id)&&position.sell_base===sellBase&&n(position.trigger)===n(trigger));
  return existing?1n:sellBase?n(market.base_lot):n(trigger)*n(market.quote_tick);
}
export function stopStatus(position){
  if(position.status==='armed')return 'Waiting for trigger';
  if(position.status==='partially_filled')return n(position.claimable_output)>0n?'Partially filled':'Unfilled';
  if(position.status==='unfilled')return 'Unfilled';
  return position.status==='filled'?'Filled':'Unavailable';
}
export function validateStopTrigger(trigger,market,sellBase){
  trigger=n(trigger);
  if(trigger<=0n)throw new Error('Trigger price must be positive.');
  const nativePrice=trigger*n(market.quote_tick),maximum=(1n<<40n)-1n;
  if(trigger>(1n<<32n)-1n||nativePrice>maximum)throw new Error('Trigger price is outside this market’s range.');
  // Match the native integer reserve threshold, including floor rounding.
  // A display-price comparison alone can accept an already-reached trigger
  // in a very small market. The native action remains authoritative.
  const target=sellBase?n(market.k)*n(market.base_lot)/nativePrice:n(market.k)*nativePrice/n(market.base_lot);
  let low=0n,high=1n<<64n;
  while(low+1n<high){const middle=(low+high)/2n;if(middle<=target/middle)low=middle;else high=middle;}
  if(low<1n||low>maximum)throw new Error('Choose a trigger closer to the current market price.');
  if(low<=n(sellBase?market.x:market.y))throw new Error(sellBase?'A sell stop must trigger further below the current market price.':'A buy stop must trigger further above the current market price.');
  return trigger;
}
