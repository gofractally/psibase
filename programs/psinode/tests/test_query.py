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

        # Check that native and wasm maintain a consistent view of the socket's availability
        with a.post('/send_async_and_abort', service='as-query', json={"i":0}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"i":0})
        with a.post('/send?delay=1', service='as-query', json={"i":1}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"i":1})

        # Check that the abort message is preserved
        with a.post('/abort', service='as-query', json={"i":2}) as reply:
            self.assertEqual(reply.status_code, 500)
            self.assertEqual(reply.text, "service 'as-query' aborted with message: test abort")
        with a.post('/send_and_abort_async', service='as-query', json={"i":2}) as reply:
            self.assertEqual(reply.status_code, 500)
            self.assertEqual(reply.text, "service 'as-query' aborted with message: test send and abort async")

if __name__ == '__main__':
    testutil.main()
