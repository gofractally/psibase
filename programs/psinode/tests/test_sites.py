#!/usr/bin/python

from predicates import *
from test_psibase import TestPackage, make_package_repository
import testutil
import json
import tempfile
import unittest

DEFAULT_PAGE_MARKER = '/common/default-pages/page.js'
NAVIGATE = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}
STYLESHEET = {'Accept': 'text/css,*/*;q=0.1'}

class TestSites(unittest.TestCase):
    @testutil.psinode_test
    def test_default_page(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites'])

        apps = TestPackage('Apps', '1.0.0').depends('Sites')
        apps.service('foo', data={'index.html': 'foo home'})
        apps.service('bar', data={'about.html': 'bar about', 'style.css': 'bar css'})
        apps.service('baz')
        apps.service('qux')
        apps.add_file('script/postinstall.json', json.dumps([
            {'sender': 'qux', 'service': 'sites', 'method': 'setProxy', 'data': {'proxy': 'bar'}},
        ]))

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [apps])
            a.install(['Apps'], sources=[dir])
        a.wait(new_block())

        # Browser navigations on accounts without an index get the default page
        for (path, account) in [('/', 'baz'), ('/a/route', 'baz'), ('/page.html', 'baz'), ('/notes.txt', 'baz'), ('/', 'bar'), ('/', 'nosuchacct')]:
            self.assertDefaultPage(a.get(path, account, headers=NAVIGATE))

        # Subresources, fetch(), and CLI clients never get the default page
        for (path, account) in [('/', 'baz'), ('/a/route', 'baz'), ('/plugin.wasm', 'baz'), ('/', 'nosuchacct'), ('/x.wasm', 'nosuchacct')]:
            self.assertPlainNotFound(a.get(path, account), path)
        self.assertPlainNotFound(a.get('/style.css', 'baz', headers=STYLESHEET), '/style.css')
        self.assertPlainNotFound(a.get('/common/nope', 'baz', headers=NAVIGATE), '/common/nope')

        # An account's own content takes precedence, and the default page's assets can't conflict with it
        self.assertResponse(a.get('/about.html', 'bar', headers=NAVIGATE), 'bar about')
        self.assertResponse(a.get('/style.css', 'bar'), 'bar css')
        with a.get('/common/default-pages/style.css', 'bar') as reply:
            reply.raise_for_status()
            self.assertNotEqual(reply.text, 'bar css')

        # Accounts with an index or a proxy handle their own misses
        self.assertResponse(a.get('/', 'foo', headers=NAVIGATE), 'foo home')
        self.assertPlainNotFound(a.get('/missing', 'foo', headers=NAVIGATE), '/missing')
        self.assertPlainNotFound(a.get('/', 'qux', headers=NAVIGATE), '/')
        self.assertResponse(a.get('/about.html', 'qux', headers=NAVIGATE), 'bar about')

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

    def assertDefaultPage(self, response):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers.get('Vary'), 'Accept')
        self.assertIn(DEFAULT_PAGE_MARKER, response.text)

    def assertPlainNotFound(self, response, path):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.text, "The resource '%s' was not found" % path)

if __name__ == '__main__':
    testutil.main()
