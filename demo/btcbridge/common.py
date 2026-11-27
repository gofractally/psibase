"""Regtest development helpers. No custody keys are loaded by this module."""
from pathlib import Path
import base64,hashlib,json,os,subprocess,urllib.request,urllib.error,threading
ROOT=Path(__file__).resolve().parents[2]
STATE=Path(os.environ.get('BTCBRIDGE_STATE',Path(__file__).parent/'state')).resolve()
NODE_PORT=int(os.environ.get('BTCBRIDGE_NODE_PORT','8091'))
WEB_PORT=int(os.environ.get('BTCBRIDGE_WEB_PORT','8092'))
RPC_PORT=int(os.environ.get('BTCBRIDGE_RPC_PORT','18453'))
P2P_PORT=int(os.environ.get('BTCBRIDGE_P2P_PORT','18454'))
# A chain other than this harness's own: its root host (BTCBRIDGE_HOST, e.g. example.net), the URL
# the CLI is given (BTCBRIDGE_API) and the scheme its pages are reached by (BTCBRIDGE_SCHEME).
# Queries still go to 127.0.0.1:NODE_PORT with the service's Host header.
HOST=os.environ.get('BTCBRIDGE_HOST',f'psibase.localhost:{NODE_PORT}')
SCHEME=os.environ.get('BTCBRIDGE_SCHEME','http')
API=os.environ.get('BTCBRIDGE_API',f'http://{HOST}/')
ORIGIN=f'{SCHEME}://btcbridge.{HOST}'
RUST_HOST=next(line.split(': ',1)[1] for line in subprocess.check_output(['rustc','-vV'],text=True).splitlines() if line.startswith('host: '))
CLI=Path(os.environ.get('BTCBRIDGE_CLI',ROOT/f'rust/target/{RUST_HOST}/release/psibase'))
DAEMON=Path(os.environ.get('BTCBRIDGE_SIGNING_DAEMON',ROOT/f'packages/user/target/{RUST_HOST}/debug/signing-daemon'))
NODE=Path(os.environ.get('BTCBRIDGE_NODE_BIN',ROOT/'build/psinode'))
CARGO_PSIBASE=Path(os.environ.get('BTCBRIDGE_CARGO_PSIBASE',ROOT/'rust/target/release/cargo-psibase'))
PSITEST=Path(os.environ.get('BTCBRIDGE_PSITEST',ROOT/'build/psitest'))
PACKAGE_SOURCE=Path(os.environ.get('BTCBRIDGE_PACKAGE_SOURCE',ROOT/'demo/artifacts/packages')).resolve()
BITCOIN=Path(os.environ.get('BTCBRIDGE_BITCOIN_BIN',Path(__file__).parent/'bin/bitcoin-32.1/bin'))
LOCK=threading.RLock()
RELAYER=os.environ.get('BTCBRIDGE_RELAYER_ACCOUNT','alice')
# 'signet': an existing signet node (BTCBRIDGE_RPC_PORT, BTCBRIDGE_RPC_COOKIE) in place of this harness's own regtest node.
NETWORK=os.environ.get('BTCBRIDGE_NETWORK','regtest')
def http(path,service='btcbridge'):
 req=urllib.request.Request(f'http://127.0.0.1:{NODE_PORT}{path}',headers={'Host':f'{service}.{HOST}'})
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def snapshot(owner='alice'):return http('/snapshot?owner='+owner)
def action(sender,service,method,data):return dict(sender=sender,service=service,method=method,data=data)
def signing_flags(senders):
 keys=[]
 for sender in sorted(set(senders)):
  specific=Path(os.environ['BTCBRIDGE_RELAYER_KEY']) if sender==RELAYER and os.environ.get('BTCBRIDGE_RELAYER_KEY') else STATE/'account-keys'/(sender+'.pem')
  key=specific if specific.exists() else STATE/'account-keys/psibase.pem'
  if key.exists() and key not in keys:keys.append(key)
 return [part for key in keys for part in ('--sign',str(key))]
