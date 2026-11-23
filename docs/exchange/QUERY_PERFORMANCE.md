# Exchange state-query measurements

Measured on 2026-11-23 on an Apple M5 Max with 18 physical cores and 128 GiB RAM,
macOS 26.3.1, using four service workers. The head-based native Wasmtime/psitri
chain ran at port 8096 with a funded BTC/USD book and a live transaction bot.
The test used warm, reused loopback HTTP connections and validated every JSON
response. Background block production, the bot, the open UI and concurrent
developer work were present. These are observed operating points for this
configuration and dataset, not a full-machine or production capacity claim.

The measured build is pinned to `054a0c386` plus the Exchange fixes on
`codex/app-regression`. The target branch advanced to `04efaefe4` during the
run; these measurements identify the tested snapshot rather than a moving
branch name. The [versioned summary](benchmarks/query-performance-2026-11-23.json)
records the original and profiler binary hashes.

## Throughput without profiling

| Query workload | HTTP workers | Successful requests/sec | Median latency | p95 latency | p99 latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Public market + bid/ask book mix | 4 | 1,925 | 1.71 ms | 4.23 ms | 6.85 ms |
| Public market + bid/ask book mix | 32 | 2,926 | 10.47 ms | 15.69 ms | 19.76 ms |
| Public market + bid/ask book mix | 64 | 2,914 | 21.52 ms | 30.13 ms | 36.52 ms |
| Authenticated scoped snapshot | 4 | 1,667 | 2.31 ms | 3.13 ms | 4.18 ms |
| Authenticated scoped snapshot | 8 | 1,806 | 4.29 ms | 6.40 ms | 8.06 ms |

Every stage had zero request failures. Public throughput flattened near
2,900 requests/sec between 32 and 64 concurrent workers. Private snapshots
peaked near 1,800 requests/sec at eight workers and declined slightly at 16.
Higher concurrency mainly increased waiting time.

The public mix rotates through `/market`, bid `/book`, and ask `/book`, matching
the three reads in a public UI refresh. Thus 2,926 requests/sec corresponds to
about 975 complete three-request refreshes/sec. An authenticated scoped
snapshot is one HTTP request. Browser users also make candle/history requests;
refresh-equivalent throughput is not a maximum-user count.

The private response was about 5,590 bytes: one market, approximately 46 public
price levels, one own limit-order position, one own loan, two balances and no
own lending, relay or stop position. The bot changes the active level count.
This measures repeated warm reads for one account, rather than a large working
set of different users, markets and long histories.

Baseline-subtracted whole-process CPU estimates were approximately 1.0–1.1 ms
per public request and 1.8 ms per account snapshot. These estimates use process
user + system CPU with idle measurements before and after each workload. Idle
subtraction is an estimate; background activity is not perfectly stationary.

## CPU attribution

The optional native probe uses `CLOCK_THREAD_CPUTIME_ID` with exclusive nested
scopes. Guest execution, host work and raw KV work are not counted twice.
Process CPU supplies the remaining native cost. See
[the probe definition](../../libraries/psibase/native/QUERY_CPU_PROFILE.md).

CPU attribution is measured in a separate instrumented run. The initial probe
put too many atomic updates on shared cache lines and increased four-worker
snapshot CPU cost by about 52%. Those results are retained as diagnostic
evidence and must not be treated as the uninstrumented production CPU split.
The revised probe uses per-thread counters. Its concurrency-four diagnostic
CPU shares were:

| Workload | KV database operations | Guest WASM | Native host/setup/residual |
| --- | ---: | ---: | ---: |
| Public market/book mix | 4.9% | 28.2% | 66.8% |
| Authenticated scoped snapshot | 5.6% | 41.5% | 52.9% |

The revised probe still materially perturbs execution. Its CPU/request was
about 40–44% higher than a nearby uninstrumented run; that comparison also had
changing competing load (approximately 77–119 runnable/load-average units
during profiling versus 58–63 nearby on this 18-core host). It does not isolate
the profiler's causal overhead. These percentages describe the instrumented
process and support a rough breakdown, not exact uninstrumented CPU shares.
Raw KV operations were a small part of these warm reads; guest service work
and native request/VM machinery dominated the diagnostic samples.

"Database CPU" means the instrumented KV operation regions, including their
setup/copy/tracking work. Storage commit, pruning and owner-thread work outside
those regions belong to the native residual. It is not disk wait time. The
working set here was warm in memory; cold or much larger state needs a separate
test. CPU checkpoints include background work and have their own recorded
window, which can be slightly longer than the HTTP load window.

## Repeating the measurement

The runner is `demo/bench_exchange_queries.py`. It is read-only, uses a
loopback-only target, bounds duration and concurrency, stops on failed/invalid
responses and records node/client CPU separately.

```sh
python3 demo/bench_exchange_queries.py \
  --base-url http://127.0.0.1:8096 \
  --host exchange.psibase.localhost:8096 \
  --node-pid PID --service-threads 4 \
  --workloads public-refresh --concurrency 1,2,4,8,16,32,64 \
  --seconds 10 --output build-app-regression/query-throughput.json
```

Private snapshots additionally require an owner and a protected authorization
file produced by the matching CLI's native login. Authorization is never
printed or included in the report. Remove the temporary file afterward.
Profiling additionally requires the explicit `--profile-checkpoints` and
`--profile-log` options. Before every signal the runner verifies the native
enabled marker, PID, kernel birth identity and executable. Never send the
checkpoint signal to an ordinary node.

Local evidence is under `build-app-regression/`:

- `query-throughput-head-unprofiled.json`
- `query-throughput-head-unprofiled-public-extended.json`
- `query-throughput-8089.json` (earlier runtime, different dataset)
- `query-throughput-head-profiled.json` (initial probe, significant overhead)
- `query-profile-observed-comparison.json`
- `query-throughput-head-profiled-v2.json`
- `query-throughput-head-unprofiled-paired.json`
- `query-profile-v2-observed-comparison.json`
- `query-performance-summary.json`

The earlier live runtime measured approximately 585 public requests/sec and
136 scoped snapshots/sec. Its dataset and service/runtime build differ, so
those observations do not isolate the cause of the improvement.
