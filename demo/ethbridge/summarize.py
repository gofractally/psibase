#!/usr/bin/env python3
"""Summarize observed verification; fails rather than recording a partial pass."""
from pathlib import Path
import hashlib,json,re,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 chain=(HERE/'chain-tests.log').read_text();core=(HERE/'core-tests.log').read_text()
 assert '2 passed; 0 failed' in chain,'Chain tests have not passed'
 assert '3 passed; 0 failed' in core and '2 passed; 0 failed' in core,'Core tests have not passed'
 metrics=[json.loads(m) for m in re.findall(r'ETH_BRIDGE_METRIC (\{[^\n]+\})',chain)]
 assert metrics and any(m['error'] is None and m['proof_ns']>0 for m in metrics)
 def last_json(file):return json.loads((HERE/file).read_text().splitlines()[-1])
 package=ROOT/'packages/user/target/wasm32-wasip1/release/packages/EthBridge.psi';wasmdir=package.parent.parent
 with zipfile.ZipFile(package) as z:
  meta=json.loads(z.read('service/verify-eth.json'));assert 'isVerify' in meta['flags']
  for name in ('index.html','app.js','style.css'):assert z.read('data/ethbridge/'+name)==(ROOT/'packages/user/EthBridge/ui'/name).read_bytes(),f'Packaged UI differs: {name}'
  assert z.read('service/verify-eth.wasm')==(wasmdir/'verify-eth.wasm').read_bytes()
 artifact=json.loads((ROOT/'packages/user/EthBridge/contracts/EthVault.json').read_text());assert artifact['runtimeKeccak'][2:]==(ROOT/'packages/user/EthBridge/contracts/runtime.keccak').read_text().strip()
 dis=subprocess.check_output(['wasm-objdump','-x',str(wasmdir/'verify-eth.wasm')],text=True);imports=re.findall(r'<- ([^\n]+)',dis)
 assert set(imports)=={'env.getResult','env.getCurrentAction','env.abortMessage'},imports
 out={'status':'development_validation_passed','precision':8,'wei_per_token_unit':10000000000,'contract_runtime_keccak':artifact['runtimeKeccak'],'solidity':last_json('vault-tests.log'),'browser_encoding':last_json('ui-tests.log'),'rust_core_tests':5,'native_chain_tests':2,'chain_metrics':metrics,'direct_chain_metrics':[json.loads(m) for m in re.findall(r'ETH_BRIDGE_DIRECT_METRIC (\{[^\n]+\})',chain)],'max_successful_objective_ms':max(m['objective_ns']/1e6 for m in metrics if m['error'] is None),'sequential_block_default_ms':196,'proof_watchdog_default_ms':200,'proof_wasm_imports':imports,'package':{'path':str(package),'sha256':sha(package),'bytes':package.stat().st_size},'services':{name:{'bytes':(wasmdir/(name+'.wasm')).stat().st_size,'sha256':sha(wasmdir/(name+'.wasm'))} for name in ['verify-eth','ethrelay','ethbridge','r-ethbridge']},'mainnet_evidence':json.loads((HERE/'mainnet-source.json').read_text()),'limits':['The old interpreter exceeds the separate proof-admission watchdog for BLS updates. Intended-engine proof qualification remains pending.','Parallel proof scheduling and the faster Mac engine are not implemented here.','Native browser wallet E2E is not qualified; browser tests mock its transport.','Proof submission is currently CLI-based; browser evidence-proof support needs a Transact API extension.','No live vault, custody providers, keeper or mainnet deployment has been provisioned.']}
 (HERE/'verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'status':out['status'],'max_successful_objective_ms':out['max_successful_objective_ms'],'package_sha256':out['package']['sha256']}))
if __name__=='__main__':main()
