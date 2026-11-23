#!/usr/bin/env python3
"""Bounded, read-only Exchange HTTP throughput/latency and process-CPU probe.

Uses one persistent HTTP connection per worker. Concurrency means outstanding
HTTP workers, not browsers: public-refresh is a round-robin three-request mix.
It never logs authorization values, signs, submits actions, or changes node/bot
state. Whole-node CPU includes every other client and block production; neither
HTTP elapsed time nor process CPU separates database, WASM, and native work.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import http.client
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import signal
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 16 * 1024 * 1024


def percentile(values, fraction):
    """Nearest-rank percentile; an empty population has no percentile."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def distribution(values):
    return {"samples": len(values), "p50_ms": percentile(values, .50),
            "p95_ms": percentile(values, .95), "p99_ms": percentile(values, .99),
            "max_ms": max(values) if values else None,
            "mean_ms": sum(values) / len(values) if values else None}


def decode_json(body):
    value = json.loads(body)
    if isinstance(value, str):  # Older native handlers wrap their JSON string.
        value = json.loads(value)
    if not isinstance(value, dict) or value.get("error"):
        raise ValueError("Response is not a successful JSON object")
    return value


@dataclass(frozen=True)
class Endpoint:
    name: str
    path: str
    required: str
    authorization: str = ""
    owner: str = ""

    def validate(self, body):
        value = decode_json(body)
        if self.required not in value:
            raise ValueError(f"Response missing {self.required}")
        expected_type = {'markets': list, 'levels': list, 'candles': list, 'market': dict, 'owner': str}.get(self.required)
        if expected_type and not isinstance(value[self.required], expected_type):
            raise ValueError(f"Response has invalid {self.required} type")
        if self.owner and value.get("owner") != self.owner:
            raise ValueError("Authenticated response owner mismatch")
        if self.owner and any(not isinstance(value.get(key), list) for key in ('markets', 'levels', 'balances')):
            raise ValueError('Authenticated response is not a complete scoped snapshot DTO')
        return value


class Reader:
    def __init__(self, base_url, host, timeout=5):
        endpoint = urlsplit(base_url)
        self.connection = http.client.HTTPConnection(endpoint.hostname, endpoint.port or 80, timeout=timeout)
        self.host = host
        self.connects = 0

    def get(self, endpoint):
        if self.connection.sock is None:
            self.connects += 1
        headers = {"Host": self.host, "Accept": "application/json", "Accept-Encoding": "identity"}
        if endpoint.authorization:
            headers["Authorization"] = endpoint.authorization
        self.connection.request("GET", endpoint.path, headers=headers)
        response = self.connection.getresponse()
        body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ValueError("Response exceeds bounded benchmark body limit")
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}")
        self.last_value = endpoint.validate(body)
        return len(body)

    def close(self):
        self.connection.close()


def process_cpu_seconds(pid):
    """Cumulative process user+system CPU, including all its threads."""
    if pid is None:
        return None
    if sys.platform.startswith("linux"):
        # comm may contain spaces and parentheses; remaining fields start at3.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")
    text = subprocess.check_output(["ps", "-p", str(pid), "-o", "time="], text=True).strip()
    if not text:
        raise RuntimeError("Measured node process disappeared")
    days, clock = (text.split("-", 1) if "-" in text else ("0", text))
    parts = [float(part) for part in clock.split(":")]
    seconds = sum(part * 60 ** i for i, part in enumerate(reversed(parts)))
    return int(days) * 86400 + seconds


def process_identity(pid):
    if pid is None:
        return None
    return subprocess.check_output(["ps", "-p", str(pid), "-o", "lstart=", "-o", "command="], text=True).strip()


