#!/usr/bin/env python3
"""#2290 stage 2(c): a signet relay refuses headers without a valid block-signature proof."""
from common import *
import time,signal
pid=STATE/'relayer.pid'
if pid.exists():
    try: os.kill(int(pid.read_text()),signal.SIGTERM); print('stopped auto relayer')
    except ProcessLookupError: pass
    pid.unlink()
def relay(): return snapshot()['relay']
start=time.time()
while rpc('getblockcount')<=relay()['height']:
    if time.time()-start>3600: raise SystemExit('no new signet block in an hour')
    time.sleep(20)
h=relay()['height']+1; block=rpc('getblockhash',h); good=signet_block(block)
print('block',h,block,'txs',len(rpc('getblock',block,1)['tx']),'branch',len(good['branch']),'coinbase bytes',len(good['coinbase'])//2)
def expect_refused(name,fn):
    before=relay()['height']
    try: fn(); outcome='ACCEPTED (wrong)'
    except ValueError as e: outcome='refused: '+str(e).strip().splitlines()[-1][:160]
    after=relay()['height']
    print(f'{name}: {outcome}; relay height {before} -> {after}', 'OK' if after==before and outcome.startswith('refused') else 'FAIL')
expect_refused('1 plain headers action on a signet relay',lambda:call(RELAYER,'btcrelay','headers',headers=[good['header']]))
cb=good['coinbase']; at=cb.find('ecc7daa2'); assert at>0,'no signet commitment found'
i=at+8+20; bad=cb[:i]+('0' if cb[i]!='0' else '1')+cb[i+1:]
expect_refused('2 block signature altered (one hex digit of the signet solution)',lambda:call(RELAYER,'btcrelay','signetHeaders',blocks=[dict(good,coinbase=bad)]))
if good['branch']:
    s=good['branch'][0]; wrong=[('0' if s[0]!='0' else '1')+s[1:]]+good['branch'][1:]
else:
    wrong=['00'*32]
expect_refused('3 coinbase Merkle branch altered',lambda:call(RELAYER,'btcrelay','signetHeaders',blocks=[dict(good,branch=wrong)]))
prev=signet_block(rpc('getblockhash',h-1))
expect_refused('4 another block\'s coinbase with this header',lambda:call(RELAYER,'btcrelay','signetHeaders',blocks=[dict(good,coinbase=prev['coinbase'],branch=prev['branch'])]))
t=time.time(); call(RELAYER,'btcrelay','signetHeaders',blocks=[good]); dt=time.time()-t
r=relay(); print(f'valid block: relay height {r["height"]} tip {r["tip"]}', 'OK' if r['height']==h and r['tip']==block else 'FAIL', f'({dt:.2f}s round trip)')
