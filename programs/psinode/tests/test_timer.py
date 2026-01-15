#!/usr/bin/python

import testutil
import unittest
import os
import time
import threading
from services import XAdmin

class TestTimer(unittest.TestCase):
    @testutil.psinode_test
    def test_timer(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XDelay.psi"))

        before = time.monotonic_ns()
        with a.get('/wait?seconds=1', service='x-delay') as reply:
            reply.raise_for_status()
            after = time.monotonic_ns()
            print("elapsed time: %g" % ((after - before)/1e9))
            self.assertGreaterEqual(after - before, 1000000000)

        before = time.monotonic_ns()
        with a.get('/wait?seconds=1', service='x-delay') as reply:
            reply.raise_for_status()
            after = time.monotonic_ns()
            print("elapsed time: %g" % ((after - before)/1e9))
            self.assertGreaterEqual(after - before, 1000000000)

        numThreads = 3
        results = [0] * numThreads
        threads = []
        for i in range(numThreads):
            def run(i):
                start = time.monotonic_ns()
                with a.get('/wait?seconds=%d' % (i + 1), service='x-delay') as reply:
                    reply.raise_for_status()
                    results[i] = time.monotonic_ns() - start
            threads.append(threading.Thread(target=run, args=(i,)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        for i in range(3):
            print("elapsed time: %g" % (results[i]/1e9))
            self.assertGreaterEqual(results[i], (i + 1) * 1000000000)

if __name__ == '__main__':
    testutil.main()
