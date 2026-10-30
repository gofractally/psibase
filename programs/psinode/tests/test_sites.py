#!/usr/bin/python

from predicates import *
from test_psibase import TestPackage, make_package_repository
import testutil
import tempfile
import unittest

DEFAULT_PAGE_MARKER = '/common/default-pages/page.js'

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

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [apps])
            a.install(['Apps'], sources=[dir])
        a.push_action('qux', 'sites', 'setProxy', {'proxy': 'bar'})
        a.wait(new_block())

        # Page requests on accounts without an index get the default page
        for (path, account) in [('/', 'baz'), ('/a/route', 'baz'), ('/page.html', 'baz'), ('/', 'bar'), ('/', 'nosuchacct')]:
            self.assertDefaultPage(a.get(path, account))

        # Other files never get the default page
        for (path, account) in [('/style.css', 'baz'), ('/plugin.wasm', 'baz'), ('/other.wasm', 'baz'), ('/x.wasm', 'nosuchacct'), ('/common/nope', 'baz')]:
            self.assertPlainNotFound(a.get(path, account), path)

        # An account's own content takes precedence, and the default page's assets can't conflict with it
        self.assertResponse(a.get('/about.html', 'bar'), 'bar about')
        self.assertResponse(a.get('/style.css', 'bar'), 'bar css')
        with a.get('/common/default-pages/style.css', 'bar') as reply:
            reply.raise_for_status()
            self.assertNotEqual(reply.text, 'bar css')

        # Accounts with an index or a proxy handle their own misses
        self.assertResponse(a.get('/', 'foo'), 'foo home')
        self.assertPlainNotFound(a.get('/missing', 'foo'), '/missing')
        self.assertPlainNotFound(a.get('/', 'qux'), '/')
        self.assertResponse(a.get('/about.html', 'qux'), 'bar about')

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

    def assertDefaultPage(self, response):
        self.assertEqual(response.status_code, 404)
        self.assertIn(DEFAULT_PAGE_MARKER, response.text)

    def assertPlainNotFound(self, response, path):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.text, "The resource '%s' was not found" % path)

if __name__ == '__main__':
    testutil.main()
