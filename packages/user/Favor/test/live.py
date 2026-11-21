#!/usr/bin/env python3
"""Integration checks against a loopback development chain hosting Favor.
Creates only dedicated test identities and a fresh test symbol. No token funds
or exchange state are touched. Bearer tokens and routing keys are not printed.
"""
import argparse, hashlib, json, secrets, subprocess, time, urllib.request
from urllib.parse import urlsplit
from rejections import assert_rejected

parser=argparse.ArgumentParser()
parser.add_argument('--cli',required=True)
parser.add_argument('--api',default='http://psibase.localhost:8089/')
args=parser.parse_args()
url=urlsplit(args.api)
if url.hostname not in ('psibase.localhost','localhost','127.0.0.1'):
    raise SystemExit('This test creates development accounts; use a loopback development chain.')
favor=f'{url.scheme}://favor.{url.netloc}'
TOKENS={}
RESULTS=[]
USERS=['favalice','favorbob','favcarol','favorout']
INVALID='Payment unavailable; request a fresh preview'
def cli(*arguments,input=None,check=True):
    p=subprocess.run([args.cli,*arguments,'-a',args.api],input=input,text=True,capture_output=True,timeout=120)
    if check and p.returncode:raise RuntimeError(p.stderr[-1800:])
    return p

def action(sender,method,data):return {'sender':sender,'service':'favor','method':method,'data':data}
def push(actions,check=True):
    p=cli('push','--trace','json','--console=false','-',input=json.dumps(actions),check=check)
    trace=json.loads(p.stdout) if p.stdout.strip().startswith('{') else {}
    if check and trace.get('error'):raise RuntimeError(trace['error'])
    return p.returncode==0 and not trace.get('error'),trace

def snapshot():
    return {user:query(user,'{lines(first:100){nodes{peer symbol youExtend theyExtend youOwe theyOwe yourFeePpm theirFeePpm forwarding theirForwarding}} activity(first:100){nodes{id kind symbol incoming outgoing received sent memo}} requests(first:100){nodes{hash consumed revoked}} settings{requestOnly routingReady}}') for user in USERS}

def reject(name,actions,expected=INVALID):
    before=snapshot()
    success,trace=push(actions,False)
    if success:raise AssertionError(name+': transaction succeeded')
    target=actions[-1]
    assert_rejected(trace,expected,target['service'],target['method'])
    check(name+'; private state unchanged',before==snapshot())

def token(user):
    if user not in TOKENS:TOKENS[user]='Bearer '+cli('login',user).stdout.strip().split(' ',1)[1]
    return TOKENS[user]

def raw_query(user,query):
    headers={'Content-Type':'application/json'}
    if user:headers['Authorization']=token(user)
    req=urllib.request.Request(favor+'/graphql',data=json.dumps({'query':query}).encode(),headers=headers)
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)

def query(user,query):
    result=raw_query(user,query)
    if result.get('errors'):raise RuntimeError(result['errors'])
    return result['data']

def check(name,condition):
    if not condition:raise AssertionError(name)
    RESULTS.append(name);print('PASS',name,flush=True)

def query_reject(name,response,expected=INVALID):
    errors=response.get('errors') or []
    check(name,bool(errors) and all(e.get('message')==expected for e in errors))

def quote(user,payee,amount='20',request=None):
    parameters={'payee':payee,'symbol':SYMBOL,'amount':amount,'reference':secrets.token_hex(16)}
    if request:parameters['requestSecret']=request
    arguments=','.join(k+':'+json.dumps(v) for k,v in parameters.items())
    return raw_query(user,'{quote('+arguments+'){payee symbol amount total fee expiresAt reference encodedRoute}}')

def pay_action(q,user='favalice'):
    return action(user,'pay',{'payee':q['payee'],'symbol':q['symbol'],'amount':q['amount'],'max_total':q['total'],'encoded_route':q['encodedRoute'],'reference':q['reference'],'memo':'Favor integration test'})

def line(user,peer):
    rows=query(user,'{lines(first:100){nodes{peer symbol theyOwe youOwe youExtend theyExtend} hasNextPage}}')['lines']['nodes']
    return next(r for r in rows if r['peer']==peer and r['symbol']==SYMBOL)

# Name spelling is deliberately compressible by psibase's account codec.
for account in USERS:
    p=cli('create','-i','-S','accounts',account,check=False)
    if p.returncode and 'already exists' not in p.stderr:raise RuntimeError(p.stderr[-1000:])
SYMBOL='TST'+''.join(chr(65+secrets.randbelow(26)) for _ in range(5))
query_reject('unauthenticated reads denied',raw_query(None,'{lines{nodes{peer}}}'),'Sign in to view your private credit network')
query_reject('unauthenticated quotes denied',quote(None,'favcarol'),'Sign in to view your private credit network')
check('routing key configured',query('favalice','{settings{routingReady}}')['settings']['routingReady'])
push([action('favorbob','set_line',{'peer':'favalice','symbol':SYMBOL,'limit':'100','fee_ppm':10000,'forwarding':True}),
      action('favcarol','set_line',{'peer':'favorbob','symbol':SYMBOL,'limit':'100','fee_ppm':0,'forwarding':True}),
      action('favorbob','set_line',{'peer':'favcarol','symbol':SYMBOL,'limit':'0','fee_ppm':10000,'forwarding':True}),
      action('favcarol','set_receiving',{'request_only':False})])
