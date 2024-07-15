#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
import psinode
from threading import Thread, Event

def parallel(api, *args):
    threads = []
    result = [None]*len(args)
    def tfn(f, a, i):
        result[i] = f(a)
    for (i,f) in enumerate(args):
        threads.append(Thread(target=tfn, args=(f,api.new_api(),i)))
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return result

def do_post(api, target, data):
    with api.post(target, service='as-query', json=data) as reply:
        if reply.status_code == 200:
            return reply.json()
        else:
            return '%d: %s' % (reply.status_code, reply.text)

def post_parallel(api, *targets):
    def fn(t, d):
        return lambda a: do_post(a, t, d)
    return parallel(api, *(fn(t, d) for (t,d) in targets))

class TestQuery(unittest.TestCase):
    @testutil.psinode_test
    def test_(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        a.run_psibase(['install', '--package-source', testutil.test_packages(), 'AsyncQuery'])
        a.wait(new_block())

        # Basic normal usage
        with a.post('/send', service='as-query', json={"t":"send"}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"t":"send"})
        with a.post('/send_async', service='as-query', json={"t":"async"}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"t":"async"})

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
        with a.post('/send_and_abort_async', service='as-query', json={"i":3}) as reply:
            self.assertEqual(reply.status_code, 500)
            self.assertEqual(reply.text, "service 'as-query' aborted with message: test send and abort async")

        # A response takes precedence over abort
        with a.post('/send_and_abort', service='as-query', json={"t":"send-abort"}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"t":"send-abort"})
        with a.post('/send_async_and_abort', service='as-query', json={"t":"send-async-abort"}) as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), {"t":"send-async-abort"})

        # Check that a single callback can produce multiple responses
        (r0, r1) = post_parallel(a, ('/send_async', {"i":4}), ('/send_async', {"i":5}))
        self.assertEqual(r0, {"i":4})
        self.assertEqual(r1, {"i":5})

        # Test queries that cause retries
        (r0, r1) = post_parallel(a, ('/send_with_contention', {"i":6}), ('/send_with_contention', {"i":7}))
        self.assertEqual(r0, {"i":6})
        self.assertEqual(r1, {"i":7})

if __name__ == '__main__':
    testutil.main()
