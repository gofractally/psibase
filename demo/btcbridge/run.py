#!/usr/bin/env python3
"""Build and operate a fresh, loopback-only Bitcoin/Psibase bridge demonstration."""
import argparse,json,os,shutil,signal,subprocess,sys,time,zipfile,hashlib
from pathlib import Path
from common import *
import auth
PROVIDERS=['sigone','sigtwo','sigtri']
_CHILDREN={}
PACKAGES=STATE/'packages'
def invoke(args,**kwargs):return subprocess.run([str(a) for a in args],check=True,**kwargs)
def matches_process(name,pid,command):
 if str(STATE) in command:return True
 # Migrate the original gateway command, which predates explicit --state process tags.
 if name=='gateway' and str(ROOT/'demo/btcbridge/server.py') in command:
  lsof=shutil.which('lsof')
  if lsof:
   return subprocess.run([lsof,'-a','-p',str(pid),f'-iTCP:{WEB_PORT}','-sTCP:LISTEN'],capture_output=True).returncode==0
 return False
def proc(name,command):
 STATE.mkdir(parents=True,exist_ok=True);pidfile=STATE/(name+'.pid')
 if pidfile.exists():
  pid=int(pidfile.read_text());old=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if old.strip():
   if not matches_process(name,pid,old):raise RuntimeError('Stale process ID belongs to another program')
   return
 with (STATE/(name+'.log')).open('a') as log:p=subprocess.Popen([str(a) for a in command],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 _CHILDREN[name]=p
 pidfile.write_text(str(p.pid))
def wait(fn,seconds=45):
 end=time.monotonic()+seconds;last=None
 while time.monotonic()<end:
  try:return fn()
  except Exception as e:
   last=e
   if isinstance(e,urllib.error.HTTPError):e.close()
   time.sleep(.25)
 raise RuntimeError(f'Startup failed: {last}; inspect {STATE}/*.log')
def build():
 invoke(['cargo','build','--manifest-path',ROOT/'rust/Cargo.toml','-p','psibase','--release','--target',RUST_HOST])
 invoke(['npm','run','build'],cwd=ROOT/'packages/user/BtcBridge/ui')
 env=os.environ.copy();sdk=Path(os.environ.get('BTCBRIDGE_WASI_SDK','/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk'))
 env.update(CC_wasm32_wasip1=str(sdk/'bin/clang'),AR_wasm32_wasip1=str(sdk/'bin/llvm-ar'))
 invoke([ROOT/'rust/target/release/cargo-psibase','psibase','--manifest-path',ROOT/'packages/user/Cargo.toml','--psitest',ROOT/'build/psitest','-p','signing-pkg','-p','btcbridge-pkg','package'],env=env)
 invoke(['cargo','build','--manifest-path',ROOT/'packages/user/Signing/daemon/Cargo.toml','--target',RUST_HOST,'--target-dir',ROOT/'packages/user/target'])
def prepare_packages():
 PACKAGES.mkdir(parents=True,exist_ok=True)
 index=json.loads((ROOT/'demo/artifacts/packages/index.json').read_text())
 index=[e for e in index if e['name'] not in ('Signing','BtcBridge')]
 for e in index:
  out=PACKAGES/e['file']
  if out.is_symlink() or out.exists():out.unlink()
  out.symlink_to((ROOT/'demo/artifacts/packages'/e['file']).resolve())
  if e['name']=='Exchange':
   source=out.resolve();out.unlink()
   with zipfile.ZipFile(source) as old,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as new:
    for item in old.infolist():
     data=old.read(item.filename)
     if item.filename=='meta.json':
      meta=json.loads(data)
      if not any(d['name']=='EventsService' for d in meta['depends']):meta['depends'].append({'name':'EventsService','version':'0.29.0'})
      data=json.dumps(meta).encode()
     new.writestr(item,data)
   e['sha256']=hashlib.sha256(out.read_bytes()).hexdigest()
 for name in ('Signing','BtcBridge'):
  source=ROOT/f'packages/user/target/wasm32-wasip1/release/packages/{name}.psi'
  out=PACKAGES/(name+'.psi');shutil.copyfile(source,out)
  with zipfile.ZipFile(out) as z:meta=json.loads(z.read('meta.json'))
  meta.update(file=out.name,sha256=hashlib.sha256(out.read_bytes()).hexdigest());index.append(meta)
 (PACKAGES/'index.json').write_text(json.dumps(index))
def start_base():
 (STATE/'bitcoin').mkdir(parents=True,exist_ok=True)
 proc('bitcoin',[BITCOIN/'bitcoind',f'-datadir={STATE}/bitcoin','-regtest','-server','-txindex=1','-listen=0','-connect=0','-dnsseed=0','-discover=0',f'-rpcport={RPC_PORT}','-rpcbind=127.0.0.1','-rpcallowip=127.0.0.1',f'-port={P2P_PORT}','-fallbackfee=0.00001000'])
 wait(lambda:rpc('getblockchaininfo'))
 (STATE/'chain').mkdir(parents=True,exist_ok=True)
 conf=STATE/'chain/config'
 if not conf.exists():conf.write_text(f'p2p = off\nproducer = psibase\nhost = psibase.localhost\nlisten = 127.0.0.1:{NODE_PORT}\nmount = {PACKAGES.resolve()}\ndatabase-cache-size = 256MiB\nservice-threads = 4\nhttp-timeout = 30s\n\n[logger.stderr]\ntype = console\nfilter = Severity >= warning\nformat = [{{Severity}}] {{Message}}\n')
 proc('node',[ROOT/'build/psinode',STATE/'chain'])
 def node_ready():
  try:urllib.request.urlopen(f'http://127.0.0.1:{NODE_PORT}/',timeout=1)
  except urllib.error.HTTPError as error:
   error.close();return True
 wait(node_ready)
def start_signers():
 for n in range(3):proc('signer-'+str(n),[DAEMON,'watch',STATE/f'signer-{n}.json'])
def _setup():
 if (STATE/'ready.json').exists():return start()
 prepare_packages();start_base()
 progress_path=STATE/'progress.json';progress=json.loads(progress_path.read_text()) if progress_path.exists() else {}
 def done(stage):progress[stage]=True;progress_path.write_text(json.dumps(progress))
 if not progress.get('boot'):
  # The released Symbol query module exceeds the normal transaction staging budget.
  # Include this platform dependency in genesis; application modules install normally.
  invoke([Path(os.environ.get('BTCBRIDGE_BOOT_CLI',ROOT/'rust/target/release/psibase')),'boot','-a',API,'-p','psibase','--package-source',PACKAGES.resolve(),'-k',auth.keypair('psibase')[1],'Minimal','Symbol','AuthSigService']);done('boot')
 if not progress.get('install'):
  # Boot uses optimistic pushes. Let their block references and package metadata
  # become visible in the committed head before resolving/installing more apps.
  for _ in range(2):
   previous=wait(lambda:http('/common/tapos/head',service='psibase'))
   def advanced():
    current=http('/common/tapos/head',service='psibase')
    if current==previous:raise ValueError('Waiting for committed boot head')
    return current
   wait(advanced)
  for package in ('AuthSig','Host','Supervisor','WebCrypto','Profiles','Homepage','BtcBridge','Exchange'):
   invoke([CLI,'install','-a',API,'-S','psibase',*signing_flags(['psibase']),'-y','--package-source',PACKAGES.resolve(),package])
  done('install')
 auth.provision()
 if not progress.get('faucet'):
  try:rpc('createwallet','faucet')
  except ValueError:rpc('loadwallet','faucet')
  if rpc('getblockcount')<105:mine(105-rpc('getblockcount'))
  done('faucet')
 else:
  if 'faucet' not in rpc('listwallets'):rpc('loadwallet','faucet')
 if not progress.get('secrets'):
  generated=subprocess.run([str(DAEMON),'generate',str(STATE/'secrets')],check=True,capture_output=True,text=True)
  deployment=json.loads(generated.stdout)['deployment'];(STATE/'deployment.json').write_text(json.dumps({'deployment':deployment}));done('secrets')
 deployment=json.loads((STATE/'deployment.json').read_text())['deployment']
 for n,provider in enumerate(PROVIDERS):
  config={'node_url':f'http://127.0.0.1:{NODE_PORT}','host':f'signhash.psibase.localhost:{NODE_PORT}','chain_url':API,'cli':str(CLI),'provider':provider,'key_path':str(STATE/f'secrets/signer-{n}.key'),'auth_key_path':str(STATE/f'account-keys/{provider}.pem'),'deployment':deployment,'journal':str(STATE/f'secrets/journal-{n}.json')}
  (STATE/f'signer-{n}.json').write_text(json.dumps(config,indent=2))
 if not progress.get('signing'):
  call('signhash','signhash','init',deployment=deployment,providers=PROVIDERS)
  call('btcbridge','btcbridge','createKeys',providers=PROVIDERS);done('signing')
 start_signers()
 def keys_ready():
  keys=[call('alice','signhash','getKey',key=n) for n in (1,2,3)]
  if not all(k['public_root'] for k in keys):raise ValueError('Awaiting public keys from generic signing daemons')
  return keys
 keys=wait(keys_ready)
 if not progress.get('relay'):
  genesis=rpc('getblockheader',rpc('getblockhash',0),False)
  call('btcrelay','btcrelay','init',network='regtest',checkpoint_height=0,context=[genesis],required=7);done('relay')
 if not progress.get('bridge'):
  # Extended-key network prefixes are a Bitcoin app concern; generic signers publish neutral xpub roots.
  alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  def testnet_root(root):
   number=0
   for c in root:number=number*58+alphabet.index(c)
   payload=number.to_bytes(82,'big')[:-4];payload=bytes.fromhex('043587cf')+payload[4:];data=payload+sha256d(payload)[:4]
   number=int.from_bytes(data,'big');out=''
   while number:number,rem=divmod(number,58);out=alphabet[rem]+out
   return out
  p={'network':'regtest','xpubs':[testnet_root(k['public_root']) for k in keys],'fee_rate':2,'max_fee_rate':100,'service_fee':100,'min_withdrawal':10000,'min_deposit':1000,'dust':1000,'batch_seconds':300,'batch_size':2,'max_inputs':64}
  token=call('btcbridge','btcbridge','init',policy_json=json.dumps(p),treasury='liquidity');done('bridge')
 if not progress.get('deposit-fees'):
  call('btcbridge','btcbridge','setDepFees',fee_bps=10,publisher_bps=5000);done('deposit-fees')
 relay_headers()
 if not progress.get('deposits'):
  for owner,amount in [('alice',1),('bob',1),('carol',1),('liquidity',10)]:
   address=call(owner,'btcbridge','newAddress');txid=rpc('sendtoaddress',address['address'],amount,wallet='faucet');(STATE/f'deposit-{owner}.json').write_text(json.dumps({'txid':txid,'amount':amount,'address':address['address']}))
  mine(7);relay_headers()
  for owner in ('alice','bob','carol','liquidity'):prove_deposit(json.loads((STATE/f'deposit-{owner}.json').read_text())['txid'])
  done('deposits')
 # Native user funds are immediately spendable for familiar wallet behavior.
 for owner in ('alice','bob','carol','liquidity'):call(owner,'tokens','setUserConf',index=0,enabled=True)
 publish()
 (STATE/'ready.json').write_text(json.dumps({'network':'regtest','url':ORIGIN,'token':snapshot()['config']['token']},indent=2));start()
def setup():
 import fcntl
 STATE.mkdir(parents=True,exist_ok=True)
 with (STATE/'setup.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  return _setup()
def publish():
 # Deployment-only settings; the UI is identical on Bitcoin and isolated test chains.
 public=STATE/'ui-public'
 shutil.copytree(ROOT/'packages/user/BtcBridge/ui/dist',public,dirs_exist_ok=True)
 (public/'config.json').write_text(json.dumps({'bitcoin_api':os.environ.get('BTCBRIDGE_BITCOIN_API',f'http://127.0.0.1:{WEB_PORT}/bitcoin')}))
 policy=f"default-src 'self';script-src 'self';style-src 'self';img-src 'self' data: http://profiles.psibase.localhost:{NODE_PORT};connect-src 'self' http://127.0.0.1:{WEB_PORT} http://profiles.psibase.localhost:{NODE_PORT} http://auth-sig.psibase.localhost:{NODE_PORT} https:;frame-src http://supervisor.psibase.localhost:{NODE_PORT};frame-ancestors 'self';base-uri 'none';form-action 'self';object-src 'none'"
 # Bind the HTML cache identity to its deployment policy, including the local Bitcoin API.
 index=public/'index.html'
 index.write_text(index.read_text().replace('<head>','<head><meta name="btcbridge-deployment" content="'+hashlib.sha256(policy.encode()).hexdigest()[:16]+'">',1))
 call('btcbridge','sites','setCsp',path='*',csp=policy)
 invoke([CLI,'upload','-a',API,'-S','btcbridge',*signing_flags(['btcbridge']),'-r',public,'/'],stdout=subprocess.DEVNULL)
def start():
 start_base()
 if 'faucet' not in rpc('listwallets'):rpc('loadwallet','faucet')
 start_signers()
 if os.environ.get('BTCBRIDGE_AUTO_RELAY','1')=='1':proc('relayer',[sys.executable,Path(__file__).parent/'relayer.py','--state',STATE])
 proc('gateway',[sys.executable,Path(__file__).parent/'server.py','--state',STATE])
 wait(lambda:urllib.request.urlopen(f'http://127.0.0.1:{WEB_PORT}/api/health',timeout=2))
 print(ORIGIN+'/')
def stop():
 for name in ('relayer','gateway','signer-0','signer-1','signer-2','node','bitcoin'):
  file=STATE/(name+'.pid')
  if not file.exists():continue
  pid=int(file.read_text());command=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout.strip()
  if command:
   if not matches_process(name,pid,command):raise RuntimeError('Refusing stale process ID')
   os.kill(pid,signal.SIGTERM)
  file.unlink(missing_ok=True)
 for child in _CHILDREN.values():
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:pass
 _CHILDREN.clear()
 print('Stopped this bridge environment')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('operation',choices=['build','setup','start','stop','status','publish','relay','mine']);args=parser.parse_args()
 if args.operation=='build':build()
 elif args.operation=='setup':setup()
 elif args.operation=='start':start()
 elif args.operation=='stop':stop()
 elif args.operation=='publish':publish()
 elif args.operation=='relay':drive()
 elif args.operation=='mine':mine(7);drive()
 else:print(json.dumps({'bitcoin_height':rpc('getblockcount'),'bridge':snapshot()['config'],'url':ORIGIN},indent=2))
if __name__=='__main__':main()
