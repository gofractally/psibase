#!/bin/bash
# Builds lean/VerifySig.cpp (libsecp256k1 + a P-256 backend) as a wasm service
# and as a native dylib from the same sources.
# usage: lean/build.sh <name> <r1: m64|m62|m31|m15|p256m> <wide: 0|1> [k1-window] [wasm-stack]
set -e
cd "$(dirname "$0")/.."
NAME=$1; R1=$2; WIDE=$3; WINDOW=${4:-8}; STACK=${5:-32768}
S=$HOME/psibase-claude-psizam
WB=$HOME/psibase-claude-psizam-build/wasm
SDK=$HOME/psibase/build/wasi-sdk-prefix/src/wasi-sdk
SECP=secp-src; BR=p256/bearssl; PM=p256/p256-m
O=build/lean/$NAME; rm -rf $O; mkdir -p $O/wasm $O/native

if [ "$WIDE" = 1 ]; then WASM_EXTRA=-mwide-arithmetic; LINK_OPT=-O0; K1W=-DUSE_FORCE_WIDEMUL_INT128=1; BR64="-DBR_64=1 -DBR_INT128=1"
else WASM_EXTRA=; LINK_OPT=-O3; K1W=-DUSE_FORCE_WIDEMUL_INT64=1; BR64="-DBR_64=0 -DBR_INT128=0"; fi
SDEF="-DECMULT_WINDOW_SIZE=$WINDOW -DCOMB_BLOCKS=2 -DCOMB_TEETH=5 -DSECP256K1_STATIC -I$SECP -I$SECP/include -I$SECP/src"
case $R1 in
  m64) RDEF="-DLEAN_R1_BEARSSL=br_ec_p256_m64_get()";;
  m62) RDEF="-DLEAN_R1_BEARSSL=br_ec_p256_m62_get()";;
  m31) RDEF="-DLEAN_R1_BEARSSL=&br_ec_p256_m31";;
  m15) RDEF="-DLEAN_R1_BEARSSL=&br_ec_p256_m15";;
  p256m) RDEF="-DLEAN_R1_P256M=1";;
esac
BRSRC="$BR/src/ec/ec_p256_m64.c $BR/src/ec/ec_p256_m62.c $BR/src/ec/ec_p256_m31.c $BR/src/ec/ec_p256_m15.c $BR/src/ec/ec_secp256r1.c $BR/src/ec/ec_secp384r1.c $BR/src/ec/ec_secp521r1.c $BR/src/ec/ecdsa_i31_vrfy_raw.c $BR/src/ec/ecdsa_i31_bits.c $(ls $BR/src/int/i31_*.c $BR/src/int/i32_div32.c $BR/src/int/i62_modpow2.c $BR/src/codec/*.c)"

build() {  # $1=wasm|native  $2=cc  $3=cxx  $4=cflags  $5=c++ service flags
  local d=$O/$1 i=0
  for f in secp256k1 precomputed_ecmult precomputed_ecmult_gen; do $2 $4 $SDEF ${6} -c $SECP/src/$f.c -o $d/$f.o; done
  if [ "$R1" = p256m ]; then $2 $4 -I$PM -c $PM/p256-m.c -o $d/p256m.o
  else for f in $BRSRC; do $2 $4 ${7} -I$BR/inc -I$BR/src -c $f -o $d/br_$(basename $f .c).o; done; fi
  $3 $4 $5 $RDEF -DSECP256K1_STATIC -I$SECP/include -I$BR/inc -I$PM -c lean/VerifySig.cpp -o $d/VerifySig.o
}

# ---- wasm ----
WFLAGS="--target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory -mthread-model single -O3 $WASM_EXTRA"
build wasm $SDK/bin/clang $SDK/bin/clang++ "$WFLAGS" "-isystem $WB/deps/include -std=c++23 -DCOMPILING_SERVICE -DCOMPILING_WASM -fno-exceptions $(cat build/wasm_includes.txt)" "$K1W" "$BR64"
OBJS=$(ls $PWD/$O/wasm/*.o)
(cd $WB && $SDK/bin/clang++ --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot \
  -Wl,--stack-first -Wl,--entry,start -Wl,--export=called -Wl,-z,stack-size=$STACK -Wl,--no-merge-data-segments -nostdlib \
  -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory $WASM_EXTRA -B$S/libraries/psibase/sdk/psibase- -Wl,--strip-all $LINK_OPT -L$WB/deps/lib \
  $OBJS libraries/psibase/libexception-stub.a -L$WB/libraries/psibase libraries/psibase/libpsibase-service-base.a libraries/psibase/libpsibase.a libraries/psio/libpsio.a \
  deps/lib/libcrypto.a deps/lib/libz.a -lc++ -lc++abi-replacements -lc libraries/psibase/libpsibase-service-wasi-polyfill.a \
  $SDK/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a -o $OLDPWD/build/lean/$NAME.wasm)

# ---- native (always 64-bit arithmetic) ----
NINC="-I$S/libraries/psibase/common/include -I$S/libraries/psibase/service/include -I$S/libraries/psio/include -I$S/external/rapidjson/include -I/opt/homebrew/include"
LL=/opt/homebrew/opt/llvm@20
build native $LL/bin/clang $LL/bin/clang++ "-O3 -fPIC -fvisibility=hidden" "-std=gnu++2b -DCOMPILING_SERVICE $NINC" "" ""
$LL/bin/clang++ -std=gnu++2b -O3 -fPIC -fvisibility=hidden -DCOMPILING_SERVICE $NINC -c $S/libraries/psibase/service/src/intrinsic.cpp -o $O/native/intrinsic.o
$LL/bin/clang++ -std=gnu++2b -O3 -fPIC -fvisibility=hidden -c harness/native_host.cpp -o $O/native/native_host.o
$LL/bin/clang++ -shared -o build/lean/lib$NAME.dylib $O/native/*.o -Wl,-dead_strip -L$LL/lib/c++ -Wl,-rpath,$LL/lib/c++
echo "built build/lean/$NAME.wasm ($(stat -f %z build/lean/$NAME.wasm) bytes) and build/lean/lib$NAME.dylib"
