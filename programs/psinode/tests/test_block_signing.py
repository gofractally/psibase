#!/usr/bin/python

from psinode import Cluster
from predicates import *
import testutil
import unittest

class TestBlockSigning(unittest.TestCase):
    @testutil.psinode_test
    def test_missing_key(self, cluster):
        prods = cluster.complete(*testutil.generate_names(4))

        print("booting chain")
        prods[0].boot(packages=['Minimal', 'Explorer'])

        print("Setting up automatic reconnection")
        with prods[3].get('/native/admin/config', service='x-admin') as reply:
            reply.raise_for_status()
            cfgd = reply.json()
        print(cfgd)
        cfgd["peers"] = [prods[0].socketpath, prods[1].socketpath, prods[2].socketpath]
        print(cfgd)
        with prods[3].put('/native/admin/config', service='x-admin', headers={'Content-Type': 'application/json'}, json=cfgd) as reply:
            reply.raise_for_status()

        print("setting producers")
        prods[0].set_producers([prods[0], prods[1], prods[2], {"name":prods[3].producer,"auth":{"service":"verify-sig", "rawData":"3059301306072a8648ce3d020106082a8648ce3d0301070342000457ba94147759d2ec5691a669da54ccb7e6a2852fad0cbcc31814b20cdf3e995966e680f22c3f57ee7386ffe7d14fead13757d52db02a95b563ae0932f17fbe27"}}], 'bft')

        prods[3].wait(producers_are(prods))
        prods[3].wait(new_block(), timeout=20)

if __name__ == '__main__':
    testutil.main()
