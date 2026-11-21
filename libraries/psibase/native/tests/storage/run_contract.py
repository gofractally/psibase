#!/usr/bin/env python3
"""Qualify only the pinned native storage boundary; preserve every attempt."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import time

p=argparse.ArgumentParser()
p.add_argument('--cc',required=True)
p.add_argument('--cxx',required=True)
p.add_argument('--build-dir',default='build-storage-contract')
p.add_argument('--jobs',default='4')
p.add_argument('--tsan',action='store_true')
p.add_argument('--psitri-source',type=Path)
p.add_argument('--ucc-source',type=Path)
a=p.parse_args()
root=Path(__file__).resolve().parents[5]
build=root/a.build_dir
evidence=build/'evidence'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
evidence.mkdir(parents=True,exist_ok=False)
report={'platform':platform.platform(),'machine':platform.machine(),'commands':[],
        'complete':False,'passed':False,'source_sha256':{},'free_bytes_before':shutil.disk_usage(root).free}
report['thread_sanitizer']=a.tsan
for directory in ['cmake/dependencies','libraries/psibase/native/tests/storage']:
    for path in sorted((root/directory).rglob('*')):
        if path.is_file():report['source_sha256'][str(path.relative_to(root))]=hashlib.sha256(path.read_bytes()).hexdigest()
for relative in ['cmake/psitri.cmake','libraries/psibase/native/src/psitriStorage.cpp',
                 'libraries/psibase/native/include/psibase/storage.hpp',
                 'libraries/psibase/native/include/psibase/CpuAccounting.hpp',
                 'libraries/psibase/native/include/psibase/NativeThreadClock.hpp',
                 'libraries/psibase/native/include/psibase/DarwinCpuClock.hpp',
                 'libraries/psibase/native/include/psibase/DarwinWatchdogWake.hpp',
                 'libraries/psibase/native/include/psibase/Watchdog.hpp',
                 'libraries/psibase/native/src/Watchdog.cpp',
                 'libraries/psibase/native/include/psibase/storageDiagnostics.hpp']:
    report['source_sha256'][relative]=hashlib.sha256((root/relative).read_bytes()).hexdigest()
def save():
    (evidence/'results.json').write_text(json.dumps(report,indent=2)+'\n')
def run(name,args):
    print(name,flush=True);start=time.monotonic()
    result=subprocess.run(list(map(str,args)),cwd=root,capture_output=True,text=True,timeout=900)
    (evidence/(name+'.stdout')).write_text(result.stdout)
    (evidence/(name+'.stderr')).write_text(result.stderr)
    report['commands'].append({'name':name,'argv':list(map(str,args)),'exit_code':result.returncode,'seconds':time.monotonic()-start})
    save()
    if result.returncode:raise RuntimeError(name+' failed')
    return result
try:
    if report['free_bytes_before']<15*1024**3:raise RuntimeError('less than 15GiB free; no build started')
    run('compiler',[a.cxx,'--version'])
    sanitizer = ['-DCMAKE_C_FLAGS=-fsanitize=thread -fno-omit-frame-pointer',
                 '-DCMAKE_CXX_FLAGS=-fsanitize=thread -fno-omit-frame-pointer',
                 '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=thread'] if a.tsan else []
    overrides = []
    for name, source in [('PSITRI', a.psitri_source), ('UCC', a.ucc_source)]:
        if source is not None:
            overrides.append('-DFETCHCONTENT_SOURCE_DIR_'+name+'='+str(source.resolve()))
    run('configure',['cmake','-S','libraries/psibase/native/tests/storage','-B',build,'-G','Ninja',
                     '-DCMAKE_BUILD_TYPE=Debug','-DCMAKE_C_COMPILER='+a.cc,'-DCMAKE_CXX_COMPILER='+a.cxx,
                     *overrides,*sanitizer])
    run('build',['cmake','--build',build,'--parallel',a.jobs])
    run('tests',['ctest','--test-dir',build,'--verbose','--output-on-failure'])
    symbols=run('symbols',['nm','-C',build/'storage_contract']).stdout
    report['new_psio_symbols']='psio::' in symbols
    report['new_psio_headers']='/psio/cpp/' in (build/'compile_commands.json').read_text()
    if report['new_psio_symbols'] or report['new_psio_headers']:raise RuntimeError('new codec leaked into engine-only boundary')
    names=['storage_contract','engine_dependency_smoke','cpu_accounting_contract','serialized_contract']
    report['binary_sha256']={name:hashlib.sha256((build/name).read_bytes()).hexdigest() for name in names if (build/name).exists()}
    report['passed']=True
except Exception as error:
    report['error']=str(error)
finally:
    report['free_bytes_after']=shutil.disk_usage(root).free
    report['complete']=True
    save()
print(json.dumps({'evidence':str(evidence),'passed':report['passed'],'error':report.get('error')}),flush=True)
raise SystemExit(0 if report['passed'] else 1)
