#!/usr/bin/env python3
"""Reproduce the Ethereum BLS feasibility test; never starts or changes a chain."""
from pathlib import Path
import argparse, hashlib, json, os, platform, re, shutil, statistics, subprocess
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args],cwd=ROOT,text=True,check=True,**kwargs)
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--psitest',type=Path,default=ROOT/'build/psitest')
    p.add_argument('--wasi-sdk',type=Path,default=Path('/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk'))
    p.add_argument('--repeats',type=int,default=3,choices=range(1,11))
    args=p.parse_args()
    env=os.environ.copy()
    env.update(CC_wasm32_wasip1=str(args.wasi_sdk/'bin/clang'),AR_wasm32_wasip1=str(args.wasi_sdk/'bin/llvm-ar'))
    manifest=HERE/'Cargo.toml'
    host=re.search(r'^host: (.+)$',run(['rustc','-vV'],capture_output=True).stdout,re.M)[1]
    run(['cargo','run','--locked','--manifest-path',manifest,'--target',host,'--release','--','--generate'])
    fixture_hash=hashlib.sha256((HERE/'fixture.bin').read_bytes()).hexdigest()
    # Rebuild with the just-generated embedded public fixture.
    run(['cargo','build','--locked','--manifest-path',manifest,'--target',host,'--release'])
    run(['cargo','build','--locked','--manifest-path',manifest,'--target','wasm32-wasip1','--release'],env=env)
    wasm=HERE/'target/wasm32-wasip1/release/eth-relay-bench.wasm'
    lowered=HERE/'target/eth-relay-bench-mvp.wasm'
    run(['wasm-opt',wasm,'--enable-bulk-memory','--enable-sign-ext','--enable-nontrapping-float-to-int','--enable-reference-types','--llvm-memory-copy-fill-lowering','--signext-lowering','--strip-producers','-o',lowered])
    engines={'native':[HERE/f'target/{host}/release/eth-relay-bench'],'psitest':[args.psitest,lowered]}
    if shutil.which('wasmtime'): engines['wasmtime_comparison_only']=['wasmtime',lowered]
    output={'machine':platform.platform(),'host':host,'rustc':run(['rustc','--version'],capture_output=True).stdout.strip(),
        'psitest':str(args.psitest.resolve()),'psitest_sha256':hashlib.sha256(args.psitest.read_bytes()).hexdigest(),
        'blst':'0.3.17','wasm_bytes':lowered.stat().st_size,'public_fixture_sha256':fixture_hash,
        'default_block_cpu_us':196000,'default_linear_memory_bytes':32*1024*1024,
        'two_serialized_sync_committees_bytes':2*(512*48+48),'runs':{}}
    out=HERE/'results';out.mkdir(exist_ok=True)
    for name,command in engines.items():
        print('Measuring',name,flush=True)
        try:
            result=run([*command,f'--repeats={args.repeats}'],capture_output=True)
        except subprocess.CalledProcessError as error:
            if name != 'wasmtime_comparison_only': raise
            output['runs'][name]={'available':False,'error':error.stderr,'output':error.stdout}
            (out/f'{name}.log').write_text(error.stdout+error.stderr)
            print('Optional Wasmtime comparison unavailable:', error.stderr.strip(),flush=True)
            continue
        (out/f'{name}.log').write_text(result.stdout)
        rows=[json.loads(line.removeprefix('ETH_BLS_BENCH ')) for line in result.stdout.splitlines() if line.startswith('ETH_BLS_BENCH ')]
        checks=[json.loads(line.removeprefix('ETH_BLS_CHECKS ')) for line in result.stdout.splitlines() if line.startswith('ETH_BLS_CHECKS ')]
        assert checks and all(checks[0].values()) and len(rows)==6*args.repeats
        groups={}
        for row in rows:
            key=row['scenario']+':'+str(row['participants'])+':'+str(row.get('individual_subgroup_checks','na'))
            groups.setdefault(key,[]).append(row['cpu_us'])
        output['runs'][name]={'checks':checks[0],'measurements':rows,'median_cpu_us':{k:statistics.median(v) for k,v in groups.items()}}
        print(json.dumps(output['runs'][name]['median_cpu_us'],indent=2),flush=True)
        (out/'feasibility.json').write_text(json.dumps(output,indent=2)+'\n')
    best=min(row['cpu_us'] for row in output['runs']['psitest']['measurements'] if row['scenario']=='preaggregated_signature_only')
    output['current_runtime_signature_lower_bound_fits_default_block']=best<=output['default_block_cpu_us']
    (out/'feasibility.json').write_text(json.dumps(output,indent=2)+'\n')
    print('Resource report:',out/'feasibility.json')
if __name__=='__main__':main()