def push(actions,*,signed=True):
 with LOCK:
  result=subprocess.run([str(CLI),'push','-a',API,'--trace','json','--console=false',*(signing_flags(a['sender'] for a in actions) if signed else []),'-'],input=json.dumps(actions),text=True,capture_output=True,timeout=120)
 try:trace=json.loads(result.stdout)
 except ValueError:trace={}
 if result.returncode or trace.get('error'):raise ValueError(trace.get('error') or result.stderr[-3000:] or result.stdout[-3000:])
 def walk(t):
  yield t
  for inner in t.get('innerTraces',[]):
   if inner.get('inner',{}).get('ActionTrace'):yield from walk(inner['inner']['ActionTrace'])
 entries=[v for t in trace.get('actionTraces',[]) for v in walk(t)]
 output=[];offset=0
 for requested in actions:
  for n in range(offset,len(entries)):
   a=entries[n].get('action',{})
   if a.get('sender')==requested['sender'] and a.get('service')==requested['service'] and a.get('method','').lower()==requested['method'].lower():
    output.append(entries[n].get('retval'));offset=n+1;break
  else:raise ValueError('Missing confirmed action trace')
 return output

def call(_sender,_service,_method,**data):return push([action(_sender,_service,_method,data)])[0]
def rpc(method,*params,wallet=None):
 cookie=Path(os.environ.get('BTCBRIDGE_RPC_COOKIE',STATE/'bitcoin/regtest/.cookie')).read_text().strip()
 url=f'http://127.0.0.1:{RPC_PORT}/'+('wallet/'+wallet if wallet else '')
 req=urllib.request.Request(url,json.dumps({'jsonrpc':'2.0','id':'btcbridge-test','method':method,'params':list(params)}).encode(),{'Authorization':'Basic '+base64.b64encode(cookie.encode()).decode(),'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=60) as r:reply=json.load(r)
 except urllib.error.HTTPError as e:
  reply=json.load(e);e.close()
 if reply.get('error'):raise ValueError(str(reply['error']))
 return reply['result']
def mine(blocks=7):return rpc('generatetoaddress',blocks,rpc('getnewaddress',wallet='faucet'))
def sha256d(b):return hashlib.sha256(hashlib.sha256(b).digest()).digest()
def merkle(txid,block):
 ids=rpc('getblock',block,1)['tx'];index=ids.index(txid);position=index;nodes=[bytes.fromhex(t)[::-1] for t in ids];siblings=[]
 while len(nodes)>1:
  if len(nodes)%2:nodes.append(nodes[-1])
  siblings.append(nodes[index^1][::-1].hex());nodes=[sha256d(nodes[n]+nodes[n+1]) for n in range(0,len(nodes),2)];index//=2
 return {'merkle':siblings,'pos':position,'block_height':rpc('getblockheader',block)['height']}
def proof(txid):
 tx=rpc('getrawtransaction',txid,True);block=tx['blockhash'];p=merkle(txid,block)
 return dict(raw=tx['hex'],block=block,siblings=p['merkle'],position=p['pos'])
def relay_headers():
 state=snapshot();height=rpc('getblockcount');common=min(height,state['relay']['height'])
 while http('/header?height='+str(common))['id']!=rpc('getblockhash',common):
  if common<=state['relay']['checkpoint_height']:raise ValueError('Fork crosses checkpoint')
  common-=1
 if state['relay']['network']=='signet':
  # A signet header is accepted only with its block-signature proof (BIP 325): the raw coinbase
  # transaction (with witness) and the coinbase's Merkle branch. Sixteen per action.
  for start in range(common+1,height+1,16):
   call(RELAYER,'btcrelay','signetHeaders',blocks=[signet_block(rpc('getblockhash',h)) for h in range(start,min(start+16,height+1))])
  return
 for start in range(common+1,height+1,32):
  headers=[rpc('getblockheader',rpc('getblockhash',h),False) for h in range(start,min(start+32,height+1))]
  call(RELAYER,'btcrelay','headers',headers=headers)
def signet_block(block):
 coinbase=rpc('getblock',block,1)['tx'][0]
 return {'header':rpc('getblockheader',block,False),'coinbase':rpc('getrawtransaction',coinbase,False,block),'branch':merkle(coinbase,block)['merkle']}
def prove_deposit(txid):
 if http('/explorer/transaction?txid='+txid) is not None:return
 p=proof(txid);tx=rpc('decoderawtransaction',p['raw'])
 for out in tx['vout']:
  script=out['scriptPubKey']['hex']
  if len(script)!=68 or not script.startswith('0020'):continue
  if http('/deposit-address?script='+script) is None:continue
  known=http('/outpoint?txid='+txid+'&vout='+str(out['n']))
  if known is None:
   try:call(RELAYER,'btcbridge','deposit',**p,vout=out['n'])
   except ValueError as error:
    if 'already processed' not in str(error):raise

def scan_deposits():
 """Permissionless coordinator, separate from the BTC-blind signing providers."""
 path=STATE/'public-relayer-cursor.json'
 cursor=json.loads(path.read_text()).get('after',0) if path.exists() else 0
 page=http('/addresses?limit=10&after='+str(cursor));addresses=page['addresses']
 if addresses:
  with LOCK:outputs=rpc('scantxoutset','start',[{'desc':'addr('+a['address']+')'} for a in addresses])['unspents']
  required=snapshot()['relay']['required']
  for txid in sorted({u['txid'] for u in outputs}):
   tx=rpc('getrawtransaction',txid,True)
   if tx.get('confirmations',0)>=required:prove_deposit(txid)
 path.write_text(json.dumps({'after':page['next'] or 0}))
def drive():
 """Public coordinator. All signatures come from the separate generic signing daemons."""
 relay_headers();scan_deposits();state=snapshot()
 queued=[r for r in state['requests'] if r['status']==0]
 if queued and (len(queued)>=state['policy']['batch_size'] or state['now']>=min(r['created'] for r in queued)+state['policy']['batch_seconds']):
  call(RELAYER,'btcbridge','makeBatch');state=snapshot()
 for b in state['batches']:
  if b['status']!=0:continue
  rev=next(r for r in state['revisions'] if r['batch']==b['id'] and r['revision']==b['current_revision'])
  plan=json.loads(rev['plan'])
  # An earlier revision may already have been mined. Do not request or broadcast
  # a conflicting replacement while waiting for its confirmed completion proof.
  mined=False
  for candidate in [r for r in state['revisions'] if r['batch']==b['id']]:
   try:observed=rpc('getrawtransaction',json.loads(candidate['plan'])['txid'],True)
   except ValueError:continue
   if observed.get('confirmations',0)>0:
    mined=True
    if observed['confirmations']>=state['relay']['required']:call(RELAYER,'btcbridge','complete',**proof(observed['txid']))
    break
  if mined:continue
  for signer in range(3):
   if any(s['batch']==b['id'] and s['revision']==b['current_revision'] and s['signer']==signer for s in state['signatures']):continue
   links=[l for l in state['signing_links'] if l['batch']==b['id'] and l['revision']==b['current_revision'] and l['signer']==signer]
   if len(links)<len(plan['inputs']):call(RELAYER,'btcbridge','requestSigs',batch=b['id'],rev=b['current_revision'],signer=signer,max_requests=16)
   elif all(any(r['id']==l['request'] and r['signature'] for r in state['hash_requests']) for l in links):call(RELAYER,'btcbridge','gather',batch=b['id'],rev=b['current_revision'],signer=signer)
  for candidate in [r for r in state['revisions'] if r['batch']==b['id']]:
   candidate_plan=json.loads(candidate['plan'])
   if candidate['revision']==b['current_revision'] and candidate['raw']:
    try:rpc('sendrawtransaction',candidate['raw'])
    except ValueError as e:
     if not any(s in str(e) for s in ('already','conflict','spent','missing','insufficient fee')):raise
   try:tx=rpc('getrawtransaction',candidate_plan['txid'],True)
   except ValueError:continue
   if tx.get('confirmations',0)>=state['relay']['required']:
    call(RELAYER,'btcbridge','complete',**proof(candidate_plan['txid']));break
