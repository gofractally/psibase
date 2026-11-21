import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthRows, orderSpread, quoteForSize, maximumBidSize, unitsFromAmount, ownershipForDeposit, ownershipForWithdrawal } from '../src/order-book.js';
import { candlesFromTrades, depthBounds } from '../src/market-chart.js';
const market={base_lot:'10000',quote_tick:'1',x:'10000000000',lp_supply:'100000000'};

test('visible depth uses executable quantities and cumulative totals in price priority',()=>{
 const levels=[{bid:true,price:90000,outgoing:1800001},{bid:false,price:101000,outgoing:20001},{bid:true,price:95000,outgoing:950000}];
 const bids=depthRows(levels,market,true);
 assert.deepEqual(bids.map(r=>[r.price,r.size,r.totalBase,r.totalQuote]),[[95000,100000n,100000n,950000n],[90000,200000n,300000n,2750000n]]);
 const asks=depthRows(levels,market,false);assert.equal(asks[0].size,20000n);assert.equal(asks[0].quote,202000n);
 assert.equal(orderSpread(levels,market).ticks,6000n);
 assert.equal(depthRows(levels,market,true,1).length,1);
});
test('ordinary BTC size converts to exactly funded buy notional without float rounding',()=>{
 assert.equal(quoteForSize(100000n,90000n,market),900000n);
 assert.equal(maximumBidSize(900001n,90000n,market),100000n);
 assert.throws(()=>quoteForSize(100001n,90000n,market));
 assert.equal(unitsFromAmount(2000000n,20000n),100n);
 assert.throws(()=>unitsFromAmount(2000001n,20000n));
});
test('asset-based liquidity entry and withdrawals never exceed specified amounts',()=>{
 assert.equal(ownershipForDeposit(100000n,market),1000n);
 assert.equal(ownershipForWithdrawal(9n,10n,100n,101n),8n);
 assert.equal(ownershipForWithdrawal(10n,10n,100n,101n),10n);
 assert.throws(()=>ownershipForWithdrawal(11n,10n,100n,101n));
});
test('candles contain only actual timestamped executions, in native event order',()=>{
 const t=(id,sec,p)=>({event_id:String(id),time:`2026-11-21T00:00:${String(sec).padStart(2,'0')}Z`,base_amount:'100000000',quote_amount:String(p*10000)});
 const trades=[t(14,25,104),t(13,6,102),t(12,2,99),t(10,1,101),t(11,2,103)];
 const c=candlesFromTrades(trades,8,5);
 assert.equal(c.length,3);
 assert.deepEqual([c[0].open,c[0].high,c[0].low,c[0].close,c[0].volume,c[0].trades],[1010000n,1030000n,990000n,990000n,300000000n,3]);
 assert.equal(c[1].time-c[0].time,5000);assert.equal(c[2].time-c[1].time,20000);
 assert.equal(candlesFromTrades(trades,8,15).length,2);
 assert.equal(candlesFromTrades(trades,8,60).length,1);
 assert.equal(candlesFromTrades(trades,8,5,2).length,1);
 assert.deepEqual(candlesFromTrades([],8,5),[]);
});
test('depth zoom is symmetric around current price and never changes native orders',()=>{
 assert.deepEqual(depthBounds(57000,2),{low:55860,high:58140});
 assert.deepEqual(depthBounds(57000,.5),{low:56715,high:57284.99999999999});
 assert.throws(()=>depthBounds(57000,0));assert.throws(()=>depthBounds(57000,26));
});
