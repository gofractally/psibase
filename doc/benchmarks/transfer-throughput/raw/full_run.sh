#!/bin/bash
# Three points on bytemaster/head: 44c57f739, c45c060cd, 054a0c386. Tester and single-node network.
W=~/claude-bench; M=~/psibase-migration-20261121; L=$W/logs/full; R=$W/results-full; mkdir -p $R $L; export TMPDIR=$W/tmp
PY=$M/deps/test-python/bin/python; J=16; cd $W; ulimit -n 65536
export CARGO_BUILD_JOBS=$J CMAKE_BUILD_PARALLEL_LEVEL=$J BINARYEN_CORES=$J LLVM_CONFIG_PATH=/usr/bin/llvm-config-20 LIBCLANG_PATH=$M/deps/libclang RUSTUP_TOOLCHAIN=1.98.0
build() { # src build commit extra-cherry-pick
  local S=$1 B=$2
  ( cd $S && git fetch -q origin bytemaster/head && git checkout -q -f --detach $3 && { [ -z "$4" ] || git -c user.name=bench -c user.email=bench@localhost cherry-pick -n $4; } && git log --oneline -1 &&
    for d in psitri psizam; do t=$(sed -n "/Declare($d\$/,/SOURCE_DIR/ s/.*GIT_TAG \([0-9a-f]*\).*/\1/p" cmake/PsibaseDependencies.cmake); git -C external/$d fetch -q origin 2>/dev/null; git -C external/$d fetch -q origin $t 2>/dev/null; git -C external/$d checkout -q -f --detach $t && echo "$d $(git -C external/$d log --oneline -1)"; done ) > $L/checkout-$3.log 2>&1; echo "checkout $3=$? $(tail -3 $L/checkout-$3.log | tr '\n' ' ')"
  ( export PATH=$B:$B/rust/release:$HOME/claude-psitri-x86/tools/binaryen-version_133/bin:$M/deps/doc-tools/bin:$M/deps/test-python/bin:$M/deps/softhsm2/root/usr/bin:$HOME/.cargo/bin:$HOME/.nvm/versions/node/v22.22.2/bin:$PATH
    export PSIBASE_DATADIR=$B/share/psibase CARGO_PSIBASE_PSITEST=$B/psitest CC_wasm32_wasip1=$HOME/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/clang AR_wasm32_wasip1=$HOME/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/llvm-ar
    ninja -C $B -k 0 -j $J > $L/build-$3.log 2>&1; echo "build $3=$?"; grep -E "^FAILED|CMake Error|error:" $L/build-$3.log | head -6 | cut -c1-200 )
}
# c45c060cd has the benchmark but not the null-action case: add my two benchmark commits (benchmark source only).
build $W/vs-pool-src $W/vs-pool-build c45c060cd "f69220f65 718e3c07b"
build $W/vs-before-src $W/vs-before-build 054a0c386 ""
A=$W/tx-before; P=$W/vs-pool-build; H=$W/vs-before-build
sleep 45
echo "start $(date) load $(cut -d' ' -f1-3 /proc/loadavg)"
: > $R/block.txt
tb() { ( cd $1 && ./psitest TransferBench-test.wasm "$3" 2>&1 | grep -a '^BENCH' | sed "s/^BENCH /BENCH machine=x86 head=$2 rep=$4 /" ) >> $R/block.txt; }
for rep in 1 2 3; do tb $A 44c57f739 "[bench]" $rep; tb $P c45c060cd "[bench]" $rep; tb $H 054a0c386 "[bench]" $rep; tb $P c45c060cd "[bench-null]" $rep; tb $H 054a0c386 "[bench-null]" $rep; done
echo "tester done $(date) load $(cut -d' ' -f1-3 /proc/loadavg)"
for n in 44c57f739 c45c060cd 054a0c386; do
  case $n in 44c57f739) D=$A;; c45c060cd) D=$P;; *) D=$H;; esac
  $PY $W/netbench.py.new --harness $W/vs-before-src/programs/psinode/tests --psinode $D/psinode --psibase $D/rust/release/psibase --label $n --out $R/net-$n-n1.json --nodes 1 --connections 16,64 --phases unsigned,signed-k1 --seconds 20 --max-rate 2000 --dir $W/tmp/nb-full > $R/net-$n-n1.log 2>&1
  echo "net $n exit=$? $(date)"
done
echo "FULLBENCHDONE $(date)"
bash $W/psitri_x86.sh > $W/psitri_x86.out 2>&1; tail -12 $W/psitri_x86.out
echo "FULLDONE $(date)"
