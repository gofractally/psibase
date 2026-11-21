#!/usr/bin/env python3
"""Loopback-only public evidence gateway and disposable EVM wallet.
No Psibase write/impersonation endpoint and no custody/auth secrets are exposed.
"""
from common import *
from run import beacon,evidence
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs
import argparse
TOPICS=json.loads((Path(__file__).parent/'vault-fixture.json').read_text())
DEPOSIT_TOPIC='0x'+TOPICS['deposit']['fact']['fact']['topics'][0]
BATCH_TOPIC='0x'+TOPICS['completed']['fact']['fact']['topics'][0]
RPC_READ={'eth_chainId','eth_accounts','eth_blockNumber','eth_getBlockByHash','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getBalance','eth_call','eth_gasPrice','eth_estimateGas'}
MUTEX=threading.RLock()
def header(hash):return http('/header?hash='+hash.removeprefix('0x'))
def transaction_steps(txid,kind='deposit',batch=None):
 with MUTEX:
  tx=rpc('eth_getTransactionReceipt',txid)
  if tx is None:return {'pending':True,'message':'Waiting for Ethereum mining'}
  vault=json.loads((STATE/'vault.json').read_text())['address'].lower();topic=DEPOSIT_TOPIC if kind=='deposit' else BATCH_TOPIC
  positions=[i for i,l in enumerate(tx['logs']) if l['address'].lower()==vault and l['topics'] and l['topics'][0]==topic]
  if not positions:raise ValueError('No matching bridge event in this Ethereum receipt')
  steps=[];target=rpc('eth_getBlockByHash',tx['blockHash'],False)
  if not header(target['hash']):
   latest=rpc('eth_getBlockByNumber','latest',False)
   if not header(latest['hash']):
    try:proof=beacon(latest)
    except ValueError as e:return {'pending':True,'message':str(e)}
    steps.append({'fact':proof['fact'],'witness':proof['witness'],'block':None,'batch':None,'child':None})
   current=latest
   for _ in range(128):
    if current['hash']==target['hash']:break
    parent=rpc('eth_getBlockByHash',current['parentHash'],False)
    if parent is None:raise ValueError('Execution ancestry missing')
    if not header(parent['hash']):
     p=evidence('header',parent['hash']);steps.append({'fact':p['fact'],'witness':p['witness'],'child':current['hash'][2:],'block':None,'batch':None})
    current=parent
   else:raise ValueError('Local ancestry window exceeded')
  credited=0
  for pos in positions:
   if kind=='deposit':
    id=int(tx['logs'][pos]['data'][2:66],16)
    if http('/deposit?id='+str(id)) is not None:credited+=1;continue
   p=evidence('receipt',txid,pos);steps.append({'fact':p['fact'],'witness':p['witness'],'block':tx['blockHash'][2:],'batch':batch,'child':None})
  return {'pending':False,'steps':steps,'already_credited':credited,'txid':txid}
class Handler(BaseHTTPRequestHandler):
 def allowed(self):return self.headers.get('Origin') in (None,ORIGIN)
 def send(self,status,data):
  encoded=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store')
  if self.headers.get('Origin')==ORIGIN:self.send_header('Access-Control-Allow-Origin',ORIGIN);self.send_header('Vary','Origin')
  self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
 def do_OPTIONS(self):
  if not self.allowed():return self.send(403,{'error':'Origin rejected'})
  self.send_response(204);self.send_header('Access-Control-Allow-Origin',ORIGIN);self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()
 def do_GET(self):
  if not self.allowed():return self.send(403,{'error':'Origin rejected'})
  path=urlsplit(self.path);params=parse_qs(path.query)
  try:
   if path.path=='/health':return self.send(200,{'network':'private-evm-synthetic-beacon','ready':True})
   if path.path=='/proofs/deposit':
    tx=params.get('txid',[''])[0]
    if len(tx)!=66 or not tx.startswith('0x') or any(c not in '0123456789abcdefABCDEF' for c in tx[2:]):raise ValueError('Invalid transaction hash')
    return self.send(200,transaction_steps(tx))
   if path.path=='/proofs/complete':return self.send(200,transaction_steps(params['txid'][0],'complete',int(params['batch'][0])))
   if path.path=='/proofs/finality':
    p=beacon(rpc('eth_getBlockByNumber','latest',False));return self.send(200,{'steps':[{'fact':p['fact'],'witness':p['witness'],'child':None,'block':None,'batch':None}]})
   if path.path=='/wallet':
    accounts=rpc('eth_accounts');return self.send(200,{'testnet':True,'chain_id':1338,'account':accounts[1],'balance_wei':str(int(rpc('eth_getBalance',accounts[1],'latest'),16)),'description':'Disposable local test ETH; no Ethereum custody keys are used by this wallet'})
   return self.send(404,{'error':'Not found'})
  except Exception as e:return self.send(400,{'error':str(e)})
 def do_POST(self):
  if self.path!='/rpc':return self.send(404,{'error':'No Psibase transaction endpoint'})
  if self.headers.get('Origin')!=ORIGIN:return self.send(403,{'error':'Origin rejected'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=131072:raise ValueError('RPC payload limit')
   req=json.loads(self.rfile.read(n));method=req['method'];params=req.get('params',[])
   if method not in RPC_READ and method!='eth_sendTransaction':raise ValueError('Unsupported local wallet method')
   if method=='eth_sendTransaction':
    tx=params[0];vault=json.loads((STATE/'vault.json').read_text())['address'].lower();accounts=[a.lower() for a in rpc('eth_accounts')]
    if tx.get('from','').lower() not in accounts or tx.get('to','').lower()!=vault:raise ValueError('Local wallet only sends to the test bridge vault')
    if int(tx.get('value','0x0'),16)>10**18:raise ValueError('Local test deposit capped at 1 ETH')
   result=rpc(method,*params);return self.send(200,{'jsonrpc':'2.0','id':req.get('id'),'result':result})
  except Exception as e:return self.send(400,{'error':str(e)})
 def log_message(self,fmt,*args):pass
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--state');p.parse_args();ThreadingHTTPServer(('127.0.0.1',WEB_PORT),Handler).serve_forever()
