// Proof assembly against the fixtures the Rust core tests use. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HDKey} from '@scure/bip32';
import {admitWithdrawal,feeMargin,mostReceivable,scriptLength,budgetedVsize,leastFeeShare,quoteAlone,mostPayableAlone,assembleSignetBlock,coinbaseBranch,rootFromBranch,txid,fromHex,toHex,fetchSignetBlock,custodyAddress,networkParams} from '../src/bitcoin.ts';

const fixture=JSON.parse(readFileSync(new URL('../../core/tests/fixtures/signet-blocks-bip325.json',import.meta.url),'utf8'));
const listed=JSON.parse(readFileSync(new URL('./fixtures/signet-332639-txids.json',import.meta.url),'utf8'));
const merkleRoot=header=>toHex(fromHex(header).subarray(36,68));

test('coinbase transaction IDs and branches match the Rust fixtures',async()=>{
 assert.equal(fixture.blocks.length,7);
 for(const b of fixture.blocks){
  assert.equal(await txid(fromHex(b.coinbase)),b.coinbase_txid,`txid of block ${b.height}`);
  assert.equal(toHex(await rootFromBranch(b.coinbase_txid,b.branch)),merkleRoot(b.header),`root of block ${b.height}`);
 }
});

test('the branch computed from transaction IDs is the one the service is given',async()=>{
 // Single-transaction blocks: the fixture has every transaction ID.
 for(const b of fixture.blocks.filter(b=>b.tx_count===1)){
  const block=await assembleSignetBlock(b.hash,b.header,[b.coinbase_txid],b.coinbase);
  assert.deepEqual(block,{header:b.header,coinbase:b.coinbase,branch:[]});
 }
 // A block with thirteen transactions: the full list from the Bitcoin source gives the branch in
 // the Rust fixture, byte for byte.
 const b=fixture.blocks.find(b=>b.height===listed.height);
 assert.equal(listed.txids.length,b.tx_count);
 assert.deepEqual(await assembleSignetBlock(b.hash,b.header,listed.txids,b.coinbase),{header:b.header,coinbase:b.coinbase,branch:b.branch});
 assert.equal(b.branch.length,4);
 // One transaction changed or dropped no longer matches the header.
 const changed=[...listed.txids];changed[5]=changed[6];
 await assert.rejects(assembleSignetBlock(b.hash,b.header,changed,b.coinbase),/do not match the block header/);
 await assert.rejects(assembleSignetBlock(b.hash,b.header,listed.txids.slice(0,12),b.coinbase),/do not match the block header/);
 // Odd counts duplicate the last node, as Bitcoin does.
 const ids=['11','22','33'].map(x=>x.repeat(32));
 const three=await coinbaseBranch(ids),four=await coinbaseBranch([...ids,ids[2]]);
 assert.deepEqual(three.branch,four.branch);
 assert.equal(toHex(three.root),toHex(four.root));
 assert.equal(three.branch[0],ids[1]);
 assert.equal(toHex(await rootFromBranch(ids[0],three.branch)),toHex(three.root));
});

test('data that does not belong together is refused, not submitted',async()=>{
 const one=fixture.blocks.find(b=>b.height===332466),other=fixture.blocks.find(b=>b.height===1);
 const refuse=(...args)=>assert.rejects(assembleSignetBlock(...args),/Bitcoin source returned|exceeds/);
 await refuse(other.hash,one.header,[one.coinbase_txid],one.coinbase);       // header of another block
 await refuse(one.hash,one.header,[other.coinbase_txid],other.coinbase);     // transactions of another block
 await refuse(one.hash,one.header,[one.coinbase_txid],other.coinbase);       // coinbase of another block
 await refuse(one.hash,one.header,[one.coinbase_txid,one.coinbase_txid],one.coinbase);
 await refuse(one.hash,one.header,[],one.coinbase);
 await refuse(one.hash,one.header,['zz'],one.coinbase);
 await refuse(one.hash,one.header.slice(2),[one.coinbase_txid],one.coinbase);
 await refuse(one.hash,one.header,[one.coinbase_txid],one.coinbase.slice(0,-2));
 await refuse(one.hash,one.header,[one.coinbase_txid],one.coinbase+'00');
 await refuse(one.hash,one.header,[one.coinbase_txid],'zz');
 await refuse(one.hash,one.header,[one.coinbase_txid],'00'.repeat(400001));
 await assert.rejects(txid(fromHex('0200000001')),/truncated/);
 await assert.rejects(txid(fromHex('02000000ffffffffffffffffff')),/malformed|truncated/);
});