def process_start_identity(pid):
    """Kernel birth identity; startup log wall time is not proof of a PID."""
    if sys.platform == 'darwin':
        import ctypes
        class BsdInfo(ctypes.Structure):
            _fields_ = [('prefix', ctypes.c_uint32 * 12), ('comm', ctypes.c_char * 16),
                        ('name', ctypes.c_char * 32), ('middle', ctypes.c_uint32 * 6),
                        ('start_seconds', ctypes.c_uint64), ('start_microseconds', ctypes.c_uint64)]
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        library.proc_pidinfo.restype = ctypes.c_int
        info = BsdInfo()
        if (library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info)
                or info.prefix[3] != pid):
            raise RuntimeError('Cannot verify kernel process birth time')
        return {'unix_seconds': info.start_seconds, 'birth_id': f'{info.start_seconds}:{info.start_microseconds}'}
    if sys.platform.startswith('linux'):
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        ticks = int(fields[19])
        boot = next(int(line.split()[1]) for line in Path('/proc/stat').read_text().splitlines() if line.startswith('btime '))
        return {'unix_seconds': boot + ticks // os.sysconf('SC_CLK_TCK'), 'birth_id': f'{boot}:{ticks}'}
    raise RuntimeError('Profile checkpoint process verification supports macOS and Linux only')


class ProfileCheckpoints:
    """Explicit opt-in signals only after a matching native startup handshake.

    The operator must keep this dedicated profiling process running throughout
    the run. Every signal rechecks its kernel birth identity and exact command;
    unprofiled/legacy nodes and reused PIDs fail before signaling.
    """
    PREFIX = 'QUERY_CPU_PROFILE '
    ENABLED = 'QUERY_CPU_PROFILE_ENABLED '
    CPU = ('process_cpu_ns', 'wasm_cpu_ns', 'host_native_cpu_ns', 'db_cpu_ns', 'native_residual_cpu_ns')
    COUNTERS = CPU + ('wasm_scopes', 'host_native_scopes', 'db_scopes')

    def __init__(self, log, pid):
        if pid is None:
            raise ValueError('Profile checkpoints require --node-pid')
        self.log, self.pid = Path(log), pid
        self.identity = process_identity(pid)
        self.birth = process_start_identity(pid)
        self.command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'comm='], text=True).strip()
        if Path(self.command).name not in ('psinode', 'psinode-cpu-profile', 'psinode-cpu-profile-v2') or not self.birth['unix_seconds']:
            raise RuntimeError('Profile target must be the expected psinode process')
        markers, snapshots, self.offset = self.events(0)
        if not markers or not self.matches(markers[-1]) or markers[-1].get('signal') != 'SIGUSR1':
            raise RuntimeError('No matching PID/kernel-start native CPU-profile startup marker; no signal sent')
        self.sequence = max((event.get('snapshot_seq', 0) for event in snapshots if self.matches(event)), default=0)

    def matches(self, event):
        return (event.get('schema') == 1 and event.get('pid') == self.pid
                and event.get('process_start_unix_seconds') == self.birth['unix_seconds'])

    def verify(self):
        if (process_identity(self.pid) != self.identity or process_start_identity(self.pid) != self.birth
                or subprocess.check_output(['ps', '-p', str(self.pid), '-o', 'comm='], text=True).strip() != self.command):
            raise RuntimeError('Profiling process identity changed; no further signal sent')

    def events(self, offset):
        if self.log.stat().st_size < offset:
            raise RuntimeError('CPU profile log rotated/truncated during benchmark')
        markers, snapshots = [], []
        with self.log.open() as stream:
            stream.seek(offset)
            while True:
                before = stream.tell()
                line = stream.readline()
                if not line:
                    break
                if not line.endswith('\n'):
                    stream.seek(before)
                    break
                if line.startswith(self.ENABLED):
                    markers.append(json.loads(line[len(self.ENABLED):]))
                elif line.startswith(self.PREFIX):
                    snapshots.append(json.loads(line[len(self.PREFIX):]))
            return markers, snapshots, stream.tell()

    def checkpoint(self, timeout=5):
        self.verify()
        # Never called without the explicit flag plus verified startup marker.
        os.kill(self.pid, signal.SIGUSR1)
        began = time.monotonic()
        while time.monotonic() - began < timeout:
            markers, events, self.offset = self.events(self.offset)
            if any(not self.matches(marker) for marker in markers):
                raise RuntimeError('CPU profile startup identity changed')
            for event in events:
                if not self.matches(event) or event.get('snapshot_seq', 0) <= self.sequence:
                    continue
                self.verify()
                self.sequence = event['snapshot_seq']
                if event.get('active_scopes') != 0 or event.get('clock_errors') != 0:
                    raise RuntimeError('CPU checkpoint is not quiescent or has clock errors; attribution invalid')
                if any(not isinstance(event.get(key), int) or event[key] < 0 for key in self.COUNTERS):
                    raise RuntimeError('CPU checkpoint counters are invalid')
                return {**event, 'checkpoint_wait_seconds': time.monotonic() - began,
                        'collected_at': time.time()}
            time.sleep(.01)
        raise RuntimeError('CPU checkpoint timed out; no synthetic bucket data substituted')

    @classmethod
    def delta(cls, before, after):
        result = {key: after[key] - before[key] for key in cls.COUNTERS}
        result['native_total_cpu_ns'] = result['host_native_cpu_ns'] + result['native_residual_cpu_ns']
        total = result['process_cpu_ns']
        bucket_sum = sum(result[key] for key in cls.CPU[1:])
        result['exclusive_bucket_sum_ns'] = bucket_sum
        result['bucket_balance_error_ns'] = total - bucket_sum
        if 'collected_at' in before and 'collected_at' in after:
            result['checkpoint_wall_window_seconds'] = after['collected_at'] - before['collected_at']
        result['valid'] = total > 0 and all(result[key] >= 0 for key in cls.CPU) and abs(total - bucket_sum) <= 10000
        if result['valid']:
            result['cpu_percentages'] = {key: result[key] / total * 100 for key in cls.CPU[1:]}
            result['three_way_cpu_percentages'] = {
                'database': result['db_cpu_ns'] / total * 100,
                'wasm': result['wasm_cpu_ns'] / total * 100,
                'native': result['native_total_cpu_ns'] / total * 100}
        return result


