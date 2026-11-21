import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeWallet } from '../src/native-wallet.js';

function fixture(results = []) {
  const calls=[];
  const wallet=createNativeWallet({async functionCall(args,options){calls.push({args,options});const result=results.shift();if(result instanceof Error)throw result;return result;}});
  return {wallet,calls};
}
test('native account connection uses Host authority rather than a supplied wallet identity',async()=>{
  const {wallet,calls}=fixture(['alice',['alice','bob'],undefined,undefined,undefined]);
  assert.equal(await wallet.currentUser(),'alice');assert.deepEqual(await wallet.accounts(),['alice','bob']);
  await wallet.connect();await wallet.login('bob');await wallet.logout();
  assert.deepEqual(calls.map(c=>[c.args.service,c.args.plugin,c.args.intf,c.args.method,c.args.params]),[
    ['host','accounts','api','getCurrentUser',[]],['host','accounts','activeApp','getConnectedAccounts',[]],
    ['host','accounts','activeApp','connectAccount',[]],['host','accounts','activeApp','login',['bob']],['host','accounts','activeApp','logout',[]],
  ]);
});
test('private queries never take an owner and preserve exact stop cursors',async()=>{
  const {wallet,calls}=fixture(['{"owner":"alice"}','{"stop_positions":[]}','{"data":{"balChanges":{"edges":[]}}}']);
  assert.deepEqual(await wallet.snapshot(),{owner:'alice'});await wallet.stops('18446744073709551615');await wallet.history(2,'opaque-cursor');
  assert.deepEqual(calls.map(c=>c.args.params),[[],['18446744073709551615',100],[2,'opaque-cursor',30]]);
  assert.ok(calls.every(c=>c.args.service==='exchange'&&c.args.intf==='queries'));
});
test('deposits use the exact Tokens transfer review and decimal amount',async()=>{
  const {wallet,calls}=fixture();await wallet.deposit(1,'0.00000001','alice');
  assert.deepEqual(calls[0].args,{service:'tokens',plugin:'plugin',intf:'transfer',method:'credit',params:[1,'exchange','0.00000001','Exchange deposit','alice']});
  assert.equal(calls[0].options.enabled,false);
});
test('financial arguments preserve u64 strings through the native allowlisted executor',async()=>{
  const {wallet,calls}=fixture(['{"status":"executed","executed":true,"prepared":0}']);
  await wallet.execute('cancelstop',{generation:'18446744073709551615'},'alice');
  assert.deepEqual(calls[0].args.params,['cancelstop','{"generation":"18446744073709551615"}','alice',undefined]);
  assert.equal(calls[0].args.intf,'user');
});
test('only confirmed preparation calls permit bounded followup transactions',async()=>{
  const {wallet,calls}=fixture(['{"status":"prepared","executed":false,"prepared":32}','{"status":"executed","executed":true,"prepared":0}']);
  await wallet.withdraw(2,'9007199254740993','alice');assert.equal(calls.length,2);
  assert.ok(calls.every(c=>JSON.stringify(c.args.params)==='[2,"9007199254740993","alice",null]'));
  const bounded=fixture(Array(3).fill('{"status":"prepared","executed":false,"prepared":32}'));
  assert.deepEqual(await bounded.wallet.withdraw(2,'10','alice'),{status:'prepared',executed:false,prepared:32});assert.equal(bounded.calls.length,2);
});
test('an unknown or rejected submission is never retried',async()=>{
  const error=new Error('connection closed after submission');const {wallet,calls}=fixture([error,'{"status":"executed","executed":true,"prepared":0}']);
  await assert.rejects(wallet.execute('trade',{amount:'100'},'alice'),error);assert.equal(calls.length,1);
});
test('remembered trust is read and revoked in Tokens, not local app storage',async()=>{
  const {wallet,calls}=fixture([true,'approved',undefined]);
  assert.equal(await wallet.trustStatus(),true);assert.equal(await wallet.approvalStatus(),'approved');await wallet.revokeTrust();
  assert.deepEqual(calls.map(c=>[c.args.service,c.args.intf,c.args.method]),[['tokens','transfer','trustStatus'],['tokens','transfer','approvalStatus'],['tokens','transfer','revokeTrust']]);
});
test('prompt-return replay only admits native wallet operations',async()=>{
  const {wallet,calls}=fixture(['{"status":"executed","executed":true,"prepared":0}']);
  await wallet.resume({service:'exchange',plugin:'plugin',intf:'user',method:'withdraw',params:[2,'10','alice']});assert.equal(calls.length,1);
  assert.throws(()=>wallet.resume({service:'tokens',plugin:'plugin',intf:'issuer',method:'mint',params:[2,'100','']}),/cannot be resumed/);
  assert.throws(()=>wallet.resume({service:'tokens',plugin:'plugin',intf:'transfer',method:'credit',params:[2,'mallory','100','']}),/cannot be resumed/);
  assert.equal(calls.length,1);
});