check('outsider sees no graph',not query('favorout','{lines{nodes{peer}}}')['lines']['nodes'])
query_reject('payer cannot impersonate another payer',quote('favorout','favcarol'))
q=quote('favalice','favcarol')['data']['quote']
check('fees included in quote',q['amount']=='20' and q['fee']=='0.2' and q['total']=='20.2')
check('route has seven encrypted slots',len(json.loads(q['encodedRoute'])['layers'])==7)
check('intermediate identity hidden','favorbob' not in q['encodedRoute'])
bad=json.loads(q['encodedRoute']);bad['layers'][0]=('0' if bad['layers'][0][0]!='0' else '1')+bad['layers'][0][1:]
a=pay_action(q);a['data']['encoded_route']=json.dumps(bad,separators=(',',':'))
reject('ciphertext tampering rejected',[a])
check('tamper leaves balance unchanged',line('favalice','favorbob')['youOwe']=='0')
a=pay_action(q);a['data']['amount']='19'
reject('amount substitution rejected',[a])
a=pay_action(q,'favorout')
reject('route bound to payer',[a])
start=time.perf_counter();success,_=push([pay_action(q)]);elapsed=time.perf_counter()-start
check('actual multihop payment succeeds',success)
check('payer owes only direct neighbor',line('favalice','favorbob')['youOwe']=='20.2')
check('recipient holds direct neighbor debt',line('favcarol','favorbob')['theyOwe']=='20')
reject('payment replay rejected',[pay_action(q)],'This payment reference has already been used')
activity=query('favorbob','{activity{nodes{kind incoming outgoing memo earned}}}')['activity']['nodes'][0]
check('intermediary earns fee without remote memo',activity['kind']=='routed' and activity['earned']=='0.2' and activity['memo']=='')
q=quote('favalice','favcarol','1')['data']['quote']
push([action('favorbob','set_line',{'peer':'favalice','symbol':SYMBOL,'limit':'99','fee_ppm':10000,'forwarding':True})])
reject('stale settings invalidate route',[pay_action(q)])
push([action('favcarol','set_receiving',{'request_only':True})])
query_reject('request-only blocks random recipient probes',quote('favalice','favcarol','1'))
secret=secrets.token_hex(32);hashed=hashlib.sha256(bytes.fromhex(secret)).hexdigest()
server_time=int(query('favcarol','{settings{serverTime}}')['settings']['serverTime'])
push([action('favcarol','create_request',{'hash':hashed,'symbol':SYMBOL,'amount':'1','expires_at':server_time+3600,'payer':'favalice'})])
query_reject('wrong request amount rejected',quote('favalice','favcarol','2',secret))
q=quote('favalice','favcarol','1',secret)['data']['quote']
check('bearer secret is absent from transaction',secret not in q['encodedRoute'])
push([pay_action(q)])
query_reject('request consumed after payment',quote('favalice','favcarol','1',secret))
secret2=secrets.token_hex(32);h2=hashlib.sha256(bytes.fromhex(secret2)).hexdigest()
push([action('favcarol','create_request',{'hash':h2,'symbol':SYMBOL,'amount':'1','expires_at':server_time+3600,'payer':None})])
q=quote('favalice','favcarol','1',secret2)['data']['quote']
push([action('favcarol','revoke_request',{'hash':h2})])
reject('revocation invalidates issued quote',[pay_action(q)])
push([action('favcarol','settle',{'peer':'favorbob','symbol':SYMBOL,'amount':'5','nonce':secrets.token_hex(16)})])
check('cash repayment reduces only direct debt',line('favcarol','favorbob')['theyOwe']=='16')
reject('debtor cannot acknowledge creditor repayment',[action('favorbob','settle',{'peer':'favcarol','symbol':SYMBOL,'amount':'1','nonce':secrets.token_hex(16)})],'Repayment cannot exceed what this person owes you')
# Clear the test receiver policy so a subsequent run starts from the same policy.
push([action('favcarol','set_receiving',{'request_only':False})])
# Exercise the complete encrypted seven-slot envelope in the actual WASM VM.
chain=['favalice','favorbob','favcarol','favorout','favarlen','favorben','favorcam','favordee','favoreve']
for account in chain[4:]:
    p=cli('create','-i','-S','accounts',account,check=False)
    if p.returncode and 'already exists' not in p.stderr:raise RuntimeError(p.stderr[-1000:])
USERS=chain
push([action(chain[i],'set_line',{'peer':chain[i-1],'symbol':SYMBOL,'limit':'100','fee_ppm':0,'forwarding':True}) for i in range(1,len(chain))])
q=quote(chain[0],chain[7],'1')['data']['quote']
check('seven-hop encrypted quote succeeds',q['payee']==chain[7])
query_reject('eight-hop route is unavailable',quote(chain[0],chain[8],'1'))
check('seven-hop WASM payment succeeds',push([pay_action(q)])[0])
print(json.dumps({'passed':len(RESULTS),'symbol':SYMBOL,'payment_wall_seconds':round(elapsed,4),'checks':RESULTS},indent=2))