def machine_info():
    result = {"cpu_model": platform.processor() or "unavailable", "logical_cores": os.cpu_count(),
              "physical_cores": None, "memory_bytes": None}
    if sys.platform == 'darwin':
        values = subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string', 'hw.physicalcpu',
                                          'hw.logicalcpu', 'hw.memsize'], text=True).splitlines()
        result.update(cpu_model=values[0], physical_cores=int(values[1]),
                      logical_cores=int(values[2]), memory_bytes=int(values[3]))
    elif sys.platform.startswith('linux'):
        info = Path('/proc/cpuinfo').read_text()
        cores = set()
        for section in info.split('\n\n'):
            fields = dict(line.split(':', 1) for line in section.splitlines() if ':' in line)
            fields = {key.strip(): value.strip() for key, value in fields.items()}
            if 'model name' in fields:
                result['cpu_model'] = fields['model name']
            if 'physical id' in fields and 'core id' in fields:
                cores.add((fields['physical id'], fields['core id']))
        result['physical_cores'] = len(cores) or None
        memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        result['memory_bytes'] = int(memory['MemTotal'].split()[0]) * 1024
    return result


def activity_status(path):
    if path is None:
        return None
    try:
        value = json.loads(Path(path).read_text())
        return {key: value.get(key) for key in ("state", "pid", "updated_at", "submitted", "confirmed", "rejected", "pending")}
    except (OSError, ValueError):
        return {"state": "unavailable"}


def idle_sample(pid, seconds):
    before = process_cpu_seconds(pid)
    started = time.monotonic()
    time.sleep(seconds)
    wall = time.monotonic() - started
    after = process_cpu_seconds(pid)
    cpu = after - before if before is not None else None
    return {"wall_seconds": wall, "node_cpu_seconds": cpu,
            "node_cpu_seconds_per_second": cpu / wall if cpu is not None else None}