test('scoped reads use exact market IDs and opaque cursors without an owner argument',async()=>{
  const {wallet,calls}=fixture(Array(5).fill('{}'));
  await wallet.scopedSnapshot('9007199254740993');await wallet.positions('loans','101','opaque-loans',100);await wallet.assets('opaque-assets',100);await wallet.asset(4294967295);await wallet.releasePosition('orders','101',true,'9007199254740993','alice');
  assert.deepEqual(calls.map(c=>[c.args.method,c.args.params]),[['scopedSnapshot',['9007199254740993']],['positions',['loans','101','opaque-loans',100]],['assets',['opaque-assets',100]],['asset',[4294967295]],['releasePosition',['orders','101',true,'9007199254740993','alice']]]);
});
test('a bounded funding scan requires an explicit continuation and never auto-drains pages',async()=>{
  const {wallet,calls}=fixture(['{"status":"scan_progress","executed":false,"prepared":0,"funding_cursor":"opaque-next"}','{"status":"executed","executed":true,"prepared":0,"funding_cursor":null}']);
  const result=await wallet.withdraw(4294967295,'9007199254740993','alice');assert.equal(calls.length,1);assert.equal(result.funding_cursor,'opaque-next');
  await wallet.withdraw(4294967295,'9007199254740993','alice',result.funding_cursor);assert.equal(calls.length,2);assert.deepEqual(calls[1].args.params,[4294967295,'9007199254740993','alice','opaque-next']);
});

test('malformed native results cannot be shown as confirmed transactions or continued scans',async()=>{
  for(const result of [undefined,'{}','{"status":"prepared","executed":false,"prepared":0}','{"status":"prepared","executed":false,"prepared":33}','{"executed":false,"prepared":32}','{"executed":false,"status":"scan_progress","prepared":0,"funding_cursor":null}','{"executed":true,"status":"scan_progress","prepared":1,"funding_cursor":"cursor"}']){
    const {wallet,calls}=fixture([result]);await assert.rejects(wallet.withdraw(2,'10','alice'),/Invalid native funding|invalid transaction result/);assert.equal(calls.length,1);
  }
});

test('approval-return replay makes one call rather than restarting the preparation budget',async()=>{
  const prompt=new Error('native approval required'),intent={service:'exchange',plugin:'plugin',intf:'user',method:'withdraw',params:[2,'10','alice',undefined]};
  const original=fixture(['{"status":"prepared","executed":false,"prepared":32}',prompt]);
  await assert.rejects(original.wallet.withdraw(2,'10','alice'),prompt);assert.equal(original.calls.length,2);
  const resumed=fixture(['{"status":"prepared","executed":false,"prepared":32}','{"status":"executed","executed":true,"prepared":0}']);
  const result=await resumed.wallet.resume(intent);assert.equal(result.status,'prepared');assert.equal(resumed.calls.length,1);
});
