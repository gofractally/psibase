#!/usr/bin/env python3
"""Build current native HttpServer and real production-header regressions."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SDK = Path('/Users/dlarimer/psibase/build/psidk')
REL = ROOT / 'demo/upstream/psidk-ubuntu-2404/share/wasi-sysroot'
CLANG = SDK / 'bin/clang++'
SOURCE = ROOT / 'packages/system/HttpServer/src/HttpServer.cpp'
RPC = ROOT / 'libraries/psibase/common/src/Rpc.cpp'
HEADERS = ROOT / 'libraries/psibase/common/src/HttpHeaders.cpp'
includes = [ROOT / 'packages/system/HttpServer/include']
includes += [p for p in sorted((ROOT / 'packages').glob('**/include')) if 'target' not in p.parts]
includes += [ROOT / 'libraries/psibase/common/include', ROOT / 'libraries/psibase/wasm32-psibase',
             ROOT / 'libraries/psibase/tester/include', ROOT / 'external/psio/cpp/include',
             REL / 'include', REL / 'include/wasm32-psibase']
flags = ['--target=wasm32-wasip1', '-std=c++23', '-O2', '-fno-exceptions',
         '-DCOMPILING_SERVICE', '-DCOMPILING_WASM', '-DPSIO_EXCEPTIONS_ENABLED=0', '-DPSIO_HAVE_SIMDJSON=0', '-mthread-model', 'single',
         '-msign-ext', '-mnontrapping-fptoint', '-msimd128', '-mbulk-memory']
for include in includes:
    flags += ['-I', str(include)]
lib = REL / 'lib'
archive = OUT / 'libpsibase-current-rpc.a'
shutil.copy2(lib / 'libpsibase.a', archive)
subprocess.run([str(SDK / 'bin/llvm-ar'), 'd', str(archive), 'Rpc.cpp.obj', 'HttpHeaders.cpp.obj'], check=True)
builtins = next((SDK / 'lib/clang').glob('*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'))
service = ['-Wl,--stack-first', '-Wl,--entry,start', '-Wl,--export=called',
           '-Wl,-z,stack-size=8192', '-Wl,--no-merge-data-segments', '-nostdlib',
           '-Wl,--strip-all', '-lpsibase-service-base', str(archive),
           '-lcrypto', '-lz', '-lc++', '-lc++abi-replacements', '-lc',
           '-lpsibase-service-wasi-polyfill', str(builtins)]
cmd = [str(CLANG), *flags, str(SOURCE), str(RPC), str(HEADERS), '-L', str(lib), *service, '-o', str(OUT / 'HttpServer.wasm')]
(OUT / 'compile-command.json').write_text(json.dumps(cmd, indent=2) + '\n')
subprocess.run(cmd, check=True)
test_flags = [flag for flag in flags if flag != '-DCOMPILING_SERVICE']
runtime = ['-L', str(lib), '-Wl,--entry,_start', '-nostdlib', '-Wl,--strip-all', str(archive),
           '-lcrypto', '-lz', '-lc++', '-lc++abi', '-lc', '-lpsitestlib',
           '-lSpki', '-lPrivateKeyInfo', str(builtins),
           str(SDK / 'share/wasi-sysroot/lib/wasm32-wasip1/crt1.o')]
schema = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
          str(SOURCE), str(RPC), str(HEADERS), *runtime, '-o', str(OUT / 'HttpServer-schema-gen.wasm')]
subprocess.run(schema, check=True)
with (OUT / 'HttpServer-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'HttpServer-schema-gen.wasm'), '--schema'], stdout=output, check=True)
test = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', str(OUT / 'request-header-tests.cpp'),
        str(RPC), str(HEADERS), *runtime,
        '-o', str(OUT / 'test-rpc.wasm')]
subprocess.run(test, check=True)
subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'test-rpc.wasm')], check=True)
probe = [str(CLANG), *flags, str(OUT / 'CookieProbe.cpp'), str(RPC), str(HEADERS), '-L', str(lib), *service,
         '-o', str(OUT / 'CookieProbe.wasm')]
subprocess.run(probe, check=True)
probe_schema = [str(CLANG), *test_flags, '-DCOMPILING_TESTS', '-DPSIBASE_GENERATE_SCHEMA',
                str(OUT / 'CookieProbe.cpp'), str(RPC), str(HEADERS), *runtime, '-o', str(OUT / 'CookieProbe-schema-gen.wasm')]
subprocess.run(probe_schema, check=True)
with (OUT / 'CookieProbe-schema.json').open('w') as output:
    subprocess.run([str(ROOT / 'build/psitest'), str(OUT / 'CookieProbe-schema-gen.wasm'), '--schema'], stdout=output, check=True)
files = [SOURCE, RPC, HEADERS, ROOT / 'packages/system/HttpServer/include/services/system/HttpServerRequest.hpp',
         ROOT / 'packages/psibase_tests/test/test_rpc.cpp', OUT / 'HttpServer.wasm', OUT / 'HttpServer-schema.json']
(OUT / 'provenance.json').write_text(json.dumps({
    'compiler': str(CLANG), 'wasi_libraries': str(REL),
    'sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
}, indent=2) + '\n')
print(OUT / 'HttpServer.wasm')
