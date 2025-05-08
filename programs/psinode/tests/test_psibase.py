#!/usr/bin/python

from psinode import Cluster, PrivateKey
from predicates import *
from services import *
import testutil
import time
import json
import zipfile
import tempfile
import requests
import hashlib
import unittest
import os
from io import TextIOWrapper
import subprocess

class TestPackage:
    def __init__(self, name, version, accounts=None, depends=None, description=None):
        if accounts is None:
            accounts = []
        if depends is None:
            depends = []
        if description is None:
            description = "Test package"
        self.name = name
        self.version = version
        self.description = description
        self.accounts = accounts
        self._depends = depends
        self.files = dict()
    def depends(self, name, version='*'):
        self._depends.append({'name': name, 'version': version})
        return self
    def service(self, name, wasm=None, flags=[], server=None, data=[]):
        if wasm is not None:
            self.add_file('service/' + name + '.wasm', wasm)
            if len(flags) != 0 or server is not None:
                self.add_file('service/' + name + '.json', json.dumps({'flags': flags, 'server': server}))
        def make_data(filename):
            if not filename.startswith('/'):
                filename = '/' + filename
            return 'data/' + name + filename
        if isinstance(data, dict):
            for (filename, contents) in data.items():
                self.add_file(make_data(filename), contents)
        else:
            for d in data:
                if isinstance(d, str):
                    self.add_file(make_data(d))
                else:
                    self.add_file(make_data(d[0]), d[1])
        if name not in self.accounts:
            self.accounts.append(name)
        return self
    def add_file(self, name, contents=None):
        if contents is None:
            contents = "contents for " + name
        self.files[name] = contents
    def filename(self):
        return self.name + '-' + self.version + '.psi'
    def write(self, directory):
        filename = self.filename()
        package_filename = os.path.join(directory, filename)
        meta = {'name': self.name, 'version': self.version, 'description': self.description, 'depends': self._depends, 'accounts': self.accounts}
        with zipfile.ZipFile(package_filename, 'w', zipfile.ZIP_DEFLATED) as archive:
            with archive.open('meta.json', 'w') as file:
                json.dump(meta, TextIOWrapper(file, encoding='utf-8'))
            for (name, contents) in self.files.items():
                with archive.open(name, 'w') as file:
                    if isinstance(contents, str):
                        with TextIOWrapper(file, encoding='utf-8') as wrapper:
                            wrapper.write(contents)
                    else:
                        file.write(contents)

        hash = hashlib.sha256()
        with open(package_filename, "rb") as file:
            meta['sha256'] = hashlib.sha256(file.read()).hexdigest()
        meta['file'] = filename
        return meta

def make_package_repository(directory, packages):
    index = []
    for package in packages:
        index.append(package.write(directory))
    with open(os.path.join(directory, 'index.json'), 'w') as file:
        file.write(json.dumps(index))

class Foo:
    def __init__(self):
        self.foo10 = TestPackage('foo', '1.0.0', description='The original foo').depends('Sites').service('foo', data={'file1.txt': 'original', 'file2.txt': 'deleted'})
        self.foo11 = TestPackage('foo', '1.1.0', description='Minor version update').depends('Sites').service('foo', data={'file1.txt': 'updated', 'file3.txt': 'added'})
        self.foo20 = TestPackage('foo', '2.0.0', description='Major version update').depends('Sites').service('foo', data={'file1.txt': 'version 2'})

        # These just need to be valid and distinct
        self.original_wasm = bytes.fromhex('0061736d01000000010a0260017e0060027e7e000303020001071d0305737461727400000663616c6c65640001086f726967696e616c00000a070202000b02000b');
        self.updated_wasm = bytes.fromhex('0061736d01000000010a0260017e0060027e7e000303020001071c0305737461727400000663616c6c65640001077570646174656400000a070202000b02000b')
        self.deleted_wasm = bytes.fromhex('0061736d01000000010a0260017e0060027e7e000303020001071c0305737461727400000663616c6c656400010764656c6574656400000a070202000b02000b')
        self.added_wasm = bytes.fromhex('0061736d01000000010a0260017e0060027e7e000303020001071a0305737461727400000663616c6c6564000105616464656400000a070202000b02000b')

        self.foo10.service('bar1', wasm=self.original_wasm, flags=['allowWriteNative'])
        self.foo10.service('bar2', wasm=self.deleted_wasm, flags=['allowSudo'], server='bar1')
        self.foo11.service('bar1', wasm=self.updated_wasm)
        self.foo11.service('bar2', data={'file4.txt': 'cancel server'})
        self.foo11.service('bar3', wasm=self.added_wasm)

