#!/usr/bin/python

from fracpack import Schema
import argparse
import json
import pathlib
import sys
import unittest

class TestFracpack(unittest.TestCase):
    def test(self):
        with open(args.test_data) as f:
            tests = json.load(f)
        for t in tests:
            t = dict(t)
            schema = Schema(t['schema'])
            for v in t['values']:
                v = dict(v)
                with self.subTest(**{v['type']:v['json']}):
                    self.assertEqual(schema[v['type']].packed(v['json']), bytes.fromhex(v['fracpack']))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    here = pathlib.Path(__file__).parent
    test_data = (here / '../../../libraries/psio/tests/fracpack-tests.json').resolve()
    parser.add_argument("--test-data", default=test_data, help="A JSON file containing tests to run")
    global args
    (args, remaining) = parser.parse_known_args(sys.argv)
    unittest.main(argv=remaining)
