"""Fund a native spot book using proven regtest BTC and explicitly simulated USD."""
from common import *
import zipfile,re

def symbol(name,token,owner):
 info=call(owner,'tokens','getToken',token_id=token)
 call('symbol','symbol','admin_create',symbol=name,recipient=owner)
 record=call(owner,'symbol','getSymbol',symbol=name);nft=record['ownerNft']
 push([action(owner,'nft','debit',{'nftId':nft,'memo':'Accept test symbol'}),action(owner,'nft','credit',{'nft_id':nft,'debitor':'symbol','memo':'Map test asset'}),action(owner,'symbol','mapSymbol',{'token_id':token,'symbol':name})])
 return info['nft_id']
def seed():
 marker=STATE/'exchange.json'
 if marker.exists():return json.loads(marker.read_text())
 btc=snapshot()['config']['token'];usd=call('liquidity','tokens','create',precision=4,max_issued_supply={'value':1_000_000_000_000})
 admin=call('liquidity','tokens','getToken',token_id=usd)['nft_id']
 call('liquidity','nft','debit',nftId=admin,memo='Accept simulated USD administration')
 call('liquidity','tokens','mint',token_id=usd,amount={'value':1_000_000_000_000},memo='Simulated USD for isolated regtest exchange')
 symbol('usd',usd,'liquidity');symbol('btc',btc,'btcbridge')
 call('liquidity','tokens','setTokenConf',token_id=usd,index=1,enabled=True)
 call('liquidity','nft','burn',nftId=admin)
 for owner in ('alice','bob','carol','liquidity'):
  balance=snapshot(owner)['wallet']['incoming']
  if balance:call(owner,'tokens','debit',token_id=btc,creditor='btcbridge',amount={'value':balance},memo='Settle proven test BTC into native wallet')
  if owner!='liquidity':call('liquidity','tokens','credit',token_id=usd,debitor=owner,amount={'value':1_000_000_000},memo='Simulated test USD')
 push([action('liquidity','tokens','credit',{'token_id':btc,'debitor':'exchange','amount':{'value':300_000_000},'memo':'Fund regtest BTC spot book'}),action('liquidity','tokens','credit',{'token_id':usd,'debitor':'exchange','amount':{'value':3_000_000_000},'memo':'Fund simulated USD spot book'})])
 market=call('liquidity','exchange','create',base=btc,quote=usd,base_amount=200_000_000,quote_amount=2_000_000_000,base_lot=10000,quote_tick=1)
 for level in range(1,5):
  push([action('liquidity','exchange','limit',{'market':market,'bid':True,'price':100000-level*500,'amount':20_000_000}),action('liquidity','exchange','limit',{'market':market,'bid':False,'price':100000+level*500,'amount':2_000_000})])
 data={'market':market,'btc':btc,'usd':usd,'btc_backing':'Bitcoin regtest deposits','usd_backing':'Simulated test currency, no dollar redemption'}
 marker.write_text(json.dumps(data,indent=2));return data

def publish():
 # Use the frozen exchange package matching this demo's deployed contract, not another chat's active UI edits.
 source=ROOT/'demo/artifacts/packages/Exchange.psi';out=STATE/'exchange-ui';out.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(source) as archive:
  for name in archive.namelist():
   prefix='data/exchange/'
   if not name.startswith(prefix) or name.endswith('/'):continue
   relative=Path(name[len(prefix):])
   if '..' in relative.parts:raise ValueError('Unsafe package asset path')
   target=out/relative;target.parent.mkdir(parents=True,exist_ok=True);data=archive.read(name)
   if str(relative)=='index.html':data=re.sub(r'(<body[^>]*>)',r'\1<div role="status" style="padding:12px 24px;background:#352b1d;color:#ffd08d;font:14px system-ui">Isolated regtest exchange · BTC is test bitcoin. USD is simulated and has no dollar redemption.</div>',data.decode(),count=1).encode()
   if str(relative)=='src/config.js':data=f"export function walletApiBase(href){{return new URL(href).origin==='http://exchange.psibase.localhost:{NODE_PORT}'?'http://127.0.0.1:{WEB_PORT}':'';}}\n".encode()
   target.write_bytes(data)
 subprocess.run([str(CLI),'upload','-a',API,'-S','exchange','-r',str(out),'/'],check=True,stdout=subprocess.DEVNULL)
 csp=f"default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self' http://127.0.0.1:{WEB_PORT};frame-src 'self';frame-ancestors 'self';base-uri 'none';form-action 'self';object-src 'none';"
 call('exchange','sites','setCsp',path='*',csp=csp)
 print(f'http://exchange.psibase.localhost:{NODE_PORT}/')
if __name__=='__main__':print(json.dumps(seed()));publish()