def benchmark_stage(base_url, host, endpoints, concurrency, seconds, *, pid=None,
                    timeout=5, max_requests=100000, error_limit=10, status_file=None, profiler=None):
    """Closed-loop bounded GET load, with every completed/error request counted."""
    lock, stop = threading.Lock(), threading.Event()
    ready, begin_load = threading.Barrier(concurrency + 1), threading.Event()
    requested = 0
    errors = Counter()
    samples = {endpoint.name: [] for endpoint in endpoints}
    sizes = {endpoint.name: 0 for endpoint in endpoints}
    connects = []
    deadline = [0.0]

    def worker(index):
        nonlocal requested
        reader = Reader(base_url, host, timeout)
        offset = index % len(endpoints)
        try:
            # Warm the actual per-worker connection and every endpoint outside
            # the measured CPU/wall window. Reported requests exclude warmup.
            try:
                for endpoint in endpoints:
                    reader.get(endpoint)
            except Exception as error:
                with lock:
                    errors[f"warmup: {endpoint.name}: {type(error).__name__}: {error}"] += 1
                    stop.set()
            ready.wait(timeout=timeout * len(endpoints) + 5)
            begin_load.wait()
            while not stop.is_set() and time.monotonic() < deadline[0]:
                with lock:
                    if requested >= max_requests:
                        stop.set()
                        break
                    requested += 1
                endpoint = endpoints[offset]
                offset = (offset + 1) % len(endpoints)
                began = time.perf_counter()
                try:
                    size = reader.get(endpoint)
                    elapsed = (time.perf_counter() - began) * 1000
                    with lock:
                        samples[endpoint.name].append(elapsed)
                        sizes[endpoint.name] += size
                except Exception as error:
                    # Reads may reconnect, but no writes or transaction retries
                    # exist here. Stop a failing stage instead of flooding it.
                    reader.close()
                    with lock:
                        errors[f"{endpoint.name}: {type(error).__name__}: {error}"] += 1
                        if sum(errors.values()) >= error_limit:
                            stop.set()
        finally:
            reader.close()
            with lock:
                connects.append(reader.connects)

    bot_before = activity_status(status_file)
    load_before = os.getloadavg()
    identity = process_identity(pid)
    profile_before = profile_after = None
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(worker, index) for index in range(concurrency)]
        try:
            ready.wait(timeout=timeout * len(endpoints) + 5)
            profile_before = profiler.checkpoint() if profiler else None
            cpu_before = process_cpu_seconds(pid)
            client_before = time.process_time()
            started = time.monotonic()
            deadline[0] = started + seconds
            begin_load.set()
            for future in futures:
                future.result()
        finally:
            # A failed pre-load checkpoint must release waiting worker threads.
            if not begin_load.is_set():
                stop.set()
                begin_load.set()
    wall = time.monotonic() - started
    client_cpu = time.process_time() - client_before
    cpu_after = process_cpu_seconds(pid)
    profile_after = profiler.checkpoint() if profiler else None
    if identity != process_identity(pid):
        raise RuntimeError("Measured process identity changed during the stage")
    cpu = cpu_after - cpu_before if cpu_before is not None else None
    latencies = [value for values in samples.values() for value in values]
    count = len(latencies)
    warmup_failed = sum(value for key, value in errors.items() if key.startswith('warmup: '))
    return {"concurrency_http_workers": concurrency, "requested_seconds": seconds,
            "wall_seconds_including_drain": wall, "requests_attempted": requested,
            "requests_succeeded": count, "requests_failed": sum(errors.values()) - warmup_failed,
            "warmup_requests_failed": warmup_failed,
            "successful_requests_per_second": count / wall,
            "equivalent_refreshes_per_second": count / (wall * len(endpoints)),
            "response_bytes": sum(sizes.values()), "tcp_connections_opened_including_warmup": sum(connects),
            "warmup_requests_per_worker": len(endpoints),
            "latency_successful": distribution(latencies),
            "endpoints": {name: {**distribution(values), "response_bytes": sizes[name]} for name, values in samples.items()},
            "errors": dict(errors), "node_cpu_seconds": cpu,
            "node_cpu_percent_of_one_core": cpu / wall * 100 if cpu is not None else None,
            "node_cpu_ms_per_success_including_background": cpu * 1000 / count if cpu is not None and count else None,
            "client_cpu_seconds": client_cpu, "client_cpu_percent_of_one_core": client_cpu / wall * 100,
            "request_cap_reached": requested >= max_requests,
            "system_load_average_before": load_before, "system_load_average_after": os.getloadavg(),
            "cpu_profile_before": profile_before, "cpu_profile_after": profile_after,
            "cpu_profile_delta": profiler.delta(profile_before, profile_after) if profiler else None,
            "activity_before": bot_before, "activity_after": activity_status(status_file)}


