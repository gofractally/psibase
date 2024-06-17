#!/usr/bin/python

from psinode import Cluster
from predicates import *
from threading import Thread
import testutil
import unittest

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

if __name__ == '__main__':
    testutil.main()