test('one block is four requests, in a fixed order',async()=>{
 const b=fixture.blocks.find(b=>b.height===332466),asked=[];
 const source=async path=>{asked.push(path);return{[`/block-height/${b.height}`]:b.hash,[`/block/${b.hash}/header`]:b.header,[`/block/${b.hash}/txids`]:[b.coinbase_txid],[`/tx/${b.coinbase_txid}/hex`]:b.coinbase}[path];};
 assert.deepEqual(await fetchSignetBlock(source,b.height),{header:b.header,coinbase:b.coinbase,branch:[]});
 assert.deepEqual(asked,[`/block-height/${b.height}`,`/block/${b.hash}/header`,`/block/${b.hash}/txids`,`/tx/${b.coinbase_txid}/hex`]);
 for(const lie of [{},[],'not a hash',null,42]){
  await assert.rejects(fetchSignetBlock(async()=>lie,b.height),/Bitcoin source returned/);
 }
 await assert.rejects(fetchSignetBlock(async path=>path.startsWith('/block-height')?b.hash:path.endsWith('/header')?b.header:{error:'x'},b.height),/invalid transaction list/);
});

test('signet custody addresses are tb1 wsh addresses from tpub roots',()=>{
 // The same three keys the Rust test `signet_custody_addresses_and_destinations` derives from.
 const roots=versions=>[1,2,3].map(i=>HDKey.fromMasterSeed(new Uint8Array(32).fill(i),versions).publicExtendedKey);
 const tpubs=roots(networkParams('signet').versions);
 assert.ok(tpubs.every(k=>k.startsWith('tpub')));
 const signet=custodyAddress('signet',tpubs,0,7),regtest=custodyAddress('regtest',tpubs,0,7);
 assert.match(signet,/^tb1q[02-9ac-hj-np-z]{58}$/);
 assert.match(regtest,/^bcrt1q/);
 // Asserted with the same literal in core/tests/signet.rs: the browser and the service agree.
 assert.equal(signet,'tb1qwcmue3lw5fxdgkhtmq3erqycpcn4slt4apd9fjry9ly3scjcha8q5nlgxe');
 assert.match(custodyAddress('bitcoin',roots(undefined),0,7),/^bc1q[02-9ac-hj-np-z]{58}$/);
 assert.notEqual(custodyAddress('signet',tpubs,1,7),signet);
 assert.throws(()=>custodyAddress('signet',roots(undefined),0,7));
 assert.throws(()=>custodyAddress('testnet4',tpubs,0,7),/Unsupported/);
});

