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

        # The default page is served only when the client weighs text/html above text/plain
        for accept in ['TEXT/HTML', 'text/html;q=0.9, text/plain;q=0.5', 'text/plain;q=0.5, text/*;q=0.8, text/html']:
            self.assertDefaultPage(a.get('/', 'baz', headers={'Accept': accept}))
        for accept in [None, '', '*/*', 'text/*', 'text/html;q=0', 'text/html;q=0, */*', 'text/html, text/plain', 'text/plain, text/html;q=0.5', 'text/html;q=0.000, text/*;q=0.1']:
            self.assertPlainNotFound(a.get('/', 'baz', headers={'Accept': accept}), '/')

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

    @testutil.psinode_test
    def test_content_named_urls(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites'])

        apps = TestPackage('Apps', '1.0.0').depends('Sites')
        apps.service('foo', data={
            'index.html': 'foo home',
            'plugin.wasm': 'foo plugin',
            'assets/index-DiwrgTda.js': 'foo script',
            'assets/style-AgyV-iFx.css': 'foo hashed style',
            'assets/index-D_ZJrvOo.js': 'foo other script',
            'assets/logo.svg': 'foo logo',
            'assets/long-filename.css': 'foo style',
            'other/index-DiwrgTda.js': 'foo other',
        })

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [apps])
            a.install(['Apps'], sources=[dir])
        a.wait(new_block())

        FOREVER = 'max-age=31536000, immutable'

        # A plain URL is checked with the server every time
        with a.get('/plugin.wasm', 'foo') as reply:
            reply.raise_for_status()
            self.assertEqual(reply.headers['Cache-Control'], 'no-cache')
            etag = reply.headers['ETag']
        with a.get('/plugin.wasm', 'foo', headers={'If-None-Match': etag}) as reply:
            self.assertEqual(reply.status_code, 304)
            self.assertEqual(reply.headers['Cache-Control'], 'no-cache')

        # The same file asked for by its hash can be kept
        with a.get('/plugin.wasm?v=' + etag, 'foo') as reply:
            reply.raise_for_status()
            self.assertEqual(reply.text, 'foo plugin')
            self.assertEqual(reply.headers['Cache-Control'], FOREVER)
            self.assertEqual(reply.headers['ETag'], etag)
        with a.get('/plugin.wasm?v=' + etag, 'foo', headers={'If-None-Match': etag}) as reply:
            self.assertEqual(reply.status_code, 304)
            self.assertEqual(reply.headers['Cache-Control'], FOREVER)

        # A hash that is not the content's is answered with the content, to be checked again
        for v in ['0' * 16, etag[:-1], etag + '0', '']:
            with a.get('/plugin.wasm?v=' + v, 'foo') as reply:
                reply.raise_for_status()
                self.assertEqual(reply.text, 'foo plugin')
                self.assertEqual(reply.headers['Cache-Control'], 'no-cache')

        # A bundler's hashed file name under assets/ can be kept; other names can not
        for path in ['/assets/index-DiwrgTda.js', '/assets/style-AgyV-iFx.css', '/assets/index-D_ZJrvOo.js']:
            with a.get(path, 'foo') as reply:
                reply.raise_for_status()
                self.assertEqual(reply.headers['Cache-Control'], FOREVER, path)
        for path in ['/assets/logo.svg', '/assets/long-filename.css', '/other/index-DiwrgTda.js', '/']:
            with a.get(path, 'foo') as reply:
                reply.raise_for_status()
                self.assertEqual(reply.headers['Cache-Control'], 'no-cache', path)

        # A missing hashed name is not found, and nothing about it is kept
        with a.get('/assets/index-Zzzzzzz9.js', 'foo') as reply:
            self.assertEqual(reply.status_code, 404)
            self.assertNotEqual(reply.headers.get('Cache-Control'), FOREVER)

    @testutil.psinode_test
    def test_tokens_transfer_prompt(self, cluster):
        # An app's transfer is confirmed on a page of the tokens site, shown by the supervisor
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['DevDefault'])
        a.wait(new_block())
        for path in ['/plugin/web/prompt/transfer', '/plugin/web/prompt/transfer/index.html']:
            with a.get(path, 'tokens') as reply:
                reply.raise_for_status()
                self.assertIn('wallet-assets/transfer.mjs', reply.text)
                policy = reply.headers['Content-Security-Policy']
                self.assertRegex(policy, r"frame-ancestors 'self' supervisor\.[^;{]+;", path)
        for path in ['/wallet-assets/transfer.mjs', '/wallet-assets/transfer.css', '/wallet-assets/common-lib.js']:
            with a.get(path, 'tokens') as reply:
                reply.raise_for_status()

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

    def assertDefaultPage(self, response):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers.get('Vary'), 'Accept')
        self.assertNotIn('ETag', response.headers)
        self.assertIn(DEFAULT_PAGE_MARKER, response.text)

    def assertPlainNotFound(self, response, path):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.text, "The resource '%s' was not found" % path)

if __name__ == '__main__':
    testutil.main()
