import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candleHistory,CANDLE_INTERVALS} from '../src/candle-history.js';
const bar=(time,extra={})=>({time,open:'9007199254740993',high:'9007199254740999',low:'9007199254740991',close:'9007199254740995',volume:'18446744073709551616',trades:'9007199254740993',complete:true,...extra});
test('native hourly/daily candles preserve exact prices, volume, opaque cursors and missing buckets',()=>{
  for(const interval of CANDLE_INTERVALS){
    const result=candleHistory({interval,price_precision:14,candles:[bar(interval*4,{complete:false,event_id:null}),bar(interval,{event_id:'18446744073709551615'})],next_before:'opaque-event-cursor'},interval);
    assert.deepEqual(result.candles.map(row=>row.time),[interval*1000,interval*4000]);
    assert.equal(result.candles[0].open,9007199254740993n);assert.equal(result.candles[0].volume,18446744073709551616n);
    assert.equal(result.candles[0].event_id,'18446744073709551615');assert.equal(result.candles[1].complete,false);
    assert.equal(result.before,'opaque-event-cursor');
  }
});
test('native candle normalizer rejects inconsistent, duplicate, unsafe or oversized pages',()=>{
  for(const change of [{high:'1'},{low:'9999999999999999'},{volume:'0'},{open:'1e8'},{trades:'-1'},{complete:'true'},{time:1},{time:9007199254740993}])assert.throws(()=>candleHistory({interval:3600,price_precision:14,candles:[bar(3600,change)]},3600));
  assert.throws(()=>candleHistory({interval:3600,price_precision:14,candles:[bar(3600),bar(3600)]},3600));
  assert.throws(()=>candleHistory({interval:86400,price_precision:14,candles:[bar(86400)]},3600));
  assert.throws(()=>candleHistory({interval:3600,price_precision:14,candles:Array(201).fill(bar(3600))},3600));
  assert.throws(()=>candleHistory({interval:3600,price_precision:14,candles:[],next_before:123},3600));
  assert.deepEqual(candleHistory({interval:86400,price_precision:14,candles:[],next_before:null},86400),{candles:[],before:null,pricePrecision:14});
});
test('native price precision supports tiny token prices without rounding OHLC to zero',()=>{
  const page=candleHistory({interval:86400,price_precision:36,candles:[bar(86400,{open:'1',high:'2',low:'1',close:'2',volume:'1',trades:'1'})]},86400);
  assert.equal(page.pricePrecision,36);assert.equal(page.candles[0].open,1n);
  for(const precision of [-1,37,null,undefined])assert.throws(()=>candleHistory({interval:86400,price_precision:precision,candles:[]},86400));
});