test('withdrawal figures equal the core library\'s (core/tests/policy.rs)',()=>{
 // The live signet policy: 2 sat/vB, dust 1,000, batches of two.
 const policy={network:'signet',fee_rate:2,service_fee:100,min_withdrawal:1000,dust:1000,batch_size:2,max_inputs:64};
 const p2wpkh=scriptLength('signet','tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
 const p2tr=scriptLength('signet','tb1pd5lycwpxag9suvpwcuu974xj7tzf57jyqk3pr2c98e022r5s2zkqzg6xd2');
 assert.deepEqual([p2wpkh,p2tr],[22,34]);
 assert.equal(scriptLength('signet','mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'),25);
 assert.equal(scriptLength('signet','not an address yet'),34);
 assert.equal(scriptLength('signet','bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),34); // another network: not parsed
 // One request, one input: 190 vB (380 sat) to P2WPKH, 202 vB (404 sat) to P2TR; two requests share 221 vB.
 assert.deepEqual([budgetedVsize(1,[22]),budgetedVsize(1,[34]),budgetedVsize(1,[22,22])],[190,202,221]);
 assert.deepEqual([leastFeeShare(policy,22),leastFeeShare(policy,34)],[221,233]);
 for(const [inputs,scripts] of [[2,[34,22]],[3,[34,22]],[5,[34,22]]])assert.equal(budgetedVsize(inputs,scripts),Math.ceil((4*(10+43+31+43)+2+420*inputs)/4));
 // A reserve of one 10,000 sat output: at most 8,620 to P2WPKH and 8,596 to P2TR; 1,000 works.
 const out=(n,value,status=0)=>({txid:String(n).repeat(64),vout:0,value,height:100+n,status});
 const reserve=[out(1,10000)];
 assert.deepEqual([mostPayableAlone(policy,reserve,22),mostPayableAlone(policy,reserve,34)],[8620,8596]);
 assert.deepEqual(quoteAlone(policy,reserve,22,8620),{inputs:1,fee:380,change:1000});
 assert.equal(quoteAlone(policy,reserve,22,8621),null);
 assert.deepEqual(quoteAlone(policy,reserve,22,1000),{inputs:1,fee:380,change:8620});
 // Reserved and spent outputs do not count; older outputs are spent first; max_inputs bounds it.
 assert.equal(mostPayableAlone(policy,[out(1,10000,1),out(2,10000,2)],22),0);
 const three=[out(3,3000),out(1,3000),out(2,3000)];
 assert.deepEqual(quoteAlone(policy,three,22,4000),{inputs:2,fee:590,change:1410});
 assert.deepEqual(quoteAlone(policy,three,22,4500),{inputs:3,fee:800,change:3700});
 assert.equal(mostPayableAlone({...policy,max_inputs:1},three,22),3000-380-1000);
});

test('admission and Max give the service\'s figures (core/tests/admission.rs)',()=>{
 const policy={network:'signet',fee_rate:2,service_fee:100,min_withdrawal:1000,dust:1000,batch_size:2,max_inputs:64};
 const out=(n,value,status=0)=>({txid:String(n).repeat(64),vout:0,value,height:100+n,status});
 const reserve=[out(1,10000)];
 // The owner's two requests, each with a 100 sat allowance, against one 10,000 sat output.
 assert.deepEqual(admitWithdrawal(policy,reserve,22,9000,100),{ok:false,reason:'amount',most:8620,fee:380});
 assert.deepEqual(admitWithdrawal(policy,reserve,22,8000,100),{ok:false,reason:'allowance',least:380});
 assert.deepEqual(admitWithdrawal(policy,reserve,22,8620,380),{ok:true,fee:380});
 // One satoshi each side; taproot.
 assert.equal(admitWithdrawal(policy,reserve,22,8621,380).ok,false);
 assert.equal(admitWithdrawal(policy,reserve,22,8620,379).ok,false);
 assert.deepEqual(admitWithdrawal(policy,reserve,34,8597,404),{ok:false,reason:'amount',most:8596,fee:404});
 assert.deepEqual(admitWithdrawal(policy,reserve,34,8596,403),{ok:false,reason:'allowance',least:404});
 // Several outputs and the input limit.
 const small=[1,2,3,4,5].map(n=>out(n,3000));
 assert.deepEqual(admitWithdrawal(policy,small,22,4000,589),{ok:false,reason:'allowance',least:590});
 assert.deepEqual(admitWithdrawal(policy,small,22,12781,5000),{ok:false,reason:'amount',most:12780,fee:1220});
 assert.deepEqual(admitWithdrawal({...policy,max_inputs:3},small,22,7201,5000),{ok:false,reason:'amount',most:7200,fee:800});
 assert.deepEqual(admitWithdrawal(policy,[out(1,2379)],22,1000,1000),{ok:false,reason:'amount',most:0,fee:0});
 assert.deepEqual(admitWithdrawal(policy,[out(1,2380)],22,1000,380),{ok:true,fee:380});
 // The margin is one more input: 105 vB.
 assert.equal(feeMargin(policy),210);
 // Max, balance 9,990 and one 10,000 sat output: the reserve is the limit (8,620); it takes
 // 8,620 + 590 + 100 = 9,310 from the balance and at least 210 comes back.
 assert.equal(mostReceivable(policy,reserve,22,9990),8620);
 assert.equal(mostReceivable(policy,reserve,34,9990),8596);
 // With a larger reserve the balance is the limit: 9,990 - 100 - (380 + 210).
 const roomy=[out(1,100000)];
 assert.equal(mostReceivable(policy,roomy,22,9990),9300);
 assert.deepEqual(admitWithdrawal(policy,roomy,22,9300,590),{ok:true,fee:380});
 // The user's own allowance replaces fee + margin; one below the fee alone allows nothing.
 assert.equal(mostReceivable(policy,roomy,22,9990,380),9510);
 assert.equal(mostReceivable(policy,roomy,22,9990,379),0);
 // Too little balance or reserve for the smallest withdrawal: nothing.
 assert.equal(mostReceivable(policy,roomy,22,1689),0);
 assert.equal(mostReceivable(policy,roomy,22,1690),1000);
 assert.equal(mostReceivable(policy,[],22,9990),0);
 // What Max gives is always admitted with the default allowance.
 for(const [outputs,balance] of [[reserve,9990],[roomy,9990],[small,20000],[small,5000]]){
  const most=mostReceivable(policy,outputs,22,balance);if(!most)continue;
  const alone=admitWithdrawal(policy,outputs,22,most,1e9);assert.ok(alone.ok);
  assert.ok(admitWithdrawal(policy,outputs,22,most,alone.fee+feeMargin(policy)).ok);
  assert.ok(most+alone.fee+feeMargin(policy)+policy.service_fee<=balance);
 }
});
