#!/usr/bin/python

from psinode import Cluster
import testutil
import predicates
import unittest
from services import *
import requests
import os
import socket

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
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()

        name = testutil.generate_names(1)[0]
        a = cluster.make_node(name, listen=['127.0.0.1:%d' % port], start=False)
        auth_dir = os.path.join(a.dir, 'auth')
        os.makedirs(auth_dir, exist_ok=True)
        passwd_path = os.path.join(auth_dir, 'passwd')
        with open(passwd_path, 'w') as f:
            f.write(_PASSWD_LINE)
        with open(os.path.join(a.dir, 'config'), 'a') as f:
            f.write('mount = %s\n' % auth_dir)
        a.env['PSIBASE_PASSWD_FILE'] = passwd_path
        a.start()

        with a.get('/native/admin/status', service='x-admin') as reply:
            reply.raise_for_status()
            self.assertIn('needgenesis', reply.json())

        url = 'http://127.0.0.1:%d/native/admin/status' % port
        headers = {'Host': 'x-admin.psibase.localhost'}
        unauthenticated = requests.get(url, headers=headers)
        self.assertEqual(unauthenticated.status_code, 401)
        challenge = unauthenticated.headers.get('WWW-Authenticate', '')
        self.assertTrue(challenge.startswith('Basic '))

        authenticated = requests.get(url, headers=headers, auth=('e2e-admin', 'testpw'))
        self.assertEqual(authenticated.status_code, 200)
        self.assertIn('needgenesis', authenticated.json())

if __name__ == '__main__':
    testutil.main()
