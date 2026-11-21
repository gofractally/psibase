#!/usr/bin/env python3
"""Read public beacon evidence and convert it into context-free verifier witnesses.
The fetched checkpoint is test evidence, not an independently trusted bootstrap.
"""
import hashlib,json,urllib.request
from pathlib import Path
BASE='https://ethereum-beacon-api.publicnode.com'
HERE=Path(__file__).resolve().parent
def get(path):
 with urllib.request.urlopen(BASE+path,timeout=30) as r:
  data=r.read(2_000_001)
  if len(data)>2_000_000:raise ValueError('Beacon response size limit')
  return json.loads(data)
def h(b):return hashlib.sha256(b).digest()
def pair(a,b):return h(a+b)
def tree(nodes):
 nodes=nodes+[bytes(32)]*((1<<(len(nodes)-1).bit_length())-len(nodes))
 while len(nodes)>1:nodes=[pair(nodes[i],nodes[i+1]) for i in range(0,len(nodes),2)]
 return nodes[0]
def uint(n):return int(n).to_bytes(32,'little')
def raw(s):return bytes.fromhex(s.removeprefix('0x'))
def beacon(v):return {k:int(v[k]) if k in ('slot','proposer_index') else v[k].removeprefix('0x') for k in ('slot','proposer_index','parent_root','state_root','body_root')}
def root(b):return tree([uint(b['slot']),uint(b['proposer_index']),raw(b['parent_root']),raw(b['state_root']),raw(b['body_root'])]).hex()
def execution(header):
 v=header['execution'];fields=[]
 for name in ('parent_hash','fee_recipient','state_root','receipts_root','logs_bloom','prev_randao','block_number','gas_limit','gas_used','timestamp','extra_data','base_fee_per_gas','block_hash','transactions_root','withdrawals_root','blob_gas_used','excess_blob_gas'):
  if name in ('block_number','gas_limit','gas_used','timestamp','base_fee_per_gas','blob_gas_used','excess_blob_gas'):r=uint(v[name])
  elif name=='logs_bloom':r=tree([raw(v[name])[i:i+32] for i in range(0,256,32)])
  elif name=='extra_data':
   b=raw(v[name]);assert len(b)<=32;r=pair(b.ljust(32,b'\0'),uint(len(b)))
  else:r=raw(v[name]).ljust(32,b'\0');assert len(r)==32
  fields.append(r.hex())
 return {'fields':fields,'branch':[b.removeprefix('0x') for b in header['execution_branch']]}
def main():
 finality=get('/eth/v1/beacon/light_client/finality_update');u=finality['data'];trusted=root(beacon(u['finalized_header']['beacon']));b=get('/eth/v1/beacon/light_client/bootstrap/0x'+trusted)['data'];g=get('/eth/v1/beacon/genesis')['data']
 network={'genesis_root':g['genesis_validators_root'].removeprefix('0x'),'genesis_time':int(g['genesis_time']),'forks':[{'epoch':269568,'version':'04000000','electra':False},{'epoch':364032,'version':'05000000','electra':True},{'epoch':411392,'version':'06000000','electra':True}]}
 committee=b['current_sync_committee'];committee={'pubkeys':[p.removeprefix('0x') for p in committee['pubkeys']],'aggregate_pubkey':committee['aggregate_pubkey'].removeprefix('0x')}
 bootstrap={'kind':'Bootstrap','witness':{'network':network,'header':beacon(b['header']['beacon']),'committee':committee,'committee_branch':[v.removeprefix('0x') for v in b['current_sync_committee_branch']],'execution':execution(b['header'])}}
 update={'kind':'Update','witness':{'network':network,'committee':committee,'attested':beacon(u['attested_header']['beacon']),'finalized':beacon(u['finalized_header']['beacon']),'finality_branch':[v.removeprefix('0x') for v in u['finality_branch']],'signature_slot':int(u['signature_slot']),'bits':u['sync_aggregate']['sync_committee_bits'].removeprefix('0x'),'signature':u['sync_aggregate']['sync_committee_signature'].removeprefix('0x'),'next':None,'next_branch':[],'execution':execution(u['finalized_header'])}}
 for name,witness in [('mainnet-bootstrap',bootstrap),('mainnet-finality',update)]: (HERE/(name+'.json')).write_text(json.dumps(witness,separators=(',',':'))+'\n')
 (HERE/'mainnet-source.json').write_text(json.dumps({'source':BASE,'trusted_root_for_fixture_only':trusted,'version':finality.get('version'),'signature_slot':u['signature_slot'],'genesis':g,'note':'RPC-supplied checkpoint, not independently authenticated bootstrap. BLS and SSZ are independently checked by verify-eth.'},indent=2)+'\n')
 print('Fetched mainnet',finality.get('version'),'signature slot',u['signature_slot'])
if __name__=='__main__':main()