def workloads(market, owner, authorization):
    query = urlencode({"market": market})
    return {
        "catalog": [Endpoint("markets", "/markets?limit=100", "markets")],
        "market": [Endpoint("market", f"/market?{query}", "market")],
        "book-bid": [Endpoint("book-bid", f"/book?{query}&bid=true&limit=200", "levels")],
        "book-ask": [Endpoint("book-ask", f"/book?{query}&bid=false&limit=200", "levels")],
        "public-refresh": [Endpoint("market", f"/market?{query}", "market"),
                           Endpoint("book-bid", f"/book?{query}&bid=true&limit=200", "levels"),
                           Endpoint("book-ask", f"/book?{query}&bid=false&limit=200", "levels")],
        "snapshot": [Endpoint("scoped-snapshot", f"/snapshot?{query}", "owner", authorization, owner)],
        "candles-hour": [Endpoint("candles-hour", f"/candles?{query}&interval=3600&limit=200", "candles")],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8089")
    parser.add_argument("--host", default="exchange.psibase.localhost:8089")
    parser.add_argument("--market", type=int, default=1)
    parser.add_argument("--workloads", default="public-refresh,snapshot")
    parser.add_argument("--concurrency", default="1,2,4,8,16")
    parser.add_argument("--seconds", type=float, default=10)
    parser.add_argument("--idle-seconds", type=float, default=3)
    parser.add_argument("--timeout", type=float, default=5)
    parser.add_argument("--max-requests", type=int, default=100000)
    parser.add_argument("--node-pid", type=int)
    parser.add_argument("--service-threads", type=int, help="Record the target's configured service worker count")
    parser.add_argument("--runtime-label", default="unspecified; inspect node_identity")
    parser.add_argument("--profile-log", type=Path)
    parser.add_argument("--profile-checkpoints", action='store_true', help="Explicitly request SIGUSR1 checkpoints from a verified profiling node only")
    parser.add_argument("--owner", default="alice")
    parser.add_argument("--authorization-file", type=Path)
    parser.add_argument("--activity-status-file", type=Path, default=ROOT / "demo/market-activity-status.json")
    parser.add_argument("--output", type=Path, default=ROOT / "build-app-regression/query-throughput.json")
    args = parser.parse_args(argv)
    url = urlsplit(args.base_url)
    try:
        local = ipaddress.ip_address(url.hostname).is_loopback
    except ValueError:
        local = url.hostname == "localhost"
    try:
        port = url.port or 80
    except ValueError:
        parser.error("Invalid target port")
    if url.scheme != "http" or not local or url.path not in ("", "/") or url.username or url.password or url.query or url.fragment or not 1 <= port <= 65535:
        parser.error("Benchmark target must be a loopback HTTP origin")
    concurrency = [int(value) for value in args.concurrency.split(",")]
    if not concurrency or any(not 1 <= value <= 64 for value in concurrency):
        parser.error("Concurrency must be1 to64 HTTP workers")
    if not 0 < args.seconds <= 15 or not 0 <= args.idle_seconds <= 15 or not 0 < args.timeout <= 10 or not 1 <= args.max_requests <= 1000000:
        parser.error("Use stages<=15s, idle<=15s, timeout<=10s and at most1million requests/stage")
    if not 1 <= args.market <= 2**64 - 1:
        parser.error("Invalid market ID")
    authorization = args.authorization_file.read_text().strip() if args.authorization_file else ""
    if len(authorization) > 16384 or any(c in authorization + args.host for c in "\r\n"):
        parser.error("Invalid authorization file or Host header")
    chosen = args.workloads.split(",")
    if "snapshot" in chosen and (not authorization.lower().startswith("bearer ") or not args.owner):
        parser.error("Snapshot requires --owner and a --authorization-file containing native Bearer authorization")
    available = workloads(args.market, args.owner, authorization)
    if any(name not in available for name in chosen):
        parser.error("Unknown workload; choose " + ",".join(available))
    identity = process_identity(args.node_pid)
    if bool(args.profile_log) != args.profile_checkpoints:
        parser.error('--profile-log and explicit --profile-checkpoints must be supplied together')
    profiler = ProfileCheckpoints(args.profile_log, args.node_pid) if args.profile_checkpoints else None
    report = {"started_at": time.time(), "target": args.base_url, "host": args.host,
              "market": args.market, "owner": args.owner if "snapshot" in chosen else None,
              "platform": platform.platform(), "python": platform.python_version(),
              "node_pid": args.node_pid, "node_identity": identity,
              "machine": machine_info(), "configured_service_threads": args.service_threads,
              "runtime_label": args.runtime_label,
              "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "cpu_profiling_enabled": bool(profiler),
              "cpu_source": ("Linux /proc process utime+stime ticks" if sys.platform.startswith("linux") else "ps cumulative process user+system CPU (0.01s reported resolution)") if args.node_pid else "not measured (no --node-pid)",
              "percentile_method": "nearest rank; successful requests only; low sample tail estimates are imprecise",
              "concurrency_definition": "HTTP workers with one reused connection each; mixed public refresh endpoints are round-robin, not parallel browser refreshes",
              "scope": "Warm loopback read-only HTTP. Node CPU includes all background work; no DB/WASM/native CPU attribution is inferred. Client process CPU is separate.",
              "preflight": {}, "workloads": [], "passed": False}
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        report["finished_at"] = time.time()
        temporary = args.output.with_name(args.output.name + f'.{os.getpid()}.tmp')
        temporary.write_text(json.dumps(report, indent=2) + "\n")
        temporary.replace(args.output)

    try:
        for name in chosen:
            endpoints = available[name]
            reader = Reader(args.base_url, args.host, args.timeout)
            try:
                for endpoint in endpoints:
                    report["preflight"][endpoint.name] = {"bytes": reader.get(endpoint), "path": endpoint.path}
                    value = reader.last_value
                    report['preflight'][endpoint.name]['row_counts'] = {
                        key: len(rows) for key, rows in value.items() if isinstance(rows, list)}
                    report['preflight'][endpoint.name]['coverage_complete'] = value.get('coverage_complete')
            finally:
                reader.close()
            before = idle_sample(args.node_pid, args.idle_seconds)
            result = {"name": name, "requests_per_equivalent_refresh": len(endpoints), "idle_before": before, "stages": []}
            report["workloads"].append(result)
            for count in concurrency:
                stage = benchmark_stage(args.base_url, args.host, endpoints, count, args.seconds,
                                        pid=args.node_pid, timeout=args.timeout, max_requests=args.max_requests,
                                        status_file=args.activity_status_file, profiler=profiler)
                result["stages"].append(stage)
                save()
                p = stage["latency_successful"]
                print(f"{name} c={count}: {stage['successful_requests_per_second']:.2f}successful req/s; p50={p['p50_ms']}ms p95={p['p95_ms']}ms; failures={stage['requests_failed']}", flush=True)
                if stage["requests_failed"] or stage['warmup_requests_failed']:
                    raise RuntimeError("Stage had failed/invalid responses; stopped before further load")
                if profiler and not stage['cpu_profile_delta']['valid']:
                    raise RuntimeError('Exclusive CPU bucket deltas did not balance; attribution invalid')
            after = idle_sample(args.node_pid, args.idle_seconds)
            result["idle_after"] = after
            if before["node_cpu_seconds_per_second"] is not None:
                baseline = (before["node_cpu_seconds_per_second"] + after["node_cpu_seconds_per_second"]) / 2
                for stage in result["stages"]:
                    # Negative estimates remain visible: background variance is
                    # evidence against pretending this is isolated query CPU.
                    incremental = stage["node_cpu_seconds"] - baseline * stage["wall_seconds_including_drain"]
                    stage["baseline_subtracted_node_cpu_seconds_estimate"] = incremental
                    stage["baseline_subtracted_cpu_ms_per_success_estimate"] = incremental * 1000 / stage["requests_succeeded"] if stage["requests_succeeded"] else None
            save()
        if process_identity(args.node_pid) != identity:
            raise RuntimeError("Node process changed during benchmark")
        report["passed"] = True
    except Exception as error:
        report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        save()
    print(f"Report: {args.output}", flush=True)


if __name__ == "__main__":
    main()
