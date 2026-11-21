import fs from 'node:fs';
import solc from 'solc';
import {keccak256} from 'ethers';
const source=new URL('../../packages/user/EthBridge/contracts/EthVault.sol',import.meta.url);
const input={language:'Solidity',sources:{'EthVault.sol':{content:fs.readFileSync(source,'utf8')}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const result=JSON.parse(solc.compile(JSON.stringify(input)));
for(const e of result.errors??[]) {console.error(e.formattedMessage);if(e.severity==='error')process.exit(1);}
const c=result.contracts['EthVault.sol'].EthVault;
const artifact={compiler:solc.version(),settings:input.settings,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,runtimeKeccak:keccak256('0x'+c.evm.deployedBytecode.object)};
fs.writeFileSync(new URL('EthVault.json',source),JSON.stringify(artifact,null,2)+'\n');
fs.writeFileSync(new URL('runtime.keccak',source),artifact.runtimeKeccak.slice(2)+'\n');
console.log(JSON.stringify({compiler:artifact.compiler,runtimeBytes:c.evm.deployedBytecode.object.length/2,runtimeKeccak:artifact.runtimeKeccak}));
