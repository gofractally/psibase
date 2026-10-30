#!/usr/bin/python

from predicates import *
from test_psibase import TestPackage, make_package_repository
import testutil
import tempfile
import unittest

class TestSites(unittest.TestCase):
    @testutil.psinode_test
    def test_default_site(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites'])

        default_page = TestPackage('DefaultPage', '1.0.0').depends('Sites').service('acct-404', data={'index.html': 'landing', '404.html': 'missing', 'style.css': 'css'})
        apps = TestPackage('Apps', '1.0.0').depends('Sites')
        apps.service('foo', data={'index.html': 'foo home'})
        apps.service('bar', data={'file.txt': 'bar file'})
        apps.service('baz')
        apps.service('qux')

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [default_page, apps])
            a.install(['Apps'], sources=[dir])
            a.push_action('qux', 'sites', 'setProxy', {'proxy': 'bar'})
            a.wait(new_block())

            self.assertNotFound(a.get('/', 'baz'), "The resource '/' was not found")

            a.install(['DefaultPage'], sources=[dir])
            a.wait(new_block())

        # Existing accounts without an index fall back to the default index
        for path in ['/', '/a/route', '/page.html']:
            self.assertResponse(a.get(path, 'baz'), 'landing')
        self.assertResponse(a.get('/style.css', 'baz'), 'css')
        self.assertEqual(a.get('/plugin.wasm', 'baz').status_code, 404)
        self.assertEqual(a.get('/favicon.ico', 'baz').status_code, 404)

        # An account's own content takes precedence
        self.assertResponse(a.get('/', 'bar'), 'landing')
        self.assertResponse(a.get('/file.txt', 'bar'), 'bar file')

        # Accounts with an index don't fall back
        self.assertResponse(a.get('/', 'foo'), 'foo home')
        self.assertEqual(a.get('/style.css', 'foo').status_code, 404)

        # Accounts with a proxy don't fall back
        self.assertEqual(a.get('/', 'qux').status_code, 404)
        self.assertResponse(a.get('/file.txt', 'qux'), 'bar file')

        # Accounts that don't exist get the 404 page
        self.assertNotFound(a.get('/', 'nosuchacct'), 'missing')
        self.assertNotFound(a.get('/index.html', 'nosuchacct'), 'missing')
        self.assertResponse(a.get('/style.css', 'nosuchacct'), 'css')

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

    def assertNotFound(self, response, expected):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.text, expected)

if __name__ == '__main__':
    testutil.main()
