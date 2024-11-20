#!/usr/bin/python

from predicates import *
import testutil
import unittest
import os
from fracpack import *
from psibase import *
from threading import Thread
from requests import ConnectionError

def node_args(self):
    return ['-a', self.url, '--proxy', 'unix:' + self.socketpath]
# This test is most useful when run with ASAN_OPTIONS=abort_on_error=1
class TestExceptionExit(unittest.TestCase):
    @testutil.psinode_test
    def test_socket(self, cluster):
        (a,) = cluster.complete('a')
        a.boot(packages=['Minimal', 'Explorer'])
        a.run_psibase(['install'] + node_args + ['--package-source', testutil.test_packages(), 'KeepSocket'])
        a.wait(new_block())

        def long_query(api):
            try:
                api.get('/', service='s-keep-sock')
            except ConnectionError:
                pass

        t = Thread(target=long_query, args=(a.new_api(),))
        t.start()
        a.push_action('transact', 'setcode', 'setcode', {"service":"transact","vmType":0, "vmVersion":0, "code": "DEADBEEF"})
        t.join()

        code = a.child.wait(timeout=10)
        self.assertEqual(code, 1)

if __name__ == '__main__':
    testutil.main()
