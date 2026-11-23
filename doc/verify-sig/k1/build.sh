#!/bin/bash
# Builds k1/VerifyK1.cpp + libsecp256k1 as a wasm service and as a native dylib.
# usage: k1/build.sh <name> <window> <int128|int64> [wasm-stack-bytes]
set -e
cd "$(dirname "$0")/.."
NAME=$1; WINDOW=$2; WIDE=$3; STACK=${4:-32768}
S=$HOME/psibase-claude-psizam
WB=$HOME/psibase-claude-psizam-build/wasm
SDK=$HOME/psibase/build/wasi-sdk-prefix/src/wasi-sdk
SECP=secp-src
case $WIDE in int128) W=-DUSE_FORCE_WIDEMUL_INT128=1;; int64) W=-DUSE_FORCE_WIDEMUL_INT64=1;; esac
SDEF="-DECMULT_WINDOW_SIZE=$WINDOW -DCOMB_BLOCKS=2 -DCOMB_TEETH=5 $W -DSECP256K1_STATIC -I$SECP -I$SECP/include -I$SECP/src"
O=build/k1/$NAME; mkdir -p $O/wasm $O/native

# ---- wasm (same flags as the VerifySig service) ----
WFLAGS="--target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory -mthread-model single -O3 $WASM_EXTRA"
for f in secp256k1 precomputed_ecmult precomputed_ecmult_gen; do
  $SDK/bin/clang $WFLAGS $SDEF -c $SECP/src/$f.c -o $O/wasm/$f.o
done
$SDK/bin/clang++ $WFLAGS -isystem $WB/deps/include -std=c++23 -DCOMPILING_SERVICE -DCOMPILING_WASM -fno-exceptions $(cat build/wasm_includes.txt) -DSECP256K1_STATIC -I$SECP/include -c k1/VerifyK1.cpp -o $O/wasm/VerifyK1.o
(cd $WB && $SDK/bin/clang++ --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot \
  -Wl,--stack-first -Wl,--entry,start -Wl,--export=called -Wl,-z,stack-size=$STACK -Wl,--no-merge-data-segments -nostdlib \
  -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory $WASM_EXTRA -B$S/libraries/psibase/sdk/psibase- -Wl,--strip-all ${LINK_OPT:--O3} -L$WB/deps/lib \
  $OLDPWD/$O/wasm/VerifyK1.o $OLDPWD/$O/wasm/secp256k1.o $OLDPWD/$O/wasm/precomputed_ecmult.o $OLDPWD/$O/wasm/precomputed_ecmult_gen.o \
  libraries/psibase/libexception-stub.a -L$WB/libraries/psibase libraries/psibase/libpsibase-service-base.a libraries/psibase/libpsibase.a libraries/psio/libpsio.a \
  deps/lib/libcrypto.a deps/lib/libz.a -lc++ -lc++abi-replacements -lc libraries/psibase/libpsibase-service-wasi-polyfill.a \
  $SDK/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a -o $OLDPWD/build/k1/$NAME.wasm)

# ---- native ----
CC=/opt/homebrew/opt/llvm@20/bin/clang; CXX=/opt/homebrew/opt/llvm@20/bin/clang++
NINC="-I$S/libraries/psibase/common/include -I$S/libraries/psibase/service/include -I$S/libraries/psio/include -I$S/external/rapidjson/include -I/opt/homebrew/include"
NFLAGS="-O3 -fPIC -fvisibility=hidden"
for f in secp256k1 precomputed_ecmult precomputed_ecmult_gen; do
  $CC $NFLAGS $SDEF -c $SECP/src/$f.c -o $O/native/$f.o
done
$CXX -std=gnu++2b $NFLAGS -DCOMPILING_SERVICE $NINC -DSECP256K1_STATIC -I$SECP/include -c k1/VerifyK1.cpp -o $O/native/VerifyK1.o
$CXX -std=gnu++2b $NFLAGS -DCOMPILING_SERVICE $NINC -c $S/libraries/psibase/service/src/intrinsic.cpp -o $O/native/intrinsic.o
$CXX -std=gnu++2b $NFLAGS -c harness/native_host.cpp -o $O/native/native_host.o
$CXX -shared -o build/k1/lib$NAME.dylib $O/native/*.o -Wl,-dead_strip -L/opt/homebrew/opt/llvm@20/lib/c++ -Wl,-rpath,/opt/homebrew/opt/llvm@20/lib/c++
echo "built build/k1/$NAME.wasm ($(stat -f %z build/k1/$NAME.wasm) bytes) and build/k1/lib$NAME.dylib"
