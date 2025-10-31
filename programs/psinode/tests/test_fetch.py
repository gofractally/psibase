#!/usr/bin/python

import testutil
import unittest
import os
from services import XAdmin

class TestFetch(unittest.TestCase):
    @testutil.psinode_test
    def test_proxy(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        with a.post('/set_origin_server', service='x-proxy', json={"host":"x-admin.%s" % a.hostname, "endpoint": a.socketpath}) as reply:
            reply.raise_for_status()

        with a.get('/config', service='x-proxy') as reply:
            reply.raise_for_status()
            cfg = reply.json()

        self.assertEqual(cfg, XAdmin(a).get_config())

if __name__ == '__main__':
    testutil.main()
