// Proof assembly against the fixtures the Rust core tests use. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HDKey} from '@scure/bip32';
import {assembleSignetBlock,coinbaseBranch,rootFromBranch,txid,fromHex,toHex,fetchSignetBlock,custodyAddress,networkParams} from '../src/bitcoin.ts';

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