class TestPsibase(unittest.TestCase):
    @testutil.psinode_test
    def test_install(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])
        a.run_psibase(['install'] + a.node_args() + ['Symbol', 'Tokens', 'TokenUsers'])
        a.wait(new_block())
        a.graphql('tokens', '''query { userBalances(user: "alice") { edges { node { symbolId tokenId balance precision { value } } } } }''')

    @testutil.psinode_test
    def test_install_upgrade(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites', 'BrotliCodec'])

        foo = Foo()

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [foo.foo10])
            a.run_psibase(['install'] + a.node_args() + ['foo', '--package-source', dir])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'original')
            self.assertResponse(a.get('/file2.txt', 'foo'), 'deleted')
            make_package_repository(dir, [foo.foo10, foo.foo11])
            a.run_psibase(['install'] + a.node_args() + ['foo', '--package-source', dir])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'updated')
            self.assertEqual(a.get('/file2.txt', 'foo').status_code, 404)
            self.assertResponse(a.get('/file3.txt', 'foo'), 'added')
            self.assertResponse(a.get('/file4.txt', 'bar2'), 'cancel server')

    def do_test_upgrade(self, cluster, command, v2=False):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites', 'BrotliCodec'])

        foo = Foo()

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [foo.foo10])
            a.run_psibase(['install'] + a.node_args() + ['foo', '--package-source', dir])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'original')
            self.assertResponse(a.get('/file2.txt', 'foo'), 'deleted')
            make_package_repository(dir, [foo.foo10, foo.foo11, foo.foo20])
            a.run_psibase(command + a.node_args() + ['foo', '--package-source', dir])
            a.wait(new_block())
            if v2:
                self.assertResponse(a.get('/file1.txt', 'foo'), 'version 2')
            else:
                self.assertResponse(a.get('/file1.txt', 'foo'), 'updated')
                self.assertEqual(a.get('/file2.txt', 'foo').status_code, 404)
                self.assertResponse(a.get('/file3.txt', 'foo'), 'added')
                self.assertResponse(a.get('/file4.txt', 'bar2'), 'cancel server')

    @testutil.psinode_test
    def test_upgrade(self, cluster):
        self.do_test_upgrade(cluster, ["upgrade", "foo"])

    @testutil.psinode_test
    def test_upgrade_all(self, cluster):
        self.do_test_upgrade(cluster, ["upgrade"])

    @testutil.psinode_test
    def test_upgrade_latest(self, cluster):
        self.do_test_upgrade(cluster, ["upgrade", "--latest"], True)

    @testutil.psinode_test
    def test_info(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        info = a.run_psibase(['info', 'Explorer'] + a.node_args(), stdout=subprocess.PIPE, encoding='utf-8').stdout
        self.assertIn('status: not installed', info)
        self.assertIn('Explorer', info)

        a.boot(packages=['Minimal', 'Explorer', 'Sites', 'BrotliCodec'])

        foo = Foo()

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [foo.foo10, foo.foo11, foo.foo20])
            def get_info(package):
                return a.run_psibase(['info'] + a.node_args() + [package, '--package-source', dir], stdout=subprocess.PIPE, encoding='utf-8').stdout
            info = get_info('foo')
            self.assertIn('status: not installed', info)
            self.assertIn('description: Major version update', info)
            self.assertIn('name: foo-2.0.0', info)

            a.run_psibase(['install'] + a.node_args() + ['foo-1.0', '--package-source', dir])
            a.wait(new_block())

            for name in ['foo', 'foo-1', 'foo-1.0', 'foo-1.0.0']:
                info = get_info('foo')
                self.assertIn('status: upgrade to 2.0.0 available', info)
                self.assertIn('description: The original foo', info)
                self.assertIn('name: foo-1.0.0', info)
            for name in ["foo-2", "foo-2.0", "foo-2.0.0"]:
                info = get_info(name)
                self.assertIn('status: version 1.0.0 installed', info)
                self.assertIn('description: Major version update', info)
                self.assertIn('name: foo-2.0.0', info)

            a.run_psibase(['install'] + a.node_args() + ['foo-2.0', '--package-source', dir])
            a.wait(new_block())

            info = get_info('foo')
            self.assertIn('status: installed', info)
            self.assertIn('description: Major version update', info)
            self.assertIn('name: foo-2.0.0', info)
            info = get_info('foo-1.0')
            self.assertIn('status: version 2.0.0 installed', info)
            self.assertIn('description: The original foo', info)
            self.assertIn('name: foo-1.0.0', info)

    @testutil.psinode_test
    def test_list(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites', 'BrotliCodec'])

        foo = Foo()

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [foo.foo10, foo.foo11, foo.foo20])
            def get_list(*options):
                return a.run_psibase(['list', '--package-source', dir] + list(options) + a.node_args(), stdout=subprocess.PIPE, encoding='utf-8').stdout
            for args in [(), ('--all',), ('--all', '--installed'), ('--installed', '--available', '--updates')]:
                l = get_list(*args)
                self.assertIn('Minimal', l)
                self.assertIn('Explorer', l)
                self.assertIn('Sites', l)
                self.assertIn('foo 2.0.0', l)

            l = get_list('--installed')
            self.assertIn('Explorer', l)
            self.assertNotIn('foo', l)

            l = get_list('--available')
            self.assertNotIn('Explorer', l)
            self.assertIn('foo 2.0.0', l)

            l = get_list('--updates')
            self.assertEqual(l, "")

            a.run_psibase(['install'] + a.node_args() + ['foo-1.0', '--package-source', dir])
            a.wait(new_block())

            l = get_list('--installed')
            self.assertIn('Explorer', l)
            self.assertIn('foo 1.0.0', l)

            l = get_list('--available')
            self.assertEqual(l, "")

            l = get_list('--updates')
            self.assertIn('foo 1.0.0->2.0.0', l)

            a.run_psibase(['install'] + a.node_args() + ['foo-2.0', '--package-source', dir])
            a.wait(new_block())

            l = get_list('--updates')
            self.assertEqual(l, "")

    @testutil.psinode_test
    def test_configure_sources(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'Sites', 'BrotliCodec'])

        foo10 = TestPackage('foo', '1.0.0').depends('Sites').service('foo', data={'file1.txt': 'data'})
        with tempfile.TemporaryDirectory() as dir:
            path = os.path.join(dir, foo10.write(dir)["file"])
            a.run_psibase(["publish", "-S", "root"] + a.node_args() + [path])
            a.push_action("root", "packages", "setSources", {"sources": [{"account":"root"}]})
            a.wait(new_block())
            a.run_psibase(['install'] + a.node_args() + ['foo'])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'data')

    @testutil.psinode_test
    def test_sign(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        key = PrivateKey()
        key_file = os.path.join(a.dir, 'key')
        pubkey_file = os.path.join(a.dir, 'key.pub')
        with open(key_file, 'w') as f:
            f.write(key.pkcs8())
        with open(pubkey_file, 'w') as f:
            f.write(key.spki())
        a.run_psibase(['create', 'alice', '-k', pubkey_file] + a.node_args())
        a.wait(new_block())
        a.run_psibase(['modify', 'alice', '-i', '--sign', key_file] + a.node_args())

    @testutil.psinode_test
    def test_staged_install(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer'])

        accounts = Accounts(a)
        auth_sig = AuthSig(a)
        staged_tx = StagedTx(a)

        key = PrivateKey()
        key_file = os.path.join(a.dir, 'key')

        accounts.new_account('b')
        auth_sig.set_key('a', key)
        a.wait(new_block())

        a.run_psibase(['install'] + a.node_args() + ['Symbol', 'Tokens', 'TokenUsers', '--proposer', 'b'])
        a.wait(new_block())

        # This should fail because the transaction was only proposed
        with self.assertRaises(requests.HTTPError):
            a.graphql('tokens', '''query { userBalances(user: "alice") { edges { node { symbolId tokenId balance precision { value } } } } }''')

        for tx in staged_tx.get_staged(proposer='b'):
            staged_tx.accept('a', tx, keys=[key])

        a.wait(new_block())
        a.graphql('tokens', '''query { userBalances(user: "alice") { edges { node { symbolId tokenId balance precision { value } } } } }''')

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

if __name__ == '__main__':
    testutil.main()
