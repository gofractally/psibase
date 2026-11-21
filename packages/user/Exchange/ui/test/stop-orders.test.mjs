import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownStops,stopPayouts,stopRemaining,canCancelStop,stopStatus,validateStopTrigger,minimumStopAmount} from '../src/stop-orders.js';

test('stop balances use only the selected wallet and exact native payouts',()=>{
 const snapshot={owner:'alice',stop_positions:[
  {owner:'alice',status:'armed',remaining_outgoing:'9007199254740999',claimable_input:'5',claimable_output:'6'},
  {owner:'alice',status:'partially_filled',remaining_outgoing:'0',claimable_input:'9007199254740993',claimable_output:'9007199254740997'},
  {owner:'bob',status:'filled',claimable_output:'1000000'}
 ]};
 const rows=ownStops(snapshot,'alice');assert.equal(rows.length,2);
 assert.equal(ownStops(snapshot,'carol').length,0);
 assert.equal(stopRemaining(rows[0]),9007199254740999n);assert.deepEqual(stopPayouts(rows[0]),{input:0n,output:0n});
 assert.equal(stopRemaining(rows[1]),0n);assert.deepEqual(stopPayouts(rows[1]),{input:9007199254740993n,output:9007199254740997n});
 assert.equal(canCancelStop(rows[0]),true);assert.equal(canCancelStop(rows[1]),false);
 assert.equal(stopStatus(rows[1]),'Partially filled');
 assert.deepEqual(stopPayouts({...rows[1],can_claim:false}),{input:0n,output:0n});
 const unfilled={status:'unfilled',remaining_outgoing:0,claimable_input:'37',claimable_output:'0'};
 assert.deepEqual(stopPayouts(unfilled),{input:37n,output:0n});assert.equal(stopStatus(unfilled),'Unfilled');
});
test('stop triggers compare native reserve fractions without floating point',()=>{
 const market={base_lot:'10000',quote_tick:'1',x:'10000000000',y:'57999999999',k:String(10000000000n*57999999999n)};
 assert.equal(validateStopTrigger('57999',market,true),57999n);
 assert.equal(validateStopTrigger('58001',market,false),58001n);
 assert.throws(()=>validateStopTrigger('58000',market,false),/further above/);
 assert.throws(()=>validateStopTrigger('58000',market,true),/below/);
 assert.throws(()=>validateStopTrigger('57999',market,false),/above/);
 assert.throws(()=>validateStopTrigger('0',market,true),/positive/);
 const exact={...market,y:'58000000000',k:String(10000000000n*58000000000n)};
 assert.throws(()=>validateStopTrigger('58000',exact,true));assert.throws(()=>validateStopTrigger('58000',exact,false));
 const small={base_lot:10000,quote_tick:1,x:100000,y:1000000,k:'100000000000'};
 assert.throws(()=>validateStopTrigger('99999',small,true),/further below/);
 assert.equal(validateStopTrigger('99997',small,true),99997n);
});
test('new stop minimum follows trigger value while own armed additions stay precise',()=>{
 const market={id:7,base_lot:'10000',quote_tick:'1'};
 const snapshot={owner:'alice',stop_positions:[]};
 assert.equal(minimumStopAmount(market,true,200000n,snapshot,'alice'),10000n);
 assert.equal(minimumStopAmount(market,false,200000n,snapshot,'alice'),200000n);
 const row={owner:'alice',market:7,sell_base:false,trigger:200000,status:'armed',remaining_outgoing:200000};
 snapshot.stop_positions=[row];
 assert.equal(minimumStopAmount(market,false,200000n,snapshot,'alice'),1n);
 for(const change of [{owner:'bob'},{market:8},{sell_base:true},{trigger:200001},{status:'filled'},{remaining_outgoing:0}]){
  snapshot.stop_positions=[{...row,...change}];
  assert.equal(minimumStopAmount(market,false,200000n,snapshot,'alice'),200000n);
 }
});
