#!/usr/bin/python

from psinode import Cluster
from predicates import *
from threading import Thread
from threading import Event
import testutil
import unittest
import io
from fracpack import Int

def is_user_action(action):
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
    return type.unpack(io.BytesIO(bytes.fromhex(get_raw_retval(trace))))

class TestSubjective(unittest.TestCase):
    @testutil.psinode_test
    def test_parallel(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.run_psibase(['install', '--package-source', testutil.test_packages(), 'PSubjective'])
        a.wait(new_block())

        threads = []

        nthreads = 4
        niter = 200
        values = []
        for i in range(nthreads):
            def tfn(api, out):
                for i in range(niter):
                    with api.post('/inc', 'psubjective', json={}) as response:
                        response.raise_for_status()
                        out.append(response.json()['value'])
            v = []
            values.append(v)
            threads.append(Thread(target=tfn, args=(a.new_api(),v)))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        all_values = []
        for v in values:
            all_values += v
        all_values.sort()
        self.assertSequenceEqual(all_values, range(1, nthreads*niter+1))

    @testutil.psinode_test
    def test_parallel_with_tx(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.run_psibase(['install', '--package-source', testutil.test_packages(), 'PSubjective', 'Counter'])
        a.wait(new_block())

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
            threads.append(Thread(target=tfn, args=(a.new_api(),v)))

        for t in threads:
            t.start()

        for i in range(50):
            trace = a.push_action('counter', 'counter', 'inc', {"key":"", "id":i})
            self.assertEqual(get_retval(trace, Int(32, False)), i+1)

        done.set()

        for t in threads:
            t.join()

        all_values = []
        for v in values:
            all_values += v
        all_values.sort()
        self.assertSequenceEqual(all_values, range(1, len(all_values) + 1))

if __name__ == '__main__':
    testutil.main()
