#!/usr/bin/python

from psinode import Cluster
from predicates import *
import testutil
import time
import json
import zipfile
import tempfile
import hashlib
import unittest
import os
from io import TextIOWrapper

class TestPackage:
    def __init__(self, name, version, accounts=None, depends=None):
        if accounts is None:
            accounts = []
        if depends is None:
            depends = []
        self.name = name
        self.version = version
        self.description = "Test package"
        self.accounts = accounts
        self._depends = depends
        self.files = dict()
    def depends(self, name, version='*'):
        self._depends.append({'name': name, 'version': version})
        return self
    def service(self, name, wasm=None, data=[]):
        if wasm is not None:
            add_file(name, wasm)
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

class TestPsibase(unittest.TestCase):
    @testutil.psinode_test
    def test_install(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'ExploreSys'])
        a.run_psibase(['install', 'SymbolSys', 'TokenSys', 'TokenUsers'])
        a.wait(new_block())
        a.graphql('token-sys', '''query { userBalances(user: "alice") { user balance precision token symbol } }''')

    @testutil.psinode_test
    def test_upgrade(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'ExploreSys', 'PsiSpaceSys'])

        foo10 = TestPackage('foo', '1.0.0').depends('PsiSpaceSys').service('foo', data={'file1.txt': 'original', 'file2.txt': 'deleted'})
        foo11 = TestPackage('foo', '1.1.0').depends('PsiSpaceSys').service('foo', data={'file1.txt': 'updated', 'file3.txt': 'added'})

        with tempfile.TemporaryDirectory() as dir:
            make_package_repository(dir, [foo10])
            a.run_psibase(['install', 'foo', '--package-source', dir])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'original')
            self.assertResponse(a.get('/file2.txt', 'foo'), 'deleted')
            make_package_repository(dir, [foo10, foo11])
            a.run_psibase(['install', 'foo', '--package-source', dir])
            a.wait(new_block())
            self.assertResponse(a.get('/file1.txt', 'foo'), 'updated')
            self.assertEqual(a.get('/file2.txt', 'foo').status_code, 404)
            self.assertResponse(a.get('/file3.txt', 'foo'), 'added')

    def assertResponse(self, response, expected):
        response.raise_for_status()
        self.assertEqual(response.text, expected)

if __name__ == '__main__':
    testutil.main()
