import fs from 'node:fs';import ganache from 'ganache';import {ContractFactory,JsonRpcProvider,computeAddress,HDNodeWallet} from 'ethers';
const state=process.argv[2];const operation=process.argv[3];const port=Number(process.argv[4]??8095);
if(operation==='serve'){
 const server=ganache.server({logging:{quiet:true},chain:{chainId:1338,hardfork:'shanghai'},wallet:{deterministic:true,totalAccounts:6,defaultBalance:1000},database:{dbPath:state+'/evm'}});
 await server.listen(port,'127.0.0.1');console.log('Private EVM devnet on loopback port',port);for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{await server.close();process.exit(0)});
}else if(operation==='deploy'){
 const config=JSON.parse(fs.readFileSync(state+'/custody-public.json'));const artifact=JSON.parse(fs.readFileSync(new URL('../../packages/user/EthBridge/contracts/EthVault.json',import.meta.url)));const provider=new JsonRpcProvider('http://127.0.0.1:'+port);const signer=await provider.getSigner(0);
 const vault=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy('0x'+config.deployment,config.roots.map(root=>computeAddress(HDNodeWallet.fromExtendedKey(root).deriveChild(0).deriveChild(0).publicKey)));
 await vault.waitForDeployment();const receipt=await vault.deploymentTransaction().wait();fs.writeFileSync(state+'/vault.json',JSON.stringify({address:await vault.getAddress(),txid:receipt.hash,block:receipt.blockHash,number:receipt.blockNumber}));console.log(await vault.getAddress());
}else throw Error('Unknown EVM operation');
