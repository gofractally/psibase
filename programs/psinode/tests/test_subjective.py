#!/usr/bin/python

from psinode import Cluster
from predicates import *
from threading import Thread
from threading import Event
import testutil
import unittest
import io
from fracpack import Int, unpack

def is_user_action(action):
    if action['service'] == 'db' and action['method'] == 'open':
        return False
    if action['service'] == 'cpu-limit':
        return False
    if action['service'] == 'accounts' and action['method'] == 'billCpu':
        return False
    if action['service'] == 'events' and action['method'] == 'sync':
        return False
    return True

def get_raw_retval(trace):
    expect_auth = True
    for t in trace['actionTraces'][-1]['innerTraces']:
        inner = t['inner']
        if 'ActionTrace' in inner:
            atrace = inner['ActionTrace']
            if is_user_action(atrace['action']):
                if not expect_auth:
                    return atrace['rawRetval']
                expect_auth = not expect_auth

def get_retval(trace, type):
    return unpack(bytes.fromhex(get_raw_retval(trace)), type)

class ThreadErrorHandler:
    def __init__(self):
        self.error = None
    def __call__(self, target, args):
        def wrapper(*args, **kw):
            try:
                return target(*args, **kw)
            except Exception as e:
                self.error = e
        return Thread(target=wrapper, args=args)
    def check(self):
        if self.error is not None:
            raise self.error

class TestSubjective(unittest.TestCase):
    @testutil.psinode_test
    def test_parallel(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.install(sources=[testutil.test_packages()], packages=['PSubjective'])
        a.wait(new_block())

        def parallel_query(fn):
            launcher = ThreadErrorHandler()
            threads = []

            nthreads = 4
            niter = 200
            values = []
            for i in range(nthreads):
                def tfn(api, out):
                    for i in range(niter):
                        out.append(fn(api))
                v = []
                values.append(v)
                threads.append(launcher(target=tfn, args=(a.new_api(),v)))

            for t in threads:
                t.start()
            for t in threads:
                t.join(10)
                if t.is_alive():
                    raise TimeoutError()

            launcher.check()

            all_values = []
            for v in values:
                all_values += v
                all_values.sort()
            return all_values

        def inc(api):
            with api.post('/inc', 'psubjective', json={}) as response:
                response.raise_for_status()
                return response.json()['value']

        values = parallel_query(inc)
        self.assertSequenceEqual(values, range(1, len(values)+1))

        def ge(api):
            with api.post('/ge', 'psubjective', json={}) as response:
                response.raise_for_status()
                return response.json()['key']

        u32max = 0xffffffff
        values = parallel_query(ge)
        self.assertSequenceEqual(values, range(u32max - len(values) + 1, u32max + 1))

    @testutil.psinode_test
    def test_parallel_with_tx(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.install(sources=[testutil.test_packages()], packages=['PSubjective', 'Counter'])
        a.wait(new_block())

        launcher = ThreadErrorHandler()
        nthreads = 4
        threads = []

        done = Event()
        values = []
        for i in range(nthreads):
            def tfn(api, out):
                while not done.is_set():
                    with api.post('/inc', 'psubjective', json={}) as response:
                        response.raise_for_status()
                        out.append(response.json()['value'])
            v = []
            values.append(v)
            threads.append(launcher(target=tfn, args=(a.new_api(),v)))

        for t in threads:
            t.start()

        for i in range(50):
            trace = a.push_action('counter', 'counter', 'inc', {"key":"", "id":i})
            self.assertEqual(get_retval(trace, Int(32, False)), i+1)

        done.set()

        for t in threads:
            t.join(timeout=10)
            if t.is_alive():
                raise TimeoutError()
        launcher.check()

        all_values = []
        for v in values:
            all_values += v
        all_values.sort()
        self.assertSequenceEqual(all_values, range(1, len(all_values) + 1))

if __name__ == '__main__':
    testutil.main()
