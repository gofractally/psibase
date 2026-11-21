import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPortfolio } from '../src/portfolio.js';

const market={id:1,base:1,quote:2,escrow_base:{funded:true},escrow_quote:{funded:true}};
test('one snapshot aggregates exact own maker, loan and stop entitlements per token',()=>{
  const snapshot={owner:'alice',markets:[market,{id:2,base:3,quote:4,escrow_base:{funded:false}}],
    balances:[{token:1,spendable:'10',incoming:'999'},{token:2,incoming:'3',outgoing:'4'}],
    positions:[
      {owner:'alice',market:1,bid:false,refund:'100',proceeds:'200'},
      {owner:'alice',market:1,bid:true,refund:'300',proceeds:'400'},
      {owner:'bob',market:1,bid:false,refund:'9999',proceeds:'9999'},
      {owner:'alice',market:2,bid:false,refund:'500',proceeds:'600'},
    ],
    loan_positions:[11,12,13,14,15].map(generation=>({owner:'alice',market:generation===15?2:1,generation,units:generation===13?2:generation===14?3:1})),
    loans:[{generation:11,long:true,active:false,claimable_surplus:'7'},{generation:12,long:false,active:false,claimable_surplus:'13'},
      {generation:13,long:true,active:true,collateral_unit:'50'},{generation:14,long:false,active:true,collateral_unit:'60'},
      {generation:15,long:true,active:false,claimable_surplus:'900'}],
    stop_positions:[{owner:'alice',market:1,sell_base:true,status:'armed',remaining_outgoing:'11'},
      {owner:'alice',market:1,sell_base:true,status:'partially_filled',claimable_input:'17',claimable_output:'19'},
      {owner:'alice',market:1,sell_base:false,status:'partially_filled',claimable_input:'23',claimable_output:'29'},
      {owner:'bob',market:1,sell_base:false,status:'filled',claimable_output:'9999'}],
  };
  const p=projectPortfolio(snapshot,'alice');
  assert.equal(p.available(1),469n);assert.equal(p.available(2),256n);
  assert.equal(p.committed(1),211n);assert.equal(p.committed(2),480n);
  assert.equal(p.available(3),0n);assert.equal(p.available(4),0n);assert.equal(p.committed(3),500n);
  assert.equal(p.available(999),0n);assert.deepEqual(p.balance(999),{});
});
test('native refund DTO wins over conflicting public depth and wide atoms stay exact',()=>{
  const snapshot={owner:'alice',markets:[market],balances:[{token:1,outgoing:'9007199254740993'}],
    positions:[{owner:'alice',market:1,bid:false,generation:9,refund:'9007199254740995',proceeds:'9007199254740997'}],
    levels:[{generation:9,outgoing:1,shares:100}],loan_positions:[],stop_positions:[]};
  const p=projectPortfolio(snapshot,'alice');
  assert.equal(p.available(1),9007199254740993n);assert.equal(p.available(2),9007199254740997n);
  assert.equal(p.committed(1),9007199254740995n);
  const next=projectPortfolio({...snapshot,positions:[],balances:[]},'bob');
  assert.equal(next.available(1),0n);assert.equal(next.committed(1),0n);
});
test('legacy own DTO fallbacks retain the original floor rounding',()=>{
  const p=projectPortfolio({owner:'alice',markets:[market],
    positions:[{owner:'alice',market:1,bid:false,generation:9,shares:3}],levels:[{generation:9,outgoing:10,shares:4}],
    loan_positions:[{owner:'alice',market:1,generation:10,units:3}],loans:[{generation:10,long:true,active:false,original_surplus:10,original_units:4}]},'alice');
  assert.equal(p.committed(1),7n);assert.equal(p.available(2),7n);
});
