// Bitcoin helpers without DOM or wallet state: custody address derivation and the proof a signet
// relay needs with every header. Nothing here is trusted by the chain; the services verify it all.
// These checks only keep the browser from submitting what a wrong or lying Bitcoin source returned.
import {HDKey} from '@scure/bip32';
import {Address,OutScript,sortedMultisig,TEST_NETWORK,NETWORK} from '@scure/btc-signer';

export type Fetch=(path:string)=>Promise<unknown>;
export type SignetBlock={header:string,coinbase:string,branch:string[]};
/// The relay accepts at most this many signet headers in one action.
export const SIGNET_BATCH=16;

const TEST_VERSIONS={private:0x04358394,public:0x043587cf};
/// Extended-key versions and address prefix per bridge network: signet and regtest use tpub roots;
/// signet addresses are `tb1…`, regtest `bcrt1…`.
export function networkParams(network:string){
 if(network==='bitcoin')return{versions:undefined,net:NETWORK};
 if(network==='signet')return{versions:TEST_VERSIONS,net:TEST_NETWORK};
 if(network==='regtest')return{versions:TEST_VERSIONS,net:{...TEST_NETWORK,bech32:'bcrt'}};
 throw Error(`Unsupported Bitcoin network: ${network}`);
}
/// wsh(sortedmulti(2, A/branch/index, B/branch/index, C/branch/index)), derived from the public roots.
export function custodyAddress(network:string,xpubs:string[],branch:number,index:number):string{
 const {versions,net}=networkParams(network);
 const keys=xpubs.map(key=>HDKey.fromExtendedKey(key,versions).deriveChild(branch).deriveChild(index).publicKey!);
 return sortedMultisig(2,keys,true,net).address!;
}

// What a withdrawal costs and what the bridge can pay, by the rules of the core library
// (`build_plan`, `budgeted_weight`, `least_fee_share`). Estimates for the form; the service decides.
export type WithdrawalPolicy={network:string,fee_rate:number,service_fee:number,min_withdrawal:number,dust:number,batch_size:number,max_inputs:number};
export type CustodyOutput={txid:string,vout:number,value:number,height:number,status:number};
/// Weight units budgeted for one custody input: 41 bytes and a 2-of-3 witness (105 vB).
const INPUT_WEIGHT=41*4+256;
/// Length of the output script an address pays to; 34 (the longest standard one) if it does not parse yet.
export function scriptLength(network:string,address:string):number{
 try{return OutScript.encode(Address(networkParams(network).net).decode(address.trim())).length;}catch{return 34;}
}
/// Virtual size of a batch as the bridge budgets it: custody inputs, the payments, and change.
export function budgetedVsize(inputs:number,paymentScripts:number[]):number{
 const outputs=paymentScripts.reduce((n,len)=>n+9+len,0)+43;
 return Math.ceil((4*(10+outputs)+2+INPUT_WEIGHT*inputs)/4);
}
/// The least network fee a request can ever be charged: a full batch, one input, shared equally.
export function leastFeeShare(policy:WithdrawalPolicy,script:number):number{
 const requests=Math.max(1,policy.batch_size),scripts=Array(requests).fill(22);scripts[0]=script;
 return Math.floor(budgetedVsize(1,scripts)*policy.fee_rate/requests);
}
/// A request paid alone: the inputs the bridge would spend (oldest first, as it selects them), the
/// fee, and the change. `null` when the available outputs cannot pay it: the bridge always keeps
/// at least `dust` as change. `most` is the largest amount those outputs could pay alone.
export function quoteAlone(policy:WithdrawalPolicy,outputs:CustodyOutput[],script:number,amount:number):{inputs:number,fee:number,change:number}|null{
 let value=0,n=0;
 for(const o of available(policy,outputs)){value+=o.value;n++;const fee=budgetedVsize(n,[script])*policy.fee_rate;if(value>=amount+fee+policy.dust)return{inputs:n,fee,change:value-amount-fee};}
 return null;
}
export function mostPayableAlone(policy:WithdrawalPolicy,outputs:CustodyOutput[],script:number):number{
 let value=0,n=0,most=0;
 for(const o of available(policy,outputs)){value+=o.value;n++;most=Math.max(most,value-budgetedVsize(n,[script])*policy.fee_rate-policy.dust);}
 return most;
}
function available(policy:WithdrawalPolicy,outputs:CustodyOutput[]):CustodyOutput[]{
 return outputs.filter(o=>o.status===0).sort((a,b)=>a.height-b.height||(a.txid<b.txid?-1:a.txid>b.txid?1:0)||a.vout-b.vout).slice(0,policy.max_inputs);
}

const HEX=/^(?:[0-9a-f]{2})*$/;
export function fromHex(hex:string,what='value'):Uint8Array{
 if(typeof hex!=='string'||!HEX.test(hex))throw Error(`Bitcoin source returned an invalid ${what}.`);
 const out=new Uint8Array(hex.length/2);
 for(let i=0;i<out.length;i++)out[i]=parseInt(hex.slice(2*i,2*i+2),16);
 return out;
}
export const toHex=(b:Uint8Array)=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
const reversed=(b:Uint8Array)=>Uint8Array.from(b).reverse();
async function sha256(b:Uint8Array):Promise<Uint8Array>{return new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource));}
export async function sha256d(b:Uint8Array):Promise<Uint8Array>{return sha256(await sha256(b));}
function concat(...parts:Uint8Array[]):Uint8Array{
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;
 for(const p of parts){out.set(p,at);at+=p.length;}
 return out;
}

