#!/usr/bin/env python3
"""Loopback-only Esplora-compatible regtest data and broadcast gateway. Never reads signing secrets."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
import json,re
from common import *
from exchange_adapter import wallet as exchange_wallet,ORIGIN as EXCHANGE_ORIGIN
ACCOUNTS={'alice','bob','carol','liquidity'}
METHODS={'btcbridge':{'newAddress','withdraw','cancel','makeBatch','requestSigs','gather','complete','deposit','bump','reportSpend'},'btcrelay':{'headers'},'tokens':{'debit','credit'}}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,status,value):
  raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store')
  if self.headers.get('Origin') in (ORIGIN,EXCHANGE_ORIGIN):self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Vary','Origin')
  self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def local_host(self):return self.headers.get('Host') in (f'127.0.0.1:{WEB_PORT}',f'localhost:{WEB_PORT}')
 def body(self):
  size=int(self.headers.get('Content-Length','0'))
  if not 0<size<=2_000_000:raise ValueError('Request size limit')
  return self.rfile.read(size)
 def do_OPTIONS(self):
  if not self.local_host() or self.headers.get('Origin') not in (ORIGIN,EXCHANGE_ORIGIN):return self.reply(403,{'error':'Origin denied'})
  self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()
 def do_GET(self):
  if not self.local_host():return self.reply(403,{'error':'Local host required'})
  try:
   path=urlsplit(self.path).path
   query=parse_qs(urlsplit(self.path).query)
   if path=='/api/state':
    account=query.get('account',['alice'])[0]
    if account not in ACCOUNTS:raise ValueError('Unknown demo wallet')
    return self.reply(200,exchange_wallet.read_state(account))
   if path=='/api/tokens':return self.reply(200,exchange_wallet.read_tokens(query.get('after',[0])[0],query.get('limit',[200])[0]))
   if path=='/api/trades':return self.reply(200,exchange_wallet.read_trades(query.get('market',[None])[0],query.get('limit',[50])[0],query.get('before',[None])[0],query.get('after',[None])[0]))
   if path=='/api/health':return self.reply(200,{'ok':True,'network':'regtest'})
   if not path.startswith('/bitcoin/'):raise ValueError('Unknown endpoint')
   parts=path[len('/bitcoin/'):].split('/')
   if parts==['blocks','tip','height']:result=rpc('getblockcount')
   elif len(parts)==2 and parts[0]=='block-height':result=rpc('getblockhash',int(parts[1]))
   elif len(parts)==3 and parts[0]=='block' and parts[2]=='header':result=rpc('getblockheader',parts[1],False)
   elif len(parts)>=2 and parts[0]=='tx':
    tx=rpc('getrawtransaction',parts[1],True)
    if len(parts)==3 and parts[2]=='hex':result=tx['hex']
    elif len(parts)==3 and parts[2]=='merkle-proof':result=merkle(parts[1],tx['blockhash'])
    else:
     status={'confirmed':tx.get('confirmations',0)>0}
     if status['confirmed']:status.update(block_hash=tx['blockhash'],block_height=rpc('getblockheader',tx['blockhash'])['height'])
     result={'txid':tx['txid'],'status':status,'vout':[{'scriptpubkey':v['scriptPubKey']['hex'],'value':round(v['value']*1e8)} for v in tx['vout']]}
   elif len(parts)==3 and parts[0]=='address' and parts[2]=='utxo':
    with LOCK:scan=rpc('scantxoutset','start',[{'desc':'addr('+parts[1]+')'}])
    result=[{'txid':u['txid'],'vout':u['vout'],'value':round(u['amount']*1e8),'status':{'confirmed':True,'block_height':u['height']}} for u in scan['unspents']]
   else:raise ValueError('Unsupported Bitcoin gateway endpoint')
   self.reply(200,result)
  except Exception as e:self.reply(400,{'error':str(e)})
 def do_POST(self):
  try:
   path=urlsplit(self.path).path
   expected=EXCHANGE_ORIGIN if path in ('/api/action','/api/deposit','/api/withdraw') else ORIGIN
   if not self.local_host() or self.headers.get('Origin')!=expected:return self.reply(403,{'error':'Origin denied'})
   if path=='/bitcoin/tx':return self.reply(200,rpc('sendrawtransaction',self.body().decode()))
   body=json.loads(self.body())
   return self.reply(410,{'error':'Wallet and test-faucet endpoints have been removed. Connect your Psibase account in the app.'})
  except Exception as e:self.reply(400,{'error':str(e)})
if __name__=='__main__':
 if rpc('getblockchaininfo')['chain']!='regtest':raise RuntimeError('Development gateway requires isolated Bitcoin regtest')
 ThreadingHTTPServer(('127.0.0.1',WEB_PORT),Handler).serve_forever()
