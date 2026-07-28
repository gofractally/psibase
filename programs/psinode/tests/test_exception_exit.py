#!/usr/bin/python

from predicates import *
import testutil
import unittest
import os
from fracpack import *
from psibase import *
from threading import Thread
from requests import ConnectionError

# Since this test stops psinode with an error, we want
# sanitizer errors to cause a signal instead to fail the test.
ENV = {'ASAN_OPTIONS': 'abort_on_error=1'}

class TestExceptionExit(unittest.TestCase):
    @testutil.psinode_test
    def test_socket(self, cluster):
        (a,) = cluster.complete('a', env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.install(packages=['KeepSocket'], sources=[testutil.test_packages()])
        a.wait(new_block())

        def long_query(api):
            try:
                api.get('/', service='s-keepsock')
            except ConnectionError:
                pass

        t = Thread(target=long_query, args=(a.new_api(),))
        t.start()
        self.cause_exception(a)
        t.join()

    @testutil.psinode_test
    def test_incoming_p2p(self, cluster):
        (a, b) = cluster.disconnected(*testutil.generate_names(2), env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        b.connect(a)
        b.wait(new_block())
        self.cause_exception(a)

    @testutil.psinode_test
    def test_outgoing_p2p(self, cluster):
        (a, b) = cluster.disconnected(*testutil.generate_names(2), env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.connect(b)
        b.wait(new_block())
        self.cause_exception(a)

    def cause_exception(self, node):
        try:
            node.push_action('transact', 'setcode', 'setcode', {"service":"transact","vmType":0, "vmVersion":0, "code": "DEADBEEF"})
        except ConnectionError:
            pass

        code = node.child.wait(timeout=10)
        self.assertEqual(code, 1)

if __name__ == '__main__':
    testutil.main()
