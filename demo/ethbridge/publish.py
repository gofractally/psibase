"""Install the native browser stack only on this isolated ETH devnet."""
from common import *
import shutil,hashlib
B=ROOT/'build-native-wallet';PLATFORM=B/'platform/wasm32-wasip1/release';USER=B/'user/wasm32-wasip1/release';COMPAT=B/'compat/wasm32-wasip1/release'
def upload(account,source,destination,recursive=False):
 args=[CLI,'upload','-a',API,'-S',account,*signing_flags([account])]
 if recursive:args.append('-r')
 args += [Path(source),destination];subprocess.run([str(a) for a in args],check=True,stdout=subprocess.DEVNULL)
def publish():
 for folder,account,stem in [('common-api-build','common-api','CommonApi'),('http-server-build','http','HttpServer'),('sites-build','sites','Sites')]:
  subprocess.run([CLI,'deploy','-a',API,*signing_flags([account]),account,ROOT/f'demo/{folder}/{stem}.wasm',ROOT/f'demo/{folder}/{stem}-schema.json'],check=True)
 components={**{f'host_{name}':('host',f'/{name}.wasm') for name in ['client','db','http','types','prompt','crypto','auth','accounts']},'login_prompt':('host','/login-prompt.wasm'),'auth_any':('auth-any','/plugin.wasm'),'auth_sig':('auth-sig','/plugin.wasm'),'accounts':('accounts','/plugin.wasm'),'accounts_query':('accounts','/query.wasm'),'permissions':('perms','/plugin.wasm'),'transact':('transact','/plugin.wasm'),'transact_admin':('transact','/admin.wasm'),'web_crypto':('webcrypto','/plugin.wasm'),'invite':('invite','/plugin.wasm'),**{n:(n,'/plugin.wasm') for n in ['clientdata','aes','kdf','base64']}}
 for stem,(account,path) in components.items():upload(account,PLATFORM/(stem+'.wasm'),path)
 upload('tokens',USER/'tokens_plugin.wasm','/plugin.wasm')
 for stem,account in [('credentials_plugin','credential'),('name_market_plugin','namemarket')]:upload(account,COMPAT/(stem+'.wasm'),'/plugin.wasm')
 aliases={n:n for n in ['host','accounts','auth-any','auth-sig','transact','clientdata','aes','kdf','base64','webcrypto','tokens','invite','ethbridge']};aliases.update({'permissions':'perms','web-crypto':'webcrypto','name-market':'namemarket','credentials':'credential','virtual-server':'vserver'})
 deps=[{'name':n,'service':s} for n,s in sorted(aliases.items())]
 push([action(a,'dyn-ld','link',{'group':'EthNativeWallet','deps':deps}) for a in sorted(set(aliases.values()))])
 upload('common-api',ROOT/'packages/user/CommonApi/common/packages/common-lib/dist/common-lib.js','/common/common-lib.js');upload('common-api',B/'parser/wasm32-wasip1/release/component_parser.wasm','/common/component_parser.wasm')
 for account,part in [('supervisor','Supervisor'),('host','Host/LoginPrompt'),('perms','Permissions')]:
  dist=ROOT/f'packages/user/{part}/ui/dist';upload(account,dist,'/',True)
  if account=='host':
   for p in ['/import','/plugin/web/prompt/connect','/plugin/web/prompt/import','/plugin/web/prompt/create']:upload(account,dist/'index.html',p)
 dist=ROOT/'packages/user/Tokens/ui/dist';upload('tokens',dist,'/',True);upload('tokens',dist/'plugin/web/prompt/transfer/index.html','/plugin/web/prompt/transfer')
 siblings=f'http://psibase.localhost:{NODE_PORT} http://*.psibase.localhost:{NODE_PORT}'
 supervisor=f"default-src 'self';script-src 'self' 'wasm-unsafe-eval' blob:;style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self' blob: {siblings};frame-src {siblings};frame-ancestors {siblings};base-uri 'none';form-action 'self';object-src 'none'"
 app=f"default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';frame-src {siblings};frame-ancestors {siblings};base-uri 'none';form-action 'self';object-src 'none'"
 push([action(a,'sites','setCsp',{'path':'*','csp':p}) for a,p in [('supervisor',supervisor),('host',app),('perms',app)]])
 for p in ['/plugin/web/prompt/transfer','/plugin/web/prompt/transfer/index.html']:call('tokens','sites','setCsp',path=p,csp=app)
 publish_ui()
 print('Published ETH bridge and native proof-capable wallet to',ORIGIN)

def publish_ui():
 siblings=f'http://psibase.localhost:{NODE_PORT} http://*.psibase.localhost:{NODE_PORT}'
 public=STATE/'ui-public';shutil.copytree(ROOT/'packages/user/EthBridge/ui',public,dirs_exist_ok=True)
 (public/'config.json').write_text(json.dumps({'testnet':True,'ethereum_rpc':f'http://127.0.0.1:{WEB_PORT}/rpc','proof_api':f'http://127.0.0.1:{WEB_PORT}','description':'Local EVM with synthetic test beacon signatures; disposable test ETH only'}))
 policy=f"default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;connect-src 'self' http://127.0.0.1:{WEB_PORT};frame-src {siblings};frame-ancestors 'self';base-uri 'none';form-action 'self';object-src 'none'"
 index=public/'index.html';index.write_text(index.read_text().replace('<title>','<meta name="ethbridge-deployment" content="'+hashlib.sha256(policy.encode()).hexdigest()[:16]+'"><title>',1));call('ethbridge','sites','setCsp',path='*',csp=policy);upload('ethbridge',public,'/',True)
