#!/usr/bin/env python3
"""Public, keyless-with-respect-to-custody coordinator for the private devnet."""
from common import *
from server import transaction_steps,DEPOSIT_TOPIC,BATCH_TOPIC,header
from run import beacon
import argparse

def apply(steps):
 for step in steps:
  fact_json=json.dumps(step['fact']);kind=step['fact']['kind']
  if kind=='Update':a=action('publisher','ethrelay','update',{'fact_json':fact_json})
  elif kind=='Header':a=action('publisher','ethrelay','backfill',{'child':step['child'],'fact_json':fact_json})
  elif kind=='Receipt' and step.get('batch') is not None:a=action('publisher','ethbridge','complete',{'batch':step['batch'],'block':step['block'],'fact_json':fact_json})
  elif kind=='Receipt':a=action('publisher','ethbridge','deposit',{'block':step['block'],'fact_json':fact_json})
  else:raise ValueError('Unexpected public evidence')
  submit([a],[step])
def cycle():
 s=snapshot();c=s['config'];vault='0x'+c['vault'];funder=rpc('eth_accounts')[0]
 logs=rpc('eth_getLogs',{'address':vault,'fromBlock':'0x0','toBlock':'latest','topics':[DEPOSIT_TOPIC]})
 for log in logs[-200:]:
  id=int(log['data'][2:66],16)
  if http('/deposit?id='+str(id)) is None:
   prepared=transaction_steps(log['transactionHash'])
   if not prepared.get('pending'):apply(prepared['steps'])
 requests=http('/withdrawals?limit=100')['rows']
 if any(r['status']==0 for r in requests) and c['active'] is None:call('publisher','ethbridge','makeBatch')
 batches=http('/batches?limit=100')['rows']
 for b in batches:
  nonce=int(b['nonce'])
  if b['status']!=0:continue
  for i,request in enumerate(b['signing_requests']):
   if b['signatures'][i]:continue
   r=call('publisher','signhash','getRequest',request=int(request))
   if r['complete']:call('publisher','ethbridge','gather',batch=nonce,signer=i)
  b=next(x for x in http('/batches?limit=100')['rows'] if int(x['nonce'])==nonce)
  if not b['calldata']:continue
  events=rpc('eth_getLogs',{'address':vault,'fromBlock':'0x0','toBlock':'latest','topics':[BATCH_TOPIC]});event=next((e for e in events if int(e['data'][2:66],16)==nonce),None)
  txid=event['transactionHash'] if event else rpc('eth_sendTransaction',{'from':funder,'to':vault,'data':'0x'+b['calldata'],'gas':'0x989680'})
  prepared=transaction_steps(txid,'complete',nonce)
  if not prepared.get('pending'):
   apply(prepared['steps'])
   for payment in json.loads(b['payments']):
    # Publicly collect the allocation into the exact signed recipient. Gas is
    # sponsored by a disposable devnet account, never charged to custody reserves.
    data='0xddeae033'+payment['address'].rjust(64,'0')
    try:rpc('eth_sendTransaction',{'from':funder,'to':vault,'data':data,'gas':'0x989680'})
    except ValueError:pass
 network=json.loads((STATE/'network.json').read_text());slot=(int(time.time())-network['genesis_time'])//12
 if slot-int(snapshot()['relay']['finalized_slot'])>8:
  p=beacon(rpc('eth_getBlockByNumber','latest',False));submit([action('publisher','ethrelay','update',{'fact_json':json.dumps(p['fact'])})],[p])
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--state');parser.parse_args()
 while True:
  try:
   if not (STATE/'pause-coordinator').exists():cycle()
  except Exception as e:print('Public coordination waiting:',str(e),flush=True)
  time.sleep(2)
