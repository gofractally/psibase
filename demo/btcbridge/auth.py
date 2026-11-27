"""Local operator provisioning. Never imported by the browser gateway."""
from common import *
import stat
USERS=['alice','bob','carol','liquidity']
PROVIDERS=['sigone','sigtwo','sigtri']
def keypair(account):
 directory=STATE/'account-keys';directory.mkdir(mode=0o700,parents=True,exist_ok=True);directory.chmod(0o700)
 private=directory/(account+'.pem');public=directory/(account+'.pub.pem')
 if not private.exists():
  fd=os.open(private,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'wb') as output:subprocess.run(['openssl','genpkey','-algorithm','EC','-pkeyopt','ec_paramgen_curve:prime256v1'],stdout=output,stderr=subprocess.PIPE,check=True)
 if not private.is_file() or private.is_symlink() or stat.S_IMODE(private.stat().st_mode)&0o077:raise ValueError('Account key must be a private regular file')
 subprocess.run(['openssl','pkey','-in',str(private),'-pubout','-out',str(public)],stderr=subprocess.PIPE,check=True)
 return private,public
def query(service,query):
 req=urllib.request.Request(f'http://127.0.0.1:{NODE_PORT}/graphql',query.encode(),{'Host':f'{service}.psibase.localhost:{NODE_PORT}','Content-Type':'application/graphql'})
 with urllib.request.urlopen(req,timeout=10) as reply:result=json.load(reply)
 if result.get('errors'):raise ValueError(result['errors'])
 return result['data']
def secure_account(account):
 private,public=keypair(account)
 info=query('accounts','{getAccount(accountName:'+json.dumps(account)+'){authService}}')['getAccount']
 if info and info['authService']=='auth-sig':
  actual=query('auth-sig','{account(name:'+json.dumps(account)+'){active{key}}}')['account']['active']['key']
  # Native query uses a PEM public key. Refuse to replace an existing, different owner.
  if actual.strip()!=public.read_text().strip():raise ValueError('Account already has a different signing key: '+account)
  return
 if info and info['authService']!='auth-any':raise ValueError('Refusing to change existing account authority: '+account)
 if not info:
  # The key is written as its DER SubjectPublicKeyInfo in hex.
  der=subprocess.check_output(['openssl','pkey','-pubin','-in',str(public),'-outform','DER']).hex()
  # Names shorter than eight characters require Accounts' explicit preapproval.
  # Create directly under AuthSig in the same signed transaction; never expose
  # an intermediate AuthAny account.
  push([action('accounts','accounts','preapproveAcc',{'name':account}),action('accounts','auth-sig','newAccount',{'name':account,'owner':{'key':der,'seq':0},'active':{'key':der,'seq':0}})])
 else:
  subprocess.run([str(CLI),'modify','-a',API,'-k',str(public),*signing_flags([account]),account],check=True,stdout=subprocess.DEVNULL)
def provision():
 for account in USERS+PROVIDERS+['psibase']:secure_account(account)
 (STATE/'authenticated.json').write_text(json.dumps({'auth_service':'auth-sig','accounts':USERS+PROVIDERS+['psibase']}))
if __name__=='__main__':provision()
