#!/usr/bin/env python3
"""Build unmodified current CommonApi with the existing native WASI toolchain."""
from pathlib import Path
import hashlib
import json
import subprocess
import shutil

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SDK = Path('/Users/dlarimer/psibase/build/psidk')
REL = ROOT / 'demo/upstream/psidk-ubuntu-2404/share/wasi-sysroot'
CLANG = SDK / 'bin/clang++'
SOURCE = ROOT / 'packages/user/CommonApi/src/CommonApi.cpp'
RPC = ROOT / 'libraries/psibase/common/src/Rpc.cpp'
includes = [ROOT / 'packages/user/CommonApi/include']
includes += [p for p in sorted((ROOT / 'packages').glob('**/include')) if 'target' not in p.parts]
includes += [ROOT / 'libraries/psibase/common/include', ROOT / 'libraries/psibase/wasm32-psibase',
             ROOT / 'external/psio/cpp/include', REL / 'include', REL / 'include/wasm32-psibase']
flags = ['--target=wasm32-wasip1', '-std=c++23', '-O2', '-fno-exceptions',
         '-DCOMPILING_SERVICE', '-DCOMPILING_WASM', '-DPSIO_EXCEPTIONS_ENABLED=0', '-DPSIO_HAVE_SIMDJSON=0', '-mthread-model', 'single',
         '-msign-ext', '-mnontrapping-fptoint', '-msimd128', '-mbulk-memory']
for include in includes:
    flags += ['-I', str(include)]
lib = REL / 'lib'
# The released Rpc object lacks the current credentialed CORS overload. Replace
# that archive member with the complete unmodified current source, rather than
# allowing duplicate symbols or patching authorization behavior.
current_psibase = OUT / 'libpsibase-current-rpc.a'
shutil.copy2(lib / 'libpsibase.a', current_psibase)
subprocess.run([str(SDK / 'bin/llvm-ar'), 'd', str(current_psibase), 'Rpc.cpp.obj'], check=True)
builtins = next((SDK / 'lib/clang').glob('*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'))
service = ['-Wl,--stack-first', '-Wl,--entry,start', '-Wl,--export=called',
           '-Wl,-z,stack-size=8192', '-Wl,--no-merge-data-segments', '-nostdlib',
           '-Wl,--strip-all', '-lpsibase-service-base', '-lpsibase',
           '-lcrypto', '-lz', '-lc++', '-lc++abi-replacements', '-lc-simple-malloc', '-lc',
           '-lpsibase-service-wasi-polyfill', str(builtins)]
cmd = [str(CLANG), *flags, str(SOURCE), str(RPC), '-L', str(lib), *service, '-o', str(OUT / 'CommonApi.wasm')]
cmd = [str(current_psibase) if item == '-lpsibase' else item for item in cmd]
(OUT / 'compile-command.json').write_text(json.dumps(cmd, indent=2) + '\n')
subprocess.run(cmd, check=True)
schema_flags = [flag for flag in flags if flag != '-DCOMPILING_SERVICE']
schema = [str(CLANG), *schema_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
          str(SOURCE), str(RPC), '-L', str(lib), '-Wl,--entry,_start', '-nostdlib', '-Wl,--strip-all',
          '-lpsibase', '-lcrypto', '-lz', '-lc++', '-lc++abi', '-lc',
          '-lpsitestlib', '-lSpki', '-lPrivateKeyInfo', str(builtins),
          str(SDK / 'share/wasi-sysroot/lib/wasm32-wasip1/crt1.o'),
          '-o', str(OUT / 'CommonApi-schema-gen.wasm')]
schema = [str(current_psibase) if item == '-lpsibase' else item for item in schema]
subprocess.run(schema, check=True)
with (OUT / 'CommonApi-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'CommonApi-schema-gen.wasm'), '--schema'], stdout=output, check=True)
files = [SOURCE, RPC, ROOT / 'packages/user/CommonApi/include/services/system/CommonApi.hpp',
         OUT / 'CommonApi.wasm', OUT / 'CommonApi-schema.json']
(OUT / 'provenance.json').write_text(json.dumps({
    'source_unmodified': True, 'compiler': str(CLANG), 'wasi_libraries': str(REL),
    'sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
}, indent=2) + '\n')
print(OUT / 'CommonApi.wasm')
print(OUT / 'CommonApi-schema.json')
