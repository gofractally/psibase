#!/usr/bin/env python3
"""Actual-chain adversarial tests against disposable Bitcoin Core and Psibase nodes."""
import os
from pathlib import Path
HERE=Path(__file__).resolve().parent
os.environ.setdefault('BTCBRIDGE_AUTO_RELAY','0')
os.environ.setdefault('BTCBRIDGE_STATE',str(HERE/'test-state'))
os.environ.setdefault('BTCBRIDGE_NODE_PORT','8191')
os.environ.setdefault('BTCBRIDGE_WEB_PORT','8192')
os.environ.setdefault('BTCBRIDGE_RPC_PORT','18463')
os.environ.setdefault('BTCBRIDGE_P2P_PORT','18464')
import unittest,time,subprocess,signal,json,urllib.request,urllib.error,struct
from common import *
import run as control
class BridgeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if (STATE/'ready.json').exists():raise RuntimeError('Use a fresh test-state directory; tests intentionally freeze the relay at the end')
  try:control.setup()
  except Exception:
   control.stop();raise
 @classmethod
 def tearDownClass(cls):control.stop()
 def unchanged_failure(self,fn):
  before=snapshot()['config']
  with self.assertRaises(ValueError):fn()
  self.assertEqual(before,snapshot()['config'])
 def withdraw(self,owner='alice',amount=100000,max_fee=10000,kind=None):
  state=snapshot(owner);locked=amount+max_fee+state['policy']['service_fee'];actions=[]
  claim=max(0,min(state['wallet']['incoming'],locked-state['wallet']['balance']))
  if claim:actions.append(action(owner,'tokens','debit',dict(token_id=state['config']['token'],creditor='btcbridge',amount={'value':claim},memo='Test claim')))
  actions.append(action(owner,'tokens','credit',dict(token_id=state['config']['token'],debitor='btcbridge',amount={'value':locked},memo='Test authorization')))
  destination=rpc('getnewaddress','',kind,wallet='faucet') if kind else rpc('getnewaddress',wallet='faucet')
  actions.append(action(owner,'btcbridge','withdraw',dict(address=destination,amount=amount,max_fee=max_fee)))
  return push(actions)[-1],destination
 def test_00_native_accounts_require_real_signatures(self):
  import auth
  for account in ['alice','bob','carol','liquidity','sigone','sigtwo','sigtri','psibase']:
   self.assertEqual(auth.query('accounts','{getAccount(accountName:'+json.dumps(account)+'){authService}}')['getAccount']['authService'],'auth-sig')
  with self.assertRaisesRegex(ValueError,'Authorization'):
   push([action('alice','btcbridge','newAddress',{})],signed=False)
  alice=STATE/'account-keys/alice.pem';bob=STATE/'account-keys/bob.pem'
  result=subprocess.run([str(CLI),'push','-a',API,'--sign',str(bob),'-'],input=json.dumps([action('alice','btcbridge','newAddress',{})]),text=True,capture_output=True)
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Authorization',result.stderr)
 def test_01_generic_key_ownership_and_prehash_signing(self):
  self.unchanged_failure(lambda:call('alice','signhash','requestHash',key=1,path=[0,0],hash='ab'*32))
  key=call('alice','signhash','newKey',provider='sigone')
  control.wait(lambda: self.assertTrue(call('alice','signhash','getKey',key=key)['public_root']) or True)
  self.unchanged_failure(lambda:call('bob','signhash','requestHash',key=key,path=[],hash='ab'*32))
  request=call('alice','signhash','requestHash',key=key,path=[0,7],hash=hashlib.sha256(b'Generic application attestation, not a Bitcoin transaction').hexdigest())
  control.wait(lambda:self.assertTrue(call('alice','signhash','getRequest',request=request)['signature']) or True)
  response=call('alice','signhash','getRequest',request=request)
  self.assertEqual(len(response['signature']),128)
  with self.assertRaises(ValueError):call('alice','signhash','publishSig',request=request,signature='00'*64)
 def test_02_deposit_depth_tampering_and_replay(self):
  address=call('bob','btcbridge','newAddress');txid=rpc('sendtoaddress',address['address'],0.02,wallet='faucet');mine(1);relay_headers();p=proof(txid)
  tx=rpc('decoderawtransaction',p['raw']);vout=next(v['n'] for v in tx['vout'] if v['scriptPubKey'].get('address')==address['address'])
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**p,vout=vout))
  mine(6);relay_headers()
  forged=dict(p);forged['siblings']=['00'*32 for _ in p['siblings']]
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**forged,vout=vout))
  forged=dict(p);forged['position']=2**31
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**forged,vout=vout))
  before=snapshot('bob');publisher_before=snapshot('alice');treasury_before=snapshot('liquidity');call('alice','btcbridge','deposit',**p,vout=vout);after=snapshot('bob')
  self.assertEqual(after['config']['reserve']-before['config']['reserve'],2000000)
  self.assertEqual(after['wallet']['balance']+after['wallet']['incoming']-before['wallet']['balance']-before['wallet']['incoming'],1998000)
  balance=lambda state:state['wallet']['balance']+state['wallet']['incoming']
  self.assertEqual(balance(snapshot('alice'))-balance(publisher_before),1000)
  self.assertEqual(balance(snapshot('liquidity'))-balance(treasury_before),1000)
  receipt=http('/explorer/deposit?outpoint='+txid+'-'+format(vout,'08x'))
  self.assertEqual((receipt['owner'],receipt['publisher'],receipt['fee'],receipt['bounty']),('bob','alice',2000,1000))
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**p,vout=vout))
 def test_03_wrong_difficulty_rejected_even_with_valid_pow(self):
  tip=rpc('getblockheader',rpc('getbestblockhash'),False);raw=bytearray.fromhex(tip);raw[4:36]=bytes.fromhex(rpc('getbestblockhash'))[::-1]
  raw[68:72]=struct.pack('<I',int(time.time())+1);raw[72:76]=struct.pack('<I',0x207ffffe)
  target=0x7ffffe << (8*(0x20-3))
  for nonce in range(10000):
   raw[76:80]=struct.pack('<I',nonce)
   if int.from_bytes(sha256d(raw),'little')<=target:break
  before=snapshot()['relay']
  with self.assertRaises(ValueError):call('alice','btcrelay','headers',headers=[raw.hex()])
  self.assertEqual(before,snapshot()['relay'])
 def test_04_cancellation_owner_and_no_early_batch(self):
  request,_=self.withdraw()
  self.unchanged_failure(lambda:call('bob','btcbridge','cancel',request=request))
  self.unchanged_failure(lambda:call('alice','btcbridge','makeBatch'))
  call('alice','btcbridge','cancel',request=request)
  row=next(r for r in snapshot()['requests'] if r['id']==request);self.assertEqual(row['status'],3)
 def test_05_two_of_three_blind_signers_pay_once(self):
  # Make the third provider unavailable. Bitcoin must still accept the other two signatures.
  pidfile=STATE/'signer-2.pid';os.kill(int(pidfile.read_text()),signal.SIGTERM);pidfile.unlink()
  first,destination=self.withdraw('alice');second,_=self.withdraw('bob');before=snapshot()['config'];batch=call('alice','btcbridge','makeBatch')
  self.unchanged_failure(lambda:call('alice','btcbridge','cancel',request=first))
  state=snapshot();revision=next(r for r in state['revisions'] if r['batch']==batch);plan=json.loads(revision['plan'])
  # Bitcoin Core independently decodes the exact transaction generated on Psibase.
  self.assertEqual(rpc('decoderawtransaction',plan['unsigned'])['txid'],plan['txid'])
  self.assertEqual(sum(i['value'] for i in plan['inputs']),sum(p['amount'] for p in plan['payments'])+plan['change']+plan['fee'])
  def signed():
   drive();s=snapshot();r=next(r for r in s['revisions'] if r['batch']==batch)
   if not r['raw']:raise ValueError('Awaiting generic signatures and BTC assembly')
   return r
  signed_revision=control.wait(signed,60)
  check=rpc('testmempoolaccept',[signed_revision['raw']])[0]
  if not check['allowed']:self.assertIn(check.get('reject-reason'),('txn-already-in-mempool','txn-already-known'))
  try:rpc('sendrawtransaction',signed_revision['raw'])
  except ValueError as e:self.assertIn('already',str(e))
  mine(1);relay_headers();self.unchanged_failure(lambda:call('alice','btcbridge','complete',**proof(plan['txid'])))
  mine(6);relay_headers();call('carol','btcbridge','complete',**proof(plan['txid']));after=snapshot()
  paid=sum(p['amount'] for p in plan['payments'])+plan['fee']
  self.assertEqual(before['reserve']-after['config']['reserve'],paid);self.assertEqual(after['config']['reserve'],after['config']['liability'])
  self.assertEqual(after['config']['escrow'],0)
  rows=[r for s in (after,snapshot('bob')) for r in s['requests'] if r['id'] in (first,second)];rows=list({r['id']:r for r in rows}.values());self.assertEqual(len(rows),2);self.assertTrue(all(r['status']==2 for r in rows))
  self.assertEqual(sum(r['paid_fee'] for r in rows),plan['fee'])
  self.unchanged_failure(lambda:call('alice','btcbridge','complete',**proof(plan['txid'])))
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**proof(plan['txid']),vout=len(plan['payments'])))
  for i in plan['inputs']:
   original=json.loads((STATE/('deposit-'+('alice' if i['index']==0 else 'bob')+'.json')).read_text()) if i['index']<2 else None
   if original:
    self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**proof(original['txid']),vout=i['vout']))
 def test_04b_impossible_fee_cap_cannot_block_queue(self):
  # An allowance below the least share a request could ever be charged is refused outright.
  self.unchanged_failure(lambda:self.withdraw('alice',max_fee=1))
  # 221 sat is that least share (two P2WPKH requests, one input, 2 sat/vB). Batched with a
  # taproot payment the share is 233: admitted, then set aside when the batch is made.
  low,_=self.withdraw('alice',max_fee=221);other,_=self.withdraw('bob',kind='bech32m')
  self.assertEqual(call('alice','btcbridge','makeBatch'),0)
  rows={r['id']:r for r in snapshot()['requests']}
  self.assertEqual(rows[low]['status'],4);self.assertEqual(rows[other]['status'],0)
  call('alice','btcbridge','cancel',request=low);call('bob','btcbridge','cancel',request=other)
  self.assertEqual(snapshot()['config']['escrow'],0)
 def test_06_gateway_cross_origin_rejected(self):
  req=urllib.request.Request(f'http://127.0.0.1:{WEB_PORT}/api/actions',json.dumps({'account':'alice','actions':[]}).encode(),{'Origin':'https://attacker.example','Content-Type':'application/json'})
  with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
  self.assertEqual(error.exception.code,403);error.exception.close()
 def test_06b_removed_wallet_and_faucet_endpoints(self):
  for path in ['/api/actions','/api/test-deposit','/api/test-mine','/api/test-address','/api/action','/api/deposit','/api/withdraw']:
   origin=f'http://exchange.psibase.localhost:{NODE_PORT}' if path in ('/api/action','/api/deposit','/api/withdraw') else ORIGIN
   req=urllib.request.Request(f'http://127.0.0.1:{WEB_PORT}'+path,b'{}',{'Origin':origin,'Content-Type':'application/json'})
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
   self.assertEqual(error.exception.code,410)
   error.exception.close()
 def test_07_shallow_reorg_tracks_greater_work(self):
  old=rpc('getbestblockhash');rpc('invalidateblock',old);mine(2);relay_headers();state=snapshot()
  self.assertEqual(state['relay']['tip'],rpc('getbestblockhash'));self.assertFalse(state['relay']['paused'])
 def test_08_public_explorer_pagination_and_progress(self):
  def pages(path,limit=2):
   cursor=None;rows=[]
   for _ in range(100):
    result=http(path+('?limit=' if '?' not in path else '&limit=')+str(limit)+('&cursor='+cursor if cursor else ''))
    rows+=result['rows']
    if not result['next']:return rows
    self.assertNotEqual(result['next'],cursor);cursor=result['next']
   self.fail('Pagination failed to terminate')
  withdrawals=pages('/explorer/withdrawals');ids=[r['withdrawal']['id'] for r in withdrawals]
  self.assertEqual(len(set(ids)),len(ids));self.assertEqual(ids,sorted(ids,reverse=True))
  self.assertEqual(len(ids),snapshot()['config']['next_request']-1)
  deposits=pages('/explorer/deposits');self.assertGreaterEqual(len(deposits),5)
  self.assertEqual(len({d['id'] for d in deposits}),len(deposits))
  bob=pages('/explorer/deposits?owner=bob');self.assertTrue(bob);self.assertTrue(all(d['owner']=='bob' for d in bob))
  addresses=pages('/explorer/addresses');self.assertEqual(len(addresses),snapshot()['config']['next_address']);self.assertEqual(addresses[0]['index'],0)
  for address in addresses:self.assertEqual(http('/deposit-address?script='+address['script']),address)
  utxos=pages('/explorer/utxos');self.assertEqual(len({r['utxo']['id'] for r in utxos}),len(utxos))
  available=pages('/explorer/utxos?status=0');self.assertTrue(all(r['utxo']['status']==0 for r in available))
  self.assertEqual(sum(r['utxo']['value'] for r in utxos if r['utxo']['status']!=2),snapshot()['config']['reserve'])
  batches=pages('/explorer/batches?status=all')
  self.assertTrue(batches)
  detail=http('/explorer/batch?id='+str(batches[0]['batch']['id']))
  self.assertEqual((detail['required'],detail['available']),(2,3));self.assertTrue(detail['raw'])
  self.assertEqual(len(detail['providers']),3);self.assertTrue(all(len(i['signatures'])>=2 for i in detail['inputs']))
  count=len(deposits);call('carol','btcbridge','indexDeps',after='',limit=100)
  self.assertEqual(len(pages('/explorer/deposits')),count)
  for path in ['/explorer/utxos?limit=0','/explorer/utxos?limit=51','/explorer/utxos?status=9','/explorer/deposits?cursor=bad','/explorer/addresses?limit=1&limit=2','/explorer/batch?id=0']:
   with self.assertRaises(urllib.error.HTTPError) as error:http(path)
   self.assertEqual(error.exception.code,400);error.exception.close()
 def test_09_first_confirmed_publisher_wins_and_fee_changes_wait(self):
  address=call('carol','btcbridge','newAddress');txid=rpc('sendtoaddress',address['address'],0.01,wallet='faucet');mine(1);relay_headers();p=proof(txid)
  tx=rpc('decoderawtransaction',p['raw']);vout=next(v['n'] for v in tx['vout'] if v['scriptPubKey'].get('address')==address['address'])
  self.unchanged_failure(lambda:call('bob','btcbridge','deposit',**p,vout=vout))
  mine(5);relay_headers();self.unchanged_failure(lambda:call('bob','btcbridge','deposit',**p,vout=vout))
  mine(1);relay_headers();before={owner:snapshot(owner) for owner in ['alice','bob','carol','liquidity']}
  call('bob','btcbridge','deposit',**p,vout=vout)
  balance=lambda state:state['wallet']['balance']+state['wallet']['incoming']
  self.assertEqual(balance(snapshot('carol'))-balance(before['carol']),999000)
  self.assertEqual(balance(snapshot('bob'))-balance(before['bob']),500)
  self.assertEqual(balance(snapshot('liquidity'))-balance(before['liquidity']),500)
  self.assertEqual(balance(snapshot('alice')),balance(before['alice']))
  self.unchanged_failure(lambda:call('alice','btcbridge','deposit',**p,vout=vout))
  self.assertEqual(balance(snapshot('alice')),balance(before['alice']))
  self.unchanged_failure(lambda:call('alice','btcbridge','setDepFees',fee_bps=20,publisher_bps=5000))
  self.unchanged_failure(lambda:call('btcbridge','btcbridge','setDepFees',fee_bps=101,publisher_bps=5000))
  before=snapshot();call('btcbridge','btcbridge','setDepFees',fee_bps=20,publisher_bps=5000);after=snapshot()
  self.assertEqual(after['deposit_fee_terms']['fee_bps'],10)
  self.assertEqual(after['deposit_fee_policy']['pending']['fee_bps'],20)
  self.assertGreaterEqual(after['deposit_fee_policy']['activates_at'],before['now']+86400)
 def test_10_request_the_reserve_cannot_pay_waits_and_blocks_nobody(self):
  available=lambda:sum(u['value'] for u in snapshot()['utxos'] if u['status']==0)
  status=lambda owner,request:next(r['status'] for r in snapshot(owner)['requests'] if r['id']==request)
  wallet=snapshot('liquidity')['wallet'];large=wallet['balance']+wallet['incoming']-20000
  # Open batches reserve whole custody outputs, oldest first, until what is left cannot pay one large request.
  for _ in range(12):
   if available()<large:break
   self.withdraw('alice',10000);self.withdraw('bob',10000);self.assertGreater(call('carol','btcbridge','makeBatch'),0)
  self.assertLess(available(),large)
  big,_=self.withdraw('liquidity',amount=large);small,_=self.withdraw('carol',10000)
  # It heads the queue. makeBatch does not fail: the request waits for the reserve (5), in view of its owner.
  call('alice','btcbridge','makeBatch')
  self.assertEqual(status('liquidity',big),5);self.assertIn(status('carol',small),(0,1,5))
  self.unchanged_failure(lambda:call('bob','btcbridge','cancel',request=big))
  # The reserve grows: the next makeBatch puts the request back in its place and pays it.
  address=call('liquidity','btcbridge','newAddress');txid=rpc('sendtoaddress',address['address'],11,wallet='faucet');mine(7);relay_headers();prove_deposit(txid)
  self.withdraw('carol',10000)
  self.assertGreater(call('alice','btcbridge','makeBatch'),0)
  self.assertEqual(status('liquidity',big),1)
  # A waiting request can be cancelled by its owner like a queued one.
  wallet=snapshot('liquidity')['wallet'];huge,_=self.withdraw('liquidity',amount=wallet['balance']+wallet['incoming']-20000);self.withdraw('carol',10000)
  call('alice','btcbridge','makeBatch')
  if status('liquidity',huge)==5:
   escrow=snapshot()['config']['escrow'];call('liquidity','btcbridge','cancel',request=huge)
   self.assertEqual(status('liquidity',huge),3);self.assertLess(snapshot()['config']['escrow'],escrow)
 def test_99_deep_reorg_freezes_accepted_state(self):
  protected=snapshot()['relay']['protected_height'];old_height=rpc('getblockcount');rpc('invalidateblock',rpc('getblockhash',protected));mine(old_height-protected+2)
  relay_headers();self.assertTrue(snapshot()['relay']['paused'])
  self.unchanged_failure(lambda:call('alice','btcbridge','newAddress'))
if __name__=='__main__':unittest.main(verbosity=2)
