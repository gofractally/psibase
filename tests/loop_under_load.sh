#!/bin/sh
# Runs the tests of the node-local (subjective) databases and of sockets
# again and again while the machine is busy, to find races that a single
# quiet run does not show.
#
#     tests/loop_under_load.sh <build directory> [rounds] [output directory]
#
# Environment:
#     JOBS    ctest -j (default 4)
#     LOAD    number of busy processes started beside the tests (default 8;
#             0 for none). They are started here and killed by pid at the
#             end, also when the script is interrupted.
#     TESTS   a ctest -R expression replacing the default selection
#
# Each round is one ctest run of the selection; its full output is kept as
# <output directory>/round-<n>.txt and one line per round, followed by the
# ctest lines of the tests that failed, goes to <output directory>/summary.txt
# and to stdout. The exit status is the number of rounds that had a failure.
#
# The default selection is the native storage and subjective-commit tests,
# the psinode tests that go through sockets and subjective transactions, and
# the service tests of the transaction queue. Tests that are not registered
# in a build (the usage tests, for instance) are simply not matched.
#
# A failure here is a finding: keep round-<n>.txt. Note that PsizamTests
# contains comparisons of measured times ("Storing code bills the same with
# and without a compiled module") that fail on a heavily loaded machine
# without any concurrency being involved; read the assertion before blaming
# a race.
#
# Refs gofractally/psibase#2274, gofractally/psibase#2276.

if [ $# -lt 1 ]; then
    sed -n '2,8p' "$0"
    exit 2
fi
build=$1
rounds=${2:-30}
out=${3:-$build/loop-under-load}
jobs=${JOBS:-4}
load=${LOAD:-8}
tests=${TESTS:-'^(PsitriDatabaseTests|UsageMeterTests|PsizamTests|StorageTimeoutTests|CpuAccountingContract|psinode_test_websocket|psinode_test_routing|psinode_test_shutdown|psinode_test_usage|psinode_test_subjective|psinode_test_txqueue|psinode_test_fetch|psinode_test_timer|rs-subjective-test|t-Transact-test)$'}

cd "$build" || exit 2
mkdir -p "$out" || exit 2

pids=""
stop_load() {
    [ -n "$pids" ] && kill $pids 2>/dev/null
    pids=""
}
trap 'stop_load; exit 130' INT TERM
i=0
while [ "$i" -lt "$load" ]; do
    ( while :; do :; done ) &
    pids="$pids $!"
    i=$((i + 1))
done

summary=$out/summary.txt
echo "build $build, $rounds rounds, ctest -j$jobs, $load busy processes:$pids" | tee "$summary"
echo "start: $(uptime)" | tee -a "$summary"

bad=0
r=1
while [ "$r" -le "$rounds" ]; do
    ctest -R "$tests" -j"$jobs" --output-on-failure > "$out/round-$r.txt" 2>&1
    status=$?
    [ "$status" -ne 0 ] && bad=$((bad + 1))
    echo "round $r: exit $status, $(grep -E 'tests passed' "$out/round-$r.txt"), load$(uptime | sed 's/.*averages*://')" | tee -a "$summary"
    grep -E '^ *[0-9]+/[0-9]+ Test +#[0-9]+: .*\*\*\*' "$out/round-$r.txt" | tee -a "$summary"
    r=$((r + 1))
done
stop_load
echo "end: $(uptime)" | tee -a "$summary"
echo "$bad of $rounds rounds had a failure" | tee -a "$summary"
exit "$bad"
