// Untrusted RPC data is reconstructed and then verified by verify-eth.
import fs from 'node:fs';import {Trie} from '@ethereumjs/trie';import {RLP} from '@ethereumjs/rlp';import {getBytes,toBeHex,concat,keccak256} from 'ethers';
const [url,operation,ref,logText='0']=process.argv.slice(2);let id=0;
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result}
const integer=n=>BigInt(n)===0n?new Uint8Array():getBytes(toBeHex(BigInt(n)));
let witness,block;
if(operation==='receipt'){
 const selected=await rpc('eth_getTransactionReceipt',[ref]);if(!selected)throw Error('Transaction not mined');block=await rpc('eth_getBlockByHash',[selected.blockHash,false]);const trie=new Trie();const receipts=[];
 for(const hash of block.transactions)receipts.push(await rpc('eth_getTransactionReceipt',[hash]));
 for(let i=0;i<receipts.length;i++){const r=receipts[i];let encoded=RLP.encode([integer(r.status),integer(r.cumulativeGasUsed),getBytes(r.logsBloom),r.logs.map(l=>[getBytes(l.address),l.topics.map(getBytes),getBytes(l.data)])]);if(BigInt(r.type)>0n)encoded=getBytes(concat([toBeHex(BigInt(r.type),1),encoded]));await trie.put(RLP.encode(integer(i)),encoded)}
 const root=Buffer.from(trie.root()).toString('hex');if('0x'+root!==block.receiptsRoot.toLowerCase())throw Error('Receipt root mismatch');const index=block.transactions.findIndex(h=>h.toLowerCase()===ref.toLowerCase());const log=Number(logText);if(index<0||!Number.isSafeInteger(log)||log<0||log>=selected.logs.length)throw Error('Receipt log position');witness={kind:'Receipt',witness:{receipts_root:root,transaction_index:index,log_index:log,nodes:(await trie.createProof(RLP.encode(integer(index)))).map(n=>Buffer.from(n).toString('hex'))}};
}else if(operation==='account'){
 const [address,tag]=ref.split('@');block=await rpc('eth_getBlockByNumber',[tag,false]);const proof=await rpc('eth_getProof',[address,[],tag]);witness={kind:'Account',witness:{state_root:block.stateRoot.slice(2),address:address.slice(2).toLowerCase(),nodes:proof.accountProof.map(n=>n.slice(2))}};
}else if(operation==='header'){
 block=await rpc('eth_getBlockByHash',[ref,false]);const fields=[block.parentHash,block.sha3Uncles,block.miner,block.stateRoot,block.transactionsRoot,block.receiptsRoot,block.logsBloom].map(getBytes);fields.push(integer(block.difficulty),integer(block.number),integer(block.gasLimit),integer(block.gasUsed),integer(block.timestamp),getBytes(block.extraData),getBytes(block.mixHash),getBytes(block.nonce));if(block.baseFeePerGas!==undefined)fields.push(integer(block.baseFeePerGas));if(block.withdrawalsRoot)fields.push(getBytes(block.withdrawalsRoot));if(block.blobGasUsed!==undefined)fields.push(integer(block.blobGasUsed),integer(block.excessBlobGas),getBytes(block.parentBeaconBlockRoot));if(block.requestsHash)fields.push(getBytes(block.requestsHash));const encoded=RLP.encode(fields);if(keccak256(encoded)!==block.hash)throw Error('Execution header hash mismatch');witness={kind:'Header',witness:Buffer.from(encoded).toString('hex')};
}else throw Error('Unknown evidence kind');
console.log(JSON.stringify({witness,block:block.hash.slice(2),number:Number(BigInt(block.number))}));
