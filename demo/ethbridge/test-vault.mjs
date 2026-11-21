import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Wallet,HDNodeWallet,SigningKey,Signature,TypedDataEncoder,keccak256,concat,solidityPacked,zeroPadValue,toBeHex,getBytes} from 'ethers';
import {Trie} from '@ethereumjs/trie';
import {RLP} from '@ethereumjs/rlp';
const artifact=JSON.parse(fs.readFileSync(new URL('../../packages/user/EthBridge/contracts/EthVault.json',import.meta.url)));
const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:1337,hardfork:'shanghai'},wallet:{deterministic:true,totalAccounts:8}});
const provider=new BrowserProvider(rpc);const funder=await provider.getSigner(0);const recipient=await provider.getSigner(1);
// Public fixture keys only. These are not bridge custody secrets.
const keys=[1,2,3].map(n=>HDNodeWallet.fromSeed('0x'+n.toString(16).padStart(2,'0').repeat(32)).deriveChild(0x80000000+n).deriveChild(0).deriveChild(0));
const deployment=keccak256(new TextEncoder().encode('psibase ETH bridge public fixture'));
const vault=await new ContractFactory(artifact.abi,artifact.bytecode,funder).deploy(deployment,keys.map(k=>k.address));await vault.waitForDeployment();const address=await vault.getAddress();
const configReceipt=await vault.deploymentTransaction().wait();const recipientAddress=await recipient.getAddress();
const domain={name:'PsibaseETHBridge',version:'1',chainId:1337,verifyingContract:address,salt:deployment};const types={Batch:[{name:'nonce',type:'uint256'},{name:'paymentsHash',type:'bytes32'}]};
const payments=[{request:7,address:recipientAddress.slice(2).toLowerCase(),amount:800000n}];
const paymentsHash=keccak256(solidityPacked(['address','uint64'],[recipientAddress,800000n]));const digest=TypedDataEncoder.hash(domain,types,{nonce:0,paymentsHash});assert.equal(await vault.digest(0,paymentsHash),digest);
const signers=keys.slice(0,2).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));const signatures=signers.map(k=>k.signingKey.sign(digest).serialized);
await assert.rejects(vault.deposit.staticCall(123,{value:1n}));await assert.rejects(vault.deposit.staticCall(0,{value:10000000000n}));
await assert.rejects(funder.sendTransaction({to:address,value:10000000000n}));
const depositReceipt=await (await vault.deposit(351191174077921280n,{value:1000000n*10000000000n})).wait();
await assert.rejects(vault.execute.staticCall(0,[recipientAddress],[800000n],[signatures[0],signatures[0]]));
await assert.rejects(vault.execute.staticCall(0,[recipientAddress],[800001n],signatures));
await assert.rejects(vault.execute.staticCall(0,[recipientAddress],[800000n],[signatures[1],signatures[0]]));
const stranger=new Wallet('0x'+(9).toString(16).padStart(64,'0'));const bad=[signatures[0],stranger.signingKey.sign(digest).serialized].sort((a,b)=>SigningKey.recoverPublicKey(digest,a).localeCompare(SigningKey.recoverPublicKey(digest,b)));
await assert.rejects(vault.execute.staticCall(0,[recipientAddress],[800000n],bad));
const completedReceipt=await (await vault.execute(0,[recipientAddress],[800000n],signatures)).wait();
assert.equal(await vault.nextBatch(),1n);assert.equal(await vault.claimable(recipientAddress),800000n*10000000000n);assert.equal(await vault.allocated(),800000n*10000000000n);
await assert.rejects(vault.execute.staticCall(0,[recipientAddress],[800000n],signatures));
const before=BigInt(await rpc.request({method:'eth_getBalance',params:[recipientAddress,'latest']}));await (await vault.claimFor(recipientAddress)).wait();const after=BigInt(await rpc.request({method:'eth_getBalance',params:[recipientAddress,'latest']}));assert.equal(after-before,800000n*10000000000n);assert.equal(await vault.allocated(),0n);await assert.rejects(vault.claimFor.staticCall(recipientAddress));
async function receiptProof(receipt,event){
 const block=await rpc.request({method:'eth_getBlockByHash',params:[receipt.blockHash,false]});const trie=new Trie();
 const receipts=[];for(const hash of block.transactions)receipts.push(await rpc.request({method:'eth_getTransactionReceipt',params:[hash]}));
 const integer=n=>{n=BigInt(n);return n===0n?new Uint8Array():getBytes(toBeHex(n))};
 for(let i=0;i<receipts.length;i++){const r=receipts[i];let data=RLP.encode([integer(r.status),integer(r.cumulativeGasUsed),getBytes(r.logsBloom),r.logs.map(l=>[getBytes(l.address),l.topics.map(getBytes),getBytes(l.data)])]);if(BigInt(r.type)>0n)data=getBytes(concat([toBeHex(BigInt(r.type),1),data]));await trie.put(RLP.encode(integer(i)),data)}
 assert.equal('0x'+Buffer.from(trie.root()).toString('hex'),block.receiptsRoot);
 const index=receipts.findIndex(r=>r.transactionHash.toLowerCase()===receipt.hash.toLowerCase());const r=receipts[index];const topic=keccak256(new TextEncoder().encode(event));const logIndex=r.logs.findIndex(l=>l.address.toLowerCase()===address.toLowerCase()&&l.topics[0]===topic);assert(logIndex>=0);
 const proof=await trie.createProof(RLP.encode(integer(index)));
 return {block:{hash:block.hash.slice(2),parent_hash:block.parentHash.slice(2),state_root:block.stateRoot.slice(2),receipts_root:block.receiptsRoot.slice(2),number:Number(BigInt(block.number))},witness:{kind:'Receipt',witness:{receipts_root:block.receiptsRoot.slice(2),transaction_index:index,log_index:logIndex,nodes:proof.map(n=>Buffer.from(n).toString('hex'))}},fact:{kind:'Receipt',fact:{receipts_root:block.receiptsRoot.slice(2),transaction_index:index,log_index:logIndex,address:address.slice(2).toLowerCase(),topics:r.logs[logIndex].topics.map(t=>t.slice(2)),data:r.logs[logIndex].data.slice(2)}}};
}
const config=await receiptProof(configReceipt,'Configured(bytes32,uint256,address,address,address)');const deposit=await receiptProof(depositReceipt,'Deposit(uint64,uint64,uint64)');const completed=await receiptProof(completedReceipt,'BatchExecuted(uint256,bytes32,uint64)');
const account=await rpc.request({method:'eth_getProof',params:[address,[],toBeHex(configReceipt.blockNumber)]});
assert.equal(account.codeHash,artifact.runtimeKeccak);
const fixture={vault:address.slice(2).toLowerCase(),deployment:deployment.slice(2),chain_id:1337,signer_public_keys:keys.map(k=>k.signingKey.compressedPublicKey.slice(2)),signer_addresses:keys.map(k=>k.address.slice(2).toLowerCase()),payments:payments.map(p=>({...p,amount:Number(p.amount)})),payments_hash:paymentsHash.slice(2),digest:digest.slice(2),signatures:signers.map(k=>({public:k.signingKey.compressedPublicKey.slice(2),compact:k.signingKey.sign(digest).compactSerialized.slice(2),standard:k.signingKey.sign(digest).serialized.slice(2)})),calldata:vault.interface.encodeFunctionData('execute',[0,[recipientAddress],[800000n],signatures]).slice(2),config,deposit,completed,account:{kind:'Account',witness:{state_root:config.block.state_root,address:address.slice(2).toLowerCase(),nodes:account.accountProof.map(n=>n.slice(2))}}};
// EIP-2098 compactSerialized folds the parity into s. Rust's generic service
// supplies raw r||s instead, so retain that exact representation explicitly.
for(let i=0;i<fixture.signatures.length;i++){const s=signers[i].signingKey.sign(digest);fixture.signatures[i].compact=(s.r+s.s.slice(2)).slice(2)}
fs.writeFileSync(new URL('vault-fixture.json',import.meta.url),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({checks:['EIP-712 parity','10-gwei precision','plain transfer rejection','duplicate signatures','modified amount','signature order','unauthorized signer','nonce replay','allocation conservation','third-party claim','claim replay','receipt roots','runtime code hash'],vault:address,runtimeKeccak:artifact.runtimeKeccak}));await rpc.disconnect();
