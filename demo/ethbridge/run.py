#!/usr/bin/env python3
"""Operate an isolated, loopback-only ETH bridge development network."""
from common import *
import argparse,shutil,zipfile,hashlib,signal,sys
import auth
PROVIDERS=['sigone','sigtwo','sigtri'];PACKAGES=STATE/'packages'
def invoke(args,**kwargs):return subprocess.run([str(a) for a in args],check=True,**kwargs)
def proc(name,args):
 STATE.mkdir(parents=True,exist_ok=True);path=STATE/(name+'.pid')
 if path.exists():
  pid=int(path.read_text());command=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if command.strip():
   if str(STATE) not in command:raise RuntimeError('Process ID belongs to another task')
   return
 with (STATE/(name+'.log')).open('a') as log:p=subprocess.Popen([str(a) for a in args],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 path.write_text(str(p.pid))
def prepare():
 PACKAGES.mkdir(parents=True,exist_ok=True);index=json.loads((ROOT/'demo/artifacts/packages/index.json').read_text());index=[e for e in index if e['name'] not in ('Signing','EthBridge','Exchange')]
 for e in index:
  out=PACKAGES/e['file'];out.unlink(missing_ok=True);out.symlink_to((ROOT/'demo/artifacts/packages'/e['file']).resolve())
 for name in ['Signing','EthBridge']:
  source=ROOT/f'packages/user/target/wasm32-wasip1/release/packages/{name}.psi';out=PACKAGES/(name+'.psi');shutil.copyfile(source,out)
  with zipfile.ZipFile(out) as z:meta=json.loads(z.read('meta.json'))
  meta.update(file=out.name,sha256=hashlib.sha256(out.read_bytes()).hexdigest());index.append(meta)
 (PACKAGES/'index.json').write_text(json.dumps(index))
def base():
 (STATE/'chain').mkdir(parents=True,exist_ok=True);conf=STATE/'chain/config'
 if not conf.exists():conf.write_text(f'p2p = off\nproducer = psibase\nhost = psibase.localhost\nlisten = 127.0.0.1:{NODE_PORT}\nmount = {PACKAGES}\ndatabase-cache-size = 256MiB\nservice-threads = 4\nhttp-timeout = 120s\n\n[logger.stderr]\ntype = console\nfilter = Severity >= warning\nformat = [{{Severity}}] {{Message}}\n')
 proc('node',[ROOT/'build/psinode',STATE/'chain','--proof-timeout-ms','30000'])
 def ready():
  try:urllib.request.urlopen(f'http://127.0.0.1:{NODE_PORT}/',timeout=1)
  except urllib.error.HTTPError:return True
 wait(ready)
 proc('evm',['node',Path(__file__).parent/'evm.mjs',STATE,'serve',RPC_PORT]);wait(lambda:rpc('eth_chainId'))
def signers():
 for i in range(3):proc('signer-'+str(i),[DAEMON,'watch',STATE/f'signer-{i}.json'])
def setup():
 prepare();base();progress=STATE/'progress.json';stages=json.loads(progress.read_text()) if progress.exists() else {}
 def done(stage):stages[stage]=True;progress.write_text(json.dumps(stages))
 if not stages.get('boot'):
  invoke([BOOT_CLI,'boot','-a',API,'-p','psibase','--package-source',PACKAGES,'-k',auth.keypair('psibase')[1],'Minimal','Symbol','AuthSigService']);done('boot');time.sleep(3)
 if not stages.get('install'):
  for pkg in ['AuthSig','Host','Supervisor','WebCrypto','Profiles','Homepage','EthBridge']:
   invoke([CLI,'install','-a',API,'-S','psibase',*signing_flags(['psibase']),'-y','--package-source',PACKAGES,pkg])
  done('install')
 auth.provision()
 if not stages.get('secrets'):
  r=invoke([DAEMON,'generate',STATE/'secrets'],capture_output=True,text=True);(STATE/'deployment.json').write_text(r.stdout);done('secrets')
 deployment=json.loads((STATE/'deployment.json').read_text())['deployment']
 for i,provider in enumerate(PROVIDERS):
  config={'node_url':f'http://127.0.0.1:{NODE_PORT}','host':f'signhash.psibase.localhost:{NODE_PORT}','chain_url':API,'cli':str(CLI),'provider':provider,'key_path':str(STATE/f'secrets/signer-{i}.key'),'auth_key_path':str(STATE/f'account-keys/{provider}.pem'),'deployment':deployment,'journal':str(STATE/f'secrets/journal-{i}.json')};(STATE/f'signer-{i}.json').write_text(json.dumps(config))
 if not stages.get('keys'):
  call('signhash','signhash','init',deployment=deployment,providers=PROVIDERS);call('ethbridge','ethbridge','requestKeys',providers=PROVIDERS);done('keys')
 signers()
 def keys_ready():
  keys=[call('alice','signhash','getKey',key=i) for i in [1,2,3]]
  if any(not k['public_root'] for k in keys):raise ValueError('Awaiting generic custody public keys')
  return keys
 keys=wait(keys_ready)
 if not stages.get('vault'):
  (STATE/'custody-public.json').write_text(json.dumps({'deployment':deployment,'roots':[k['public_root'] for k in keys]}));invoke(['node',Path(__file__).parent/'evm.mjs',STATE,'deploy',RPC_PORT]);done('vault')
 if not stages.get('relay'):
  now=int(time.time());network={'genesis_root':hashlib.sha256(('test-only:'+deployment).encode()).hexdigest(),'genesis_time':now//12*12-9000*12,'forks':[{'epoch':0,'version':'05000000','electra':True}]};(STATE/'network.json').write_text(json.dumps(network));vault=json.loads((STATE/'vault.json').read_text());block=rpc('eth_getBlockByHash',vault['block'],False)
  proof=beacon(block,bootstrap=True);fact=proof['fact']['fact'];submit([action('ethrelay','ethrelay','init',{'network_json':json.dumps(network),'checkpoint':fact['beacon'],'fact_json':json.dumps(proof['fact']),'history_limit':256,'trust_slots':57344,'live_slots':256})],[proof]);done('relay')
 if not stages.get('bridge'):
  vault=json.loads((STATE/'vault.json').read_text());account=evidence('account',vault['address']+'@'+hex(vault['number']));receipt=evidence('receipt',vault['txid'],0)
  submit([action('ethbridge','ethbridge','init',{'chain_id':1338,'deployment':deployment,'vault':vault['address'][2:].lower(),'block':vault['block'][2:],'account_fact':json.dumps(account['fact']),'configured_fact':json.dumps(receipt['fact']),'treasury':'treasury','batch_size':1,'withdrawal_fee':1000})],[account,receipt]);done('bridge')
 for user in auth.USERS:call(user,'tokens','setUserConf',index=0,enabled=True)
 from publish import publish
 publish();(STATE/'ready.json').write_text(json.dumps({'url':ORIGIN,'chain_id':1338,'wallet':rpc('eth_accounts')[1]}));start()
def beacon(block,bootstrap=False):
 network=json.loads((STATE/'network.json').read_text());slot=(int(time.time())-network['genesis_time'])//12-3
 if not bootstrap:
  old=int(snapshot()['relay']['finalized_slot'])
  if slot<=old:raise ValueError('Waiting for next local beacon slot')
 data={'network':network,'block':block_info(block),'slot':slot,'bootstrap':bootstrap};r=invoke([BEACON],input=json.dumps(data),capture_output=True,text=True);return json.loads(r.stdout)
def evidence(kind,ref,log=0):
 r=invoke(['node',Path(__file__).parent/'evidence.mjs',f'http://127.0.0.1:{RPC_PORT}',kind,ref,log],capture_output=True,text=True);data=json.loads(r.stdout);proof=inspect(data['witness']);proof.update(witness=data['witness'],block=data['block'],number=data['number']);return proof
def start():
 base();signers();proc('gateway',[sys.executable,Path(__file__).parent/'server.py','--state',STATE]);wait(lambda:urllib.request.urlopen(f'http://127.0.0.1:{WEB_PORT}/health',timeout=2));proc('coordinator',[sys.executable,Path(__file__).parent/'coordinator.py','--state',STATE]);print(ORIGIN+'/')
def stop():
 for name in ['coordinator','gateway','signer-0','signer-1','signer-2','evm','node']:
  file=STATE/(name+'.pid')
  if not file.exists():continue
  pid=int(file.read_text());command=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if command.strip():
   if str(STATE) not in command:raise RuntimeError('Refusing another process')
   os.kill(pid,signal.SIGTERM)
  file.unlink()
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['setup','start','stop','status','publish','publish-ui']);args=parser.parse_args()
 if args.operation=='setup':setup()
 elif args.operation=='start':start()
 elif args.operation=='stop':stop()
 elif args.operation=='publish-ui':
  from publish import publish_ui
  publish_ui()
 elif args.operation=='publish':
  from publish import publish
  publish()
 else:print(json.dumps(snapshot(),indent=2))
