#!/usr/bin/env python3
"""Build latest Invite with the local macOS compiler and released WASM libs."""
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SDK = Path('/Users/dlarimer/psibase/build/psidk')
REL = ROOT / 'demo/upstream/psidk-ubuntu-2404/share/wasi-sysroot'
CLANG = SDK / 'bin/clang++'
NAME = sys.argv[1] if len(sys.argv) > 1 else 'Invite'
if NAME not in ('Invite', 'RInvite'): raise SystemExit('expected Invite or RInvite')
SOURCE = ROOT / f'packages/user/Invite/src/{NAME}.cpp'
includes = [ROOT / 'packages/user/Invite/include']
includes += [p for p in sorted((ROOT / 'packages').glob('**/include')) if 'target' not in p.parts]
includes += [ROOT / 'libraries/psibase/common/include', ROOT / 'libraries/psibase/wasm32-psibase',
             ROOT / 'external/psio/cpp/include', REL / 'include', REL / 'include/wasm32-psibase', REL / 'include/botan-3']
flags = ['--target=wasm32-wasip1', '-std=c++23', '-O2', '-fno-exceptions',
         '-DCOMPILING_SERVICE', '-DCOMPILING_WASM', '-DPSIO_EXCEPTIONS_ENABLED=0', '-DPSIO_HAVE_SIMDJSON=0', '-mthread-model', 'single',
         '-msign-ext', '-mnontrapping-fptoint', '-msimd128', '-mbulk-memory']
for inc in includes:
    flags += ['-I', str(inc)]
lib = REL / 'lib'
builtins = next((SDK / 'lib/clang').glob('*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'))
common = [str(CLANG), *flags, str(SOURCE), str(ROOT / 'libraries/psibase/service/src/exceptions.cpp'), '-L', str(lib)]
service = ['-Wl,--stack-first', '-Wl,--entry,start', '-Wl,--export=called',
           '-Wl,-z,stack-size=32768', '-Wl,--no-merge-data-segments', '-nostdlib',
           '-Wl,--strip-all', '-lpsibase-service-base', '-lSpki', '-lPrivateKeyInfo', '-lbotan-3', '-lpsibase',
           '-lcrypto', '-lz', '-lc++', '-lc++abi-replacements', '-lc-simple-malloc', '-lc',
           '-lpsibase-service-wasi-polyfill', str(builtins)]
cmd = [*common, *service, '-o', str(OUT / f'{NAME}.wasm')]
(OUT / f'{NAME}-compile-command.txt').write_text(' '.join(cmd) + '\n')
print(f'Compiling latest {NAME}', flush=True)
subprocess.run(cmd, check=True)
print(OUT / f'{NAME}.wasm')

test_flags = [f for f in flags if f != '-DCOMPILING_SERVICE']
schema_cmd = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
              str(SOURCE), '-L', str(lib), '-Wl,--entry,_start', '-nostdlib',
              '-Wl,--strip-all', '-lpsibase', '-lcrypto', '-lz',
              '-lc++', '-lc++abi', '-lc', '-lpsitestlib', '-lSpki', '-lPrivateKeyInfo',
              str(builtins), str(SDK / 'share/wasi-sysroot/lib/wasm32-wasip1/crt1.o'),
              '-o', str(OUT / f'{NAME}-schema-gen.wasm')]
print(f'Compiling {NAME} schema generator', flush=True)
subprocess.run(schema_cmd, check=True)
with (OUT / f'{NAME}-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / f'{NAME}-schema-gen.wasm'), '--schema'],
                   stdout=output, check=True)
print(OUT / f'{NAME}-schema.json')
