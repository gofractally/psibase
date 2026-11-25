#!/bin/bash
# Builds the unmodified VerifySig service source as a native shared library.
set -e
cd "$(dirname "$0")"
S=${PSIBASE_SRC:-$HOME/psibase-claude-psizam}
CXX=${CXX:-/opt/homebrew/opt/llvm/bin/clang++}
DEPS=${DEPS:-native-deps}
OUT=${OUT:-build/libVerifySig.dylib}
INC="-I$S/libraries/psibase/common/include -I$S/libraries/psibase/service/include -I$S/libraries/psio/include -I$S/external/rapidjson/include -I/opt/homebrew/include -I$S/packages/system/VerifySig/include -I$S/packages/system/Transact/include -I$S/packages/system/Accounts/include -I$DEPS/include/botan-3"
FLAGS="-std=gnu++2b -O3 -fPIC -fvisibility=hidden -DCOMPILING_SERVICE"
mkdir -p build/obj
$CXX $FLAGS $INC -c $S/packages/system/VerifySig/src/VerifySig.cpp -o build/obj/VerifySig.o
$CXX $FLAGS $INC -c $S/libraries/psibase/service/src/intrinsic.cpp -o build/obj/intrinsic.o
$CXX $FLAGS $INC -c harness/native_host.cpp -o build/obj/native_host.o
$CXX -shared -o $OUT build/obj/VerifySig.o build/obj/intrinsic.o build/obj/native_host.o $DEPS/lib/libbotan-3.a "$@"
echo built $OUT
