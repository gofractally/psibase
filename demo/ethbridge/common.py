"""Private local devnet helpers; no signer secrets are served to the browser."""
from pathlib import Path
import json,os,subprocess,urllib.request,urllib.error,threading,time,tempfile
ROOT=Path(__file__).resolve().parents[2]
STATE=Path(os.environ.get('ETHBRIDGE_STATE',Path(__file__).parent/'state')).resolve()
NODE_PORT=int(os.environ.get('ETHBRIDGE_NODE_PORT','8093'));WEB_PORT=int(os.environ.get('ETHBRIDGE_WEB_PORT','8094'));RPC_PORT=int(os.environ.get('ETHBRIDGE_RPC_PORT','8095'))
API=f'http://psibase.localhost:{NODE_PORT}/';ORIGIN=f'http://ethbridge.psibase.localhost:{NODE_PORT}'
RUST_HOST=subprocess.check_output(['rustc','-vV'],text=True).split('host: ')[1].splitlines()[0]
CLI=ROOT/f'rust/target/{RUST_HOST}/release/psibase';BOOT_CLI=ROOT/'rust/target/release/psibase'
DAEMON=ROOT/f'packages/user/target/{RUST_HOST}/debug/signing-daemon'
RELAYER=ROOT/f'packages/user/target/{RUST_HOST}/debug/ethbridge-relayer'
BEACON=ROOT/f'packages/user/target/{RUST_HOST}/debug/examples/dev_beacon'
LOCK=threading.RLock()
def action(sender,service,method,data):return dict(sender=sender,service=service,method=method,data=data)
def signing_flags(senders):
 keys=[]
 for sender in sorted(set(senders)):
  key=STATE/'account-keys'/(sender+'.pem')
  if not key.exists():key=STATE/'account-keys/psibase.pem'
  if key.exists() and key not in keys:keys.append(key)
 return [v for key in keys for v in ('--sign',str(key))]
def http(path,service='ethbridge'):
 req=urllib.request.Request(f'http://127.0.0.1:{NODE_PORT}{path}',headers={'Host':f'{service}.psibase.localhost:{NODE_PORT}'})
 with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)
def snapshot():return http('/snapshot')
def push(actions):
 with LOCK:
  r=subprocess.run([CLI,'push','-a',API,'--trace','json','--console=false',*signing_flags(a['sender'] for a in actions),'-'],input=json.dumps(actions),capture_output=True,text=True,timeout=180)
 try:trace=json.loads(r.stdout)
 except ValueError:trace={}
 if r.returncode or trace.get('error'):raise ValueError(trace.get('error') or r.stderr[-2000:] or r.stdout[-2000:])
 def walk(t):
  yield t
  for inner in t.get('innerTraces',[]):
   if inner.get('inner',{}).get('ActionTrace'):yield from walk(inner['inner']['ActionTrace'])
 entries=[v for t in trace.get('actionTraces',[]) for v in walk(t)];out=[];offset=0
 for a in actions:
  for i in range(offset,len(entries)):
   actual=entries[i].get('action',{})
   if actual.get('sender')==a['sender'] and actual.get('service')==a['service'] and actual.get('method','').lower()==a['method'].lower():out.append(entries[i].get('retval'));offset=i+1;break
  else:raise ValueError('Missing confirmed action trace')
 return out
def call(sender,service,method,**data):return push([action(sender,service,method,data)])[0]
def rpc(method,*params):
 req=urllib.request.Request(f'http://127.0.0.1:{RPC_PORT}/',json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':list(params)}).encode(),{'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=45) as r:j=json.load(r)
 if j.get('error'):raise ValueError(j['error']['message'])
 return j['result']
def inspect(witness):
 with tempfile.NamedTemporaryFile(mode='w',suffix='.json',dir=STATE) as data:
  json.dump(witness,data);data.flush();r=subprocess.run([RELAYER,'inspect',data.name],check=True,capture_output=True,text=True,timeout=30)
 return json.loads(r.stdout)
def submit(actions,proofs):
 with tempfile.NamedTemporaryFile(mode='w',suffix='.json',dir=STATE) as data:
  json.dump({'actions':actions,'witnesses':[p['witness'] for p in proofs]},data);data.flush()
  keyargs=signing_flags(a['sender'] for a in actions)[1::2]
  r=subprocess.run([RELAYER,'submit',API,data.name,*keyargs],capture_output=True,text=True,timeout=180)
 try:trace=json.loads(r.stdout)
 except ValueError:trace={}
 if r.returncode or trace.get('error'):raise ValueError(trace.get('error') or r.stderr[-2000:] or r.stdout[-2000:])
 return trace
def wait(fn,seconds=90):
 end=time.monotonic()+seconds;last=None
 while time.monotonic()<end:
  try:return fn()
  except Exception as e:last=e;time.sleep(.5)
 raise RuntimeError(str(last))
def block_info(block):return {'hash':block['hash'][2:],'parent_hash':block['parentHash'][2:],'state_root':block['stateRoot'][2:],'receipts_root':block['receiptsRoot'][2:],'number':int(block['number'],16)}
