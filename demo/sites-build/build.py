#!/usr/bin/env python3
"""Build Sites with current policy headers; verify released table compatibility."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import zipfile

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SDK = Path('/Users/dlarimer/psibase/build/psidk')
REL = ROOT / 'demo/upstream/psidk-ubuntu-2404/share/wasi-sysroot'
CLANG = SDK / 'bin/clang++'
SOURCE = ROOT / 'packages/user/Sites/src/Sites.cpp'
RPC = ROOT / 'libraries/psibase/common/src/Rpc.cpp'
HEADERS = ROOT / 'libraries/psibase/common/src/HttpHeaders.cpp'
includes = [ROOT / 'packages/user/Sites/include']
includes += [p for p in sorted((ROOT / 'packages').glob('**/include')) if 'target' not in p.parts]
includes += [ROOT / 'libraries/psibase/common/include', ROOT / 'libraries/psibase/wasm32-psibase',
             ROOT / 'external/psio/cpp/include', REL / 'include', REL / 'include/wasm32-psibase']
flags = ['--target=wasm32-wasip1', '-std=c++23', '-O2', '-fno-exceptions',
         '-DCOMPILING_SERVICE', '-DCOMPILING_WASM', '-DPSIO_EXCEPTIONS_ENABLED=0', '-DPSIO_HAVE_SIMDJSON=0', '-mthread-model', 'single',
         '-msign-ext', '-mnontrapping-fptoint', '-msimd128', '-mbulk-memory']
for include in includes:
    flags += ['-I', str(include)]
lib = REL / 'lib'
archive = OUT / 'libpsibase-current-http.a'
shutil.copy2(lib / 'libpsibase.a', archive)
subprocess.run([str(SDK / 'bin/llvm-ar'), 'd', str(archive), 'Rpc.cpp.obj', 'HttpHeaders.cpp.obj'], check=True)
builtins = next((SDK / 'lib/clang').glob('*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'))
service = ['-Wl,--stack-first', '-Wl,--entry,start', '-Wl,--export=called',
           '-Wl,-z,stack-size=8192', '-Wl,--no-merge-data-segments', '-nostdlib',
           '-Wl,--strip-all', '-lpsibase-service-base', str(archive),
           '-lcrypto', '-lz', '-lc++', '-lc++abi-replacements', '-lc-simple-malloc', '-lc',
           '-lpsibase-service-wasi-polyfill', str(builtins)]
cmd = [str(CLANG), *flags, str(SOURCE), str(RPC), str(HEADERS), '-L', str(lib), *service, '-o', str(OUT / 'Sites.wasm')]
(OUT / 'compile-command.json').write_text(json.dumps(cmd, indent=2) + '\n')
subprocess.run(cmd, check=True)
test_flags = [flag for flag in flags if flag != '-DCOMPILING_SERVICE']
schema = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
          str(SOURCE), str(RPC), str(HEADERS), '-L', str(lib), '-Wl,--entry,_start', '-nostdlib', '-Wl,--strip-all',
          str(archive), '-lcrypto', '-lz', '-lc++', '-lc++abi', '-lc', '-lpsitestlib',
          '-lSpki', '-lPrivateKeyInfo', str(builtins),
          str(SDK / 'share/wasi-sysroot/lib/wasm32-wasip1/crt1.o'), '-o', str(OUT / 'Sites-schema-gen.wasm')]
subprocess.run(schema, check=True)
with (OUT / 'Sites-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'Sites-schema-gen.wasm'), '--schema'], stdout=output, check=True)
current = json.loads((OUT / 'Sites-schema.json').read_text())
with zipfile.ZipFile(ROOT / 'demo/upstream/psidk-ubuntu-2404/share/psibase/packages/Sites.psi') as package:
    metadata = json.loads(package.read('service/sites.json'))
    released = metadata['schema']
    (OUT / 'Sites-release-backup.wasm').write_bytes(package.read('service/sites.wasm'))
    (OUT / 'Sites-release-backup-schema.json').write_text(json.dumps(released))
def expanded(value, schema):
    if isinstance(value, str) and value in schema['types']:
        return expanded(schema['types'][value], schema)
    if isinstance(value, dict):
        return {key: expanded(child, schema) for key, child in value.items()}
    if isinstance(value, list):
        return [expanded(child, schema) for child in value]
    return value
assert expanded(current['database'], current) == expanded(released['database'], released), 'Sites table layout changed'
files = [SOURCE, ROOT / 'packages/user/Sites/include/services/user/Sites.hpp', RPC, HEADERS, OUT / 'Sites.wasm', OUT / 'Sites-schema.json']
(OUT / 'provenance.json').write_text(json.dumps({
    'released_table_layout_compatible': True, 'released_flags': metadata['flags'],
    'compiler': str(CLANG), 'wasi_libraries': str(REL),
    'sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
}, indent=2) + '\n')
print('Sites service/schema built; all four released database table layouts match')
