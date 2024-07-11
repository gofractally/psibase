#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
import psinode
from threading import Thread, Event

class TestQuery(unittest.TestCase):
    @testutil.psinode_test
    def test_(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.run_psibase(['install', '--package-source', testutil.test_packages(), 'AsyncQuery'])
        a.wait(new_block())

        with a.post('/send_async_and_abort', service='as-query', json={"i":0}) as reply:
            if reply.status_code != 500:
                self.assertEqual(reply.json(), {"i":0})
        with a.post('/send?delay=1', service='as-query', json={"i":1}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"i":1})

if __name__ == '__main__':
    testutil.main()
