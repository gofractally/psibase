#!/usr/bin/env python3
"""Installs and initialises the bridge on a running chain that the operator controls, against an
existing signet node. Unlike run.py it boots nothing, creates no user accounts and makes no coins.

Environment, besides common.py's: BTCBRIDGE_NETWORK=signet, BTCBRIDGE_HOST, BTCBRIDGE_API,
BTCBRIDGE_SCHEME=https, BTCBRIDGE_CLI (a psibase that reaches the node), BTCBRIDGE_NODE_PORT (a
local port that answers queries for the chain's hosts), BTCBRIDGE_RPC_PORT, BTCBRIDGE_RPC_COOKIE,
BTCBRIDGE_CHECKPOINT_EPOCH, BTCBRIDGE_TREASURY (an existing account), BTCBRIDGE_RELAYER_ACCOUNT,
BTCBRIDGE_DAEMON_CLI (what the signing daemons run to push), BTCBRIDGE_PACKAGE_DIR (holds
Signing.psi and BtcBridge.psi), BTCBRIDGE_MIN_DEPOSIT and BTCBRIDGE_MIN_WITHDRAWAL (default 1000 each).
`deploy_live.py minimums` applies those two to a bridge that is already initialized (setTestMins). STATE/account-keys/psibase.pem is the key that signs for the
chain's service accounts; the treasury's key is STATE/account-keys/<treasury>.pem.
"""
import shutil,sys,time
from common import *
import auth
from run import proc,wait,invoke,PROVIDERS,start_signers
TREASURY=os.environ['BTCBRIDGE_TREASURY']
PACKAGE_DIR=Path(os.environ['BTCBRIDGE_PACKAGE_DIR'])
progress_path=STATE/'progress.json';progress=json.loads(progress_path.read_text()) if progress_path.exists() else {}
def done(stage):progress[stage]=True;progress_path.write_text(json.dumps(progress));print('done',stage,flush=True)
def main():
 assert NETWORK!='regtest'
 if not progress.get('install'):
  for package in ('Signing','BtcBridge'):
   invoke([CLI,'install','-a',API,*signing_flags(['psibase']),'-y','--reinstall',PACKAGE_DIR/(package+'.psi')]);print('installed',package,flush=True)
  done('install')
 if not progress.get('accounts'):
  for account in PROVIDERS+[RELAYER]:auth.secure_account(account)
  done('accounts')
 if not progress.get('secrets'):
  generated=subprocess.run([str(DAEMON),'generate',str(STATE/'secrets')],check=True,capture_output=True,text=True)
  (STATE/'deployment.json').write_text(json.dumps({'deployment':json.loads(generated.stdout)['deployment']}));done('secrets')
 deployment=json.loads((STATE/'deployment.json').read_text())['deployment']
 for n,provider in enumerate(PROVIDERS):
  config={'node_url':f'http://127.0.0.1:{NODE_PORT}','host':f'signhash.{HOST}','chain_url':API,'cli':os.environ.get('BTCBRIDGE_DAEMON_CLI',str(CLI)),'provider':provider,'key_path':str(STATE/f'secrets/signer-{n}.key'),'auth_key_path':str(STATE/f'account-keys/{provider}.pem'),'deployment':deployment,'journal':str(STATE/f'secrets/journal-{n}.json')}
  (STATE/f'signer-{n}.json').write_text(json.dumps(config,indent=2))
 if not progress.get('signing'):
  call('signhash','signhash','init',deployment=deployment,providers=PROVIDERS)
  call('btcbridge','btcbridge','createKeys',providers=PROVIDERS);done('signing')
 start_signers()
 def keys_ready():
  keys=[call(RELAYER,'signhash','getKey',key=n) for n in (1,2,3)]
  if not all(k['public_root'] for k in keys):raise ValueError('Awaiting public keys from the signing daemons')
  return keys
 keys=wait(keys_ready,180)
 if not progress.get('relay'):
  epoch=int(os.environ['BTCBRIDGE_CHECKPOINT_EPOCH']);assert epoch%2016==0
  context=[rpc('getblockheader',rpc('getblockhash',h),False) for h in range(epoch,epoch+12)]
  call('btcrelay','btcrelay','init',network=NETWORK,checkpoint_height=epoch+11,context=context,required=int(os.environ.get('BTCBRIDGE_REQUIRED','6')));done('relay')
 if not progress.get('bridge'):
  alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  def testnet_root(root):
   number=0
   for c in root:number=number*58+alphabet.index(c)
   payload=number.to_bytes(82,'big')[:-4];payload=bytes.fromhex('043587cf')+payload[4:];data=payload+sha256d(payload)[:4]
   number=int.from_bytes(data,'big');out=''
   while number:number,rem=divmod(number,58);out=alphabet[rem]+out
   return out
  p={'network':NETWORK,'xpubs':[testnet_root(k['public_root']) for k in keys],'fee_rate':2,'max_fee_rate':100,'service_fee':100,**TEST_MINIMUMS,'dust':1000,'batch_seconds':300,'batch_size':2,'max_inputs':64}
  token=call('btcbridge','btcbridge','init',policy_json=json.dumps(p),treasury=TREASURY);print('bridge token',token,flush=True);done('bridge')
 if not progress.get('deposit-fees'):
  call('btcbridge','btcbridge','setDepFees',fee_bps=10,publisher_bps=5000);done('deposit-fees')
 started=time.time();relay_headers();print(f'headers relayed in {time.time()-started:.0f}s; relay height',snapshot(RELAYER)['relay']['height'],flush=True)
 if not progress.get('ui'):
  public=STATE/'ui-public'
  shutil.copytree(ROOT/'packages/user/BtcBridge/ui/dist',public,dirs_exist_ok=True)
  bitcoin_api=os.environ['BTCBRIDGE_BITCOIN_API'];(public/'config.json').write_text(json.dumps({'bitcoin_api':bitcoin_api}))
  origin=bitcoin_api.split('/',3);origin=origin[0]+'//'+origin[2]
  policy=f"default-src 'self';script-src 'self';style-src 'self';img-src 'self' data: profiles.{HOST} branding.{HOST};connect-src 'self' {origin} profiles.{HOST} auth-sig.{HOST};frame-src supervisor.{HOST};frame-ancestors 'self';base-uri 'none';form-action 'self';object-src 'none'"
  invoke([CLI,'upload','-a',API,'-S','btcbridge',*signing_flags(['btcbridge']),'-r',public,'/'],stdout=subprocess.DEVNULL)
  call('btcbridge','sites','setCsp',path='*',csp=policy);done('ui')
 if os.environ.get('BTCBRIDGE_AUTO_RELAY','1')=='1':proc('relayer',[sys.executable,Path(__file__).parent/'relayer.py','--state',STATE])
 (STATE/'ready.json').write_text(json.dumps({'network':NETWORK,'url':ORIGIN,'token':snapshot(RELAYER)['config']['token']},indent=2))
 print(ORIGIN+'/')
def minimums():
 """`deploy_live.py minimums`: set the running bridge's smallest deposit and withdrawal to common.TEST_MINIMUMS."""
 before,after=set_test_minimums()
 print(json.dumps({k:{'before':before[k],'now':after[k]} for k in TEST_MINIMUMS},indent=2))
if __name__=='__main__':minimums() if sys.argv[1:]==['minimums'] else main()