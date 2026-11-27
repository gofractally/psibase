#!/usr/bin/env python3
"""#2290 stage 2(c): a header with valid proof of work and a matching coinbase proof, but no valid
block signature. Anyone can make one; only the signature check keeps it out."""
from common import *
import time,struct,multiprocessing as mp
def relay(): return snapshot()['relay']
r=relay(); tip=r['tip']; h=r['height']
tipinfo=rpc('getblockheader',tip); bits=tipinfo['bits']
assert (h+1)%2016!=0
cb=signet_block(tip)['coinbase']   # the tip's own coinbase, signature and all, reused as the forged block's only transaction
raw=bytes.fromhex(cb)
# txid of a segwit transaction: version | inputs..outputs (no marker/flag/witness) | locktime
def strip_witness(b):
    assert b[4]==0 and b[5]==1
    p=6
    def varint(p):
        v=b[p]
        if v<0xfd:return v,p+1
        if v==0xfd:return struct.unpack_from('<H',b,p+1)[0],p+3
        if v==0xfe:return struct.unpack_from('<I',b,p+1)[0],p+5
        return struct.unpack_from('<Q',b,p+1)[0],p+9
    start=p;n,p=varint(p)
    for _ in range(n):
        p+=36;l,p=varint(p);p+=l+4
    m,p=varint(p)
    for _ in range(m):
        p+=8;l,p=varint(p);p+=l
    return b[:4]+b[start:p]+b[-4:]
txid=sha256d(strip_witness(raw))
assert txid[::-1].hex()==rpc('getblock',tip,1)['tx'][0],'txid computation'
exp=int(bits[:2],16);mant=int(bits[2:],16);target=mant<<(8*(exp-3))
prefix=struct.pack('<I',0x20000000)+bytes.fromhex(tip)[::-1]+txid+struct.pack('<I',int(time.time()))+bytes.fromhex(bits)[::-1]
def grind(args):
    lo,hi=args
    for n in range(lo,hi):
        hd=prefix+struct.pack('<I',n)
        if int.from_bytes(sha256d(hd),'little')<=target:return hd.hex()
    return None
t=time.time();found=None
with mp.Pool(16) as pool:
    step=1<<20
    for res in pool.imap_unordered(grind,((a,a+step) for a in range(0,1<<32,step))):
        if res:found=res;pool.terminate();break
print(f'forged header for height {h+1} with valid proof of work found in {time.time()-t:.0f}s: {sha256d(bytes.fromhex(found))[::-1].hex()}')
try:
    call(RELAYER,'btcrelay','signetHeaders',blocks=[{'header':found,'coinbase':cb,'branch':[]}]);out='ACCEPTED (wrong)'
except ValueError as e: out='refused: '+str(e).strip().splitlines()[-1][:200]
a=relay(); print(f'5 valid proof of work and coinbase proof, no valid block signature: {out}; relay height {h} -> {a["height"]}','OK' if a['height']==h and a['tip']==tip and out.startswith('refused') else 'FAIL')
