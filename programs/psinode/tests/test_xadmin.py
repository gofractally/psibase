#!/usr/bin/python

from psinode import Cluster
import testutil
import predicates
import unittest
from services import XAdmin
import requests

class TestXAdmin(unittest.TestCase):
    @testutil.psinode_test
    def test_permissions(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        xadmin = XAdmin(a)

        self.assertEqual(xadmin.get_admin_accounts(), [])

        config = xadmin.get_config()
        config["admin_authz"] = []
        xadmin.set_config(config)

        with self.assertRaises(requests.HTTPError):
            xadmin.get_admin_accounts()

if __name__ == '__main__':
    testutil.main()
