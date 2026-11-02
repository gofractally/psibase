#!/usr/bin/python

from psinode import Cluster
import testutil
import predicates
import unittest
from services import *
import requests
import os

# bcrypt hash of "testpw" (cost 5), generated offline for PSIBASE_PASSWD_FILE
_PASSWD_LINE = 'e2e-admin:$2b$05$ZCnZ2vibcbOrfGpwO2HE.OVNRP2O8WjIu9UJguhGy73SkRHKyFvyq\n'

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

    @testutil.psinode_test
    def test_login(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        xadmin = XAdmin(a)
        transact = Transact(a)
        a.boot(packages=['Minimal', 'Explorer'])
        token = xadmin.admin_login()
        with self.assertRaises(requests.HTTPError):
            transact.get_jwt_key('swordfish')
        key = transact.get_jwt_key(token)

    @testutil.psinode_test
    def test_native(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        with a.get('/native/admin/config', service='foo') as reply:
            self.assertEqual(reply.status_code, 404)

    @testutil.psinode_test
    def test_needgenesis_basic_auth(self, cluster):
        name = testutil.generate_names(1)[0]
        a = cluster.make_node(name, start=False)
        auth_dir = os.path.join(a.dir, 'auth')
        os.makedirs(auth_dir, exist_ok=True)
        passwd_path = os.path.join(auth_dir, 'passwd')
        with open(passwd_path, 'w') as f:
            f.write(_PASSWD_LINE)
        config_path = os.path.join(a.dir, 'config')
        with open(config_path) as f:
            config = f.read()
        marker = '[logger.stderr]'
        self.assertIn(marker, config)
        with open(config_path, 'w') as f:
            f.write(config.replace(marker, 'mount = %s\n\n%s' % (auth_dir, marker), 1))
        a.env['PSIBASE_PASSWD_FILE'] = passwd_path
        a.start()

        with a.get('/native/admin/status', service='x-admin') as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertIn('needgenesis', reply.json())

        forwarded = {'X-Forwarded-For': '192.168.0.1'}
        with a.get('/native/admin/status', service='x-admin', headers=forwarded) as reply:
            self.assertEqual(reply.status_code, 401)
            challenge = reply.headers.get('WWW-Authenticate', '')
            self.assertTrue(challenge.startswith('Basic '))

        with a.get('/native/admin/status', service='x-admin', headers=forwarded, auth=('e2e-admin', 'testpw')) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertIn('needgenesis', reply.json())

if __name__ == '__main__':
    testutil.main()
