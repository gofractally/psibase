#!/usr/bin/env python3
"""Build latest Accounts with the local macOS compiler and released WASM libs."""
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SDK = Path('/Users/dlarimer/psibase/build/psidk')
REL = ROOT / 'demo/upstream/psidk-ubuntu-2404/share/wasi-sysroot'
CLANG = SDK / 'bin/clang++'
SOURCE = ROOT / 'packages/system/Accounts/src/Accounts.cpp'
includes = [ROOT / 'packages/system/Accounts/include']
includes += [p for p in sorted((ROOT / 'packages').glob('**/include')) if 'target' not in p.parts]
includes += [ROOT / 'libraries/psibase/common/include', ROOT / 'libraries/psibase/wasm32-psibase',
             ROOT / 'external/psio/cpp/include', REL / 'include', REL / 'include/wasm32-psibase']
flags = ['--target=wasm32-wasip1', '-std=c++23', '-O2', '-fno-exceptions',
         '-DCOMPILING_SERVICE', '-DCOMPILING_WASM', '-DPSIO_EXCEPTIONS_ENABLED=0', '-DPSIO_HAVE_SIMDJSON=0', '-mthread-model', 'single',
         '-msign-ext', '-mnontrapping-fptoint', '-msimd128', '-mbulk-memory']
for inc in includes:
    flags += ['-I', str(inc)]
lib = REL / 'lib'
builtins = next((SDK / 'lib/clang').glob('*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'))
common = [str(CLANG), *flags, str(SOURCE), '-L', str(lib)]
service = ['-Wl,--stack-first', '-Wl,--entry,start', '-Wl,--export=called',
           '-Wl,-z,stack-size=8192', '-Wl,--no-merge-data-segments', '-nostdlib',
           '-Wl,--strip-all', '-lpsibase-service-base', '-lpsibase',
           '-lcrypto', '-lz', '-lc++', '-lc++abi-replacements', '-lc-simple-malloc', '-lc',
           '-lpsibase-service-wasi-polyfill', str(builtins)]
cmd = [*common, *service, '-o', str(OUT / 'Accounts.wasm')]
(OUT / 'compile-command.txt').write_text(' '.join(cmd) + '\n')
print('Compiling latest Accounts', flush=True)
subprocess.run(cmd, check=True)
print(OUT / 'Accounts.wasm')

test_flags = [f for f in flags if f != '-DCOMPILING_SERVICE']
schema_cmd = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
              str(SOURCE), '-L', str(lib), '-Wl,--entry,_start', '-nostdlib',
              '-Wl,--strip-all', '-lpsibase', '-lcrypto', '-lz',
              '-lc++', '-lc++abi', '-lc', '-lpsitestlib', '-lSpki', '-lPrivateKeyInfo',
              str(builtins), str(SDK / 'share/wasi-sysroot/lib/wasm32-wasip1/crt1.o'),
              '-o', str(OUT / 'Accounts-schema-gen.wasm')]
print('Compiling Accounts schema generator', flush=True)
subprocess.run(schema_cmd, check=True)
with (OUT / 'Accounts-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'Accounts-schema-gen.wasm'), '--schema'],
                   stdout=output, check=True)
print(OUT / 'Accounts-schema.json')
