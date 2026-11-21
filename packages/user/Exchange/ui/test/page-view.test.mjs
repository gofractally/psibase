import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPageView,initialMarket,marketUrl} from '../src/page-view.js';
const identify = row => String(row.generation);
test('older owner pages survive first-page polling without entering a fresh portfolio snapshot',()=>{
  const view=createPageView('alice:101:makers',identify);
  const fresh={positions:[{generation:'9007199254740993',proceeds:'10'}]};
  view.accept(view.begin(),{rows:fresh.positions,next:'opaque-a'},{time:100});
  view.accept(view.begin(),{rows:[{generation:'9007199254740994',proceeds:'20'}],next:'opaque-b'},{append:true,time:200});
  const polled={positions:[{generation:'9007199254740993',proceeds:'0'}]};
  assert.equal(view.rows.length,2);assert.equal(view.rows[0].proceeds,'10');assert.equal(view.openedAt,100);
  assert.equal(polled.positions.length,1);assert.equal(polled.positions[0].proceeds,'0');
  view.accept(view.begin(),{rows:[{generation:'9007199254740994',proceeds:'21'}],next:null},{append:true});
  assert.equal(view.rows.length,2);assert.equal(view.rows[1].proceeds,'21');assert.equal(view.next,null);
});
test('account, market and mutation resets reject late pages and release only their own loading state',()=>{
  const view=createPageView('alice:101:loans',identify),old=view.begin();
  view.reset('bob:102:loans');const current=view.begin();
  assert.equal(view.accept(old,{rows:[{generation:'1'}],next:'alice-cursor'}),false);
  view.finish(old);assert.equal(view.loading,true);assert.deepEqual(view.rows,[]);
  assert.equal(view.accept(current,{rows:[{generation:'2'}],next:null}),true);
  const mutation=view.begin();view.reset();assert.equal(view.accept(mutation,{rows:[{generation:'3'}],next:null}),false);
  assert.deepEqual(view.rows,[]);assert.equal(view.next,null);assert.equal(view.openedAt,null);
});
test('a page is bounded and cannot schedule concurrent automatic page drains',()=>{
  const view=createPageView('public:101:asks',identify),ticket=view.begin();
  assert.equal(view.begin(),null);assert.equal(view.begin('other'),null);
  assert.throws(()=>view.accept(ticket,{rows:Array(201).fill({generation:'1'}),next:null}),/bounded page/);
  view.finish(ticket);assert.throws(()=>view.accept(view.begin(),{rows:[],next:123}),/bounded page/);
});

test('native prompt draft market wins over an older URL while direct links remain exact',()=>{
  assert.equal(initialMarket('?market=7',{market:'101'}),'101');
  assert.equal(initialMarket('?market=7',null),'7');
  assert.equal(initialMarket('?market=7',{market:'invalid'}),'7');
  assert.equal(initialMarket('?market=18446744073709551615',{}),'18446744073709551615');
  assert.equal(initialMarket('?market=18446744073709551616',{}),null);
});
test('market selection replaces only its route parameter without changing origin or other context',()=>{
  assert.equal(marketUrl('http://exchange.psibase.localhost:8089/trade?profile=1&market=7#orders','101'),'http://exchange.psibase.localhost:8089/trade?profile=1&market=101#orders');
  assert.equal(marketUrl('https://exchange.example/path?profile=1','9007199254740993'),'https://exchange.example/path?profile=1&market=9007199254740993');
  assert.throws(()=>marketUrl('https://exchange.example/','0'),/Invalid market/);
});