/// The Merkle branch of the first transaction (the coinbase) from a block's transaction IDs, leaf to
/// root, in transaction-ID hex, and the root in the byte order of a block header.
export async function coinbaseBranch(txids:string[]):Promise<{branch:string[],root:Uint8Array}>{
 if(!Array.isArray(txids)||!txids.length||txids.length>1_000_000)throw Error('Bitcoin source returned an invalid transaction list.');
 let nodes:Uint8Array[]=txids.map(t=>{const b=fromHex(t,'transaction ID');if(b.length!==32)throw Error('Bitcoin source returned an invalid transaction ID.');return reversed(b);});
 const branch:string[]=[];
 while(nodes.length>1){
  if(nodes.length%2)nodes.push(nodes[nodes.length-1]);
  branch.push(toHex(reversed(nodes[1])));
  const next:Uint8Array[]=[];
  for(let i=0;i<nodes.length;i+=2)next.push(await sha256d(concat(nodes[i],nodes[i+1])));
  nodes=next;
 }
 return{branch,root:nodes[0]};
}
/// Fold a transaction ID up a branch as leaf 0; the result is in header byte order.
export async function rootFromBranch(txid:string,branch:string[]):Promise<Uint8Array>{
 let node:Uint8Array=reversed(fromHex(txid,'transaction ID'));
 for(const sibling of branch)node=await sha256d(concat(node,reversed(fromHex(sibling,'Merkle branch'))));
 return node;
}

/// Transaction ID of a raw transaction in either serialization (witness data is not part of it).
export async function txid(raw:Uint8Array):Promise<string>{
 let at=0;
 const need=(n:number)=>{if(at+n>raw.length)throw Error('Bitcoin source returned a truncated transaction.');};
 const skip=(n:number)=>{need(n);at+=n;};
 const size=()=>{
  need(1);const first=raw[at++];if(first<0xfd)return first;
  const width=first===0xfd?2:first===0xfe?4:8;need(width);
  let n=0;for(let i=width-1;i>=0;i--)n=n*256+raw[at+i];
  at+=width;if(n>raw.length)throw Error('Bitcoin source returned a malformed transaction.');
  return n;
 };
 skip(4);
 const witness=raw.length>6&&raw[4]===0&&raw[5]!==0;
 if(witness)skip(2);
 const body=at;
 const inputs=size();
 for(let i=0;i<inputs;i++){skip(36);skip(size());skip(4);}
 const outputs=size();
 for(let i=0;i<outputs;i++){skip(8);skip(size());}
 const end=at;
 if(witness)for(let i=0;i<inputs;i++){const items=size();for(let j=0;j<items;j++)skip(size());}
 skip(4);
 if(at!==raw.length)throw Error('Bitcoin source returned a malformed transaction.');
 const stripped=witness?concat(raw.subarray(0,4),raw.subarray(body,end),raw.subarray(raw.length-4)):raw;
 return toHex(reversed(await sha256d(stripped)));
}

/// Check that a header, the block's transaction IDs and the raw coinbase belong together, and build
/// what `btcrelay.signetHeaders` takes for one block. `hash` is the block the caller asked for.
export async function assembleSignetBlock(hash:string,header:string,txids:string[],coinbase:string):Promise<SignetBlock>{
 const raw=fromHex(header,'block header');
 if(raw.length!==80||toHex(reversed(await sha256d(raw)))!==hash)throw Error('Bitcoin source returned a header for another block.');
 const coinbaseBytes=fromHex(coinbase,'coinbase transaction');
 if(coinbaseBytes.length>400_000)throw Error('Coinbase transaction exceeds the relay limit.');
 const {branch,root}=await coinbaseBranch(txids);
 if(branch.length>32||toHex(root)!==toHex(raw.subarray(36,68)))throw Error('Bitcoin source returned transactions that do not match the block header.');
 if(await txid(coinbaseBytes)!==txids[0])throw Error('Bitcoin source returned a coinbase that does not match the block.');
 return{header,coinbase,branch};
}
/// Four requests for one block: its hash, raw header, transaction IDs and raw coinbase. The branch
/// is computed here and checked against the header, so `/tx/:txid/merkle-proof` is not needed.
export async function fetchSignetBlock(bitcoin:Fetch,height:number):Promise<SignetBlock>{
 const hash=String(await bitcoin(`/block-height/${height}`));
 if(!/^[0-9a-f]{64}$/.test(hash))throw Error('Bitcoin source returned an invalid block hash.');
 const header=String(await bitcoin(`/block/${hash}/header`));
 const txids=await bitcoin(`/block/${hash}/txids`);
 if(!Array.isArray(txids)||!txids.every(t=>typeof t==='string'))throw Error('Bitcoin source returned an invalid transaction list.');
 if(!/^[0-9a-f]{64}$/.test(txids[0]??''))throw Error('Bitcoin source returned an invalid transaction ID.');
 const coinbase=String(await bitcoin(`/tx/${txids[0]}/hex`));
 return assembleSignetBlock(hash,header,txids as string[],coinbase);
}
