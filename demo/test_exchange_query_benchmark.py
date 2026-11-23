"""Local HTTP fixtures only; no developer node, authorization, or funds."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import bench_exchange_queries as bench


class QueryBenchmarkTests(unittest.TestCase):
    def test_percentiles_are_nearest_rank_and_empty_samples_stay_unknown(self):
        values = list(range(1, 101))
        self.assertEqual(bench.percentile(values, .5), 50)
        self.assertEqual(bench.percentile(values, .95), 95)
        self.assertEqual(bench.percentile(values, .99), 99)
        self.assertIsNone(bench.distribution([])['p99_ms'])

    def test_json_wrappers_and_private_owner_are_checked(self):
        endpoint = bench.Endpoint('private', '/snapshot', 'owner', 'Bearer fixture', 'alice')
        valid = {'owner': 'alice', 'markets': [], 'levels': [], 'balances': []}
        self.assertEqual(endpoint.validate(json.dumps(json.dumps(valid)).encode()), valid)
        for body in (b'{"owner":"bob"}', b'{"owner":"alice"}', b'{"error":"denied"}', b'[]', b'not json'):
            with self.assertRaises(ValueError):
                endpoint.validate(body)
        with self.assertRaises(ValueError):
            bench.Endpoint('markets', '/markets', 'markets').validate(b'{"markets":null}')

    def test_process_cpu_parser_handles_days_hours_and_fractional_seconds(self):
        with patch.object(bench.sys, 'platform', 'darwin'), patch.object(bench.subprocess, 'check_output', return_value='1-02:03:04.50\n'):
            self.assertEqual(bench.process_cpu_seconds(123), 93784.5)
        self.assertIsNone(bench.process_cpu_seconds(None))

    def run_server(self, handler):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_port}'

    def test_bounded_get_load_reuses_connections_and_counts_valid_responses(self):
        seen = set()
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *_): pass
            def do_GET(self):
                seen.add((self.command, self.path, self.headers.get('Host')))
                body = b'{"markets":[]}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        url = self.run_server(Handler)
        result = bench.benchmark_stage(url, 'exchange.localhost', [bench.Endpoint('markets', '/markets', 'markets')], 2, .15, max_requests=100)
        self.assertGreater(result['requests_succeeded'], 0)
        self.assertEqual(result['requests_failed'], 0)
        self.assertLessEqual(result['requests_attempted'], 100)
        self.assertEqual(result['requests_succeeded'], result['requests_attempted'])
        self.assertEqual(result['tcp_connections_opened_including_warmup'], 2)
        self.assertEqual(seen, {('GET', '/markets', 'exchange.localhost')})

    def test_failed_warmup_is_recorded_without_saturating_or_counting_success(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                self.send_response(403)
                self.send_header('Content-Length', '0')
                self.end_headers()
        url = self.run_server(Handler)
        result = bench.benchmark_stage(url, 'exchange.localhost', [bench.Endpoint('snapshot', '/snapshot', 'owner')], 2, .15)
        self.assertEqual(result['requests_succeeded'], 0)
        self.assertEqual(result['requests_attempted'], 0)
        self.assertEqual(result['requests_failed'], 0)
        self.assertEqual(result['warmup_requests_failed'], 2)
        self.assertIsNone(result['latency_successful']['p50_ms'])

    def profile_fixture(self, directory, *, marker_pid=123, command='/sdk/psinode'):
        path = Path(directory) / 'node.log'
        path.write_text(bench.ProfileCheckpoints.ENABLED + json.dumps({
            'schema': 1, 'pid': marker_pid, 'process_start_unix_seconds': 500, 'signal': 'SIGUSR1'}) + '\n')
        patches = [patch.object(bench, 'process_identity', return_value='verified-identity'),
                   patch.object(bench, 'process_start_identity', return_value={'unix_seconds': 500, 'birth_id': '500:1234'}),
                   patch.object(bench.subprocess, 'check_output', return_value=command)]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        return path

    def test_profile_wrong_pid_or_command_never_receives_a_signal(self):
        for marker_pid, command in ((124, '/sdk/psinode'), (123, '/usr/bin/python')):
            with self.subTest(marker_pid=marker_pid, command=command), TemporaryDirectory() as directory:
                path = self.profile_fixture(directory, marker_pid=marker_pid, command=command)
                with patch.object(bench.os, 'kill') as kill:
                    with self.assertRaises(RuntimeError):
                        bench.ProfileCheckpoints(path, 123)
                    kill.assert_not_called()

    def test_profile_reused_pid_fails_before_signaling(self):
        with TemporaryDirectory() as directory:
            path = self.profile_fixture(directory)
            profiler = bench.ProfileCheckpoints(path, 123)
            with patch.object(bench, 'process_start_identity', return_value={'unix_seconds': 500, 'birth_id': '500:9999'}), patch.object(bench.os, 'kill') as kill:
                with self.assertRaises(RuntimeError):
                    profiler.checkpoint()
                kill.assert_not_called()

    def test_verified_profile_checkpoint_requires_closed_scopes_and_records_cpu(self):
        with TemporaryDirectory() as directory:
            path = self.profile_fixture(directory)
            profiler = bench.ProfileCheckpoints(path, 123)
            event = {'schema': 1, 'pid': 123, 'process_start_unix_seconds': 500, 'snapshot_seq': 1,
                     'active_scopes': 0, 'clock_errors': 0,
                     **{key: 100 for key in bench.ProfileCheckpoints.COUNTERS}}
            def respond(_pid, _signal):
                with path.open('a') as stream:
                    stream.write(bench.ProfileCheckpoints.PREFIX + json.dumps(event) + '\n')
            with patch.object(bench.os, 'kill', side_effect=respond) as kill:
                result = profiler.checkpoint()
                self.assertEqual(result['snapshot_seq'], 1)
                kill.assert_called_once_with(123, bench.signal.SIGUSR1)
                event.update(snapshot_seq=2, active_scopes=1)
                with self.assertRaisesRegex(RuntimeError, 'not quiescent'):
                    profiler.checkpoint()

    def test_cpu_bucket_percentages_use_process_cpu_not_elapsed_wall(self):
        before = dict.fromkeys(bench.ProfileCheckpoints.COUNTERS, 0)
        after = {**before, 'process_cpu_ns': 100, 'wasm_cpu_ns': 20,
                 'host_native_cpu_ns': 10, 'db_cpu_ns': 30, 'native_residual_cpu_ns': 40}
        result = bench.ProfileCheckpoints.delta(before, after)
        self.assertTrue(result['valid'])
        self.assertEqual(result['cpu_percentages']['db_cpu_ns'], 30)
        self.assertEqual(result['native_total_cpu_ns'], 50)
        self.assertEqual(result['three_way_cpu_percentages'], {'database': 30, 'wasm': 20, 'native': 50})
        after['native_residual_cpu_ns'] = 50000
        self.assertFalse(bench.ProfileCheckpoints.delta(before, after)['valid'])


if __name__ == '__main__':
    unittest.main()
