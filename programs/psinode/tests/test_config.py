#!/usr/bin/python

import testutil
import unittest
import subprocess
import tempfile
from pathlib import Path

class TestConfig(unittest.TestCase):
    @testutil.psinode_test
    def test_database_cache_policy(self, cluster):
        a = cluster.make_node(database_cache_policy='disabled')
        a.shutdown()
        a.start(database_cache_policy='disabled')
        a.shutdown()
        a.start(database_cache_policy='disabled')

    @testutil.psinode_test
    def test_removed_database_cache_size_is_rejected(self, cluster):
        with tempfile.TemporaryDirectory() as directory:
            executable = cluster.node_kw.get('executable', 'psinode')
            result = subprocess.run([executable, directory, '--database-cache-size', '256MiB'],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('replace it with database-cache-policy=disabled', result.stderr)
            self.assertFalse((Path(directory) / 'psibase-storage-format').exists())

if __name__ == '__main__':
    testutil.main()
