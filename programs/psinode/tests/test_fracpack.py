#!/usr/bin/python

from fracpack import *
import argparse
import json
import pathlib
import sys
import unittest

class TestObject(Object):
    i: i32
    b: Bool

class ExtTestObject(Object):
    i: i32
    b: Bool
    o: Option(i32)

TestTuple = Tuple([i32, Bool])
ExtTestTuple = Tuple([i32, Bool, Option(i32)])

class TestStruct(Struct):
    i: i32
    f: f32

class TestVariant(Variant):
    TestObject: TestObject
    TestStruct: TestStruct

class ExtVariant(Variant):
    TestObject: TestObject
    TestStruct: TestStruct
    TestTuple: TestTuple

IntList = List(i32)
IntArray = Array(i32, 3)
IntTuple = Tuple((i32, i64))

OptInt = Option(i32)

class Empty(Struct):
    pass

NestedEmpty = Tuple([FracPack(Empty)])

CustomOption = Custom(OptInt, "MyOptInt")

class TestFracpack(unittest.TestCase):
    def test_u32(self):
        self.assertEqual(pack(u32(10)).hex().upper(), '0A000000')
    def test_f32(self):
        self.assertEqual(pack(f32(1.0)).hex().upper(), '0000803F')
    def test_object(self):
        self.assertEqual(pack(TestObject(6, True)).hex().upper(), '05000600000001')
    def test_struct(self):
        self.assertEqual(pack(TestStruct(-1, 1.0)).hex().upper(), 'FFFFFFFF0000803F')
    def test_array(self):
        self.assertEqual(pack(IntArray([-1, 5, 10])).hex().upper(), 'FFFFFFFF050000000A000000')
    def test_list(self):
        self.assertEqual(pack(IntList([1,-1,2])).hex().upper(), '0C00000001000000FFFFFFFF02000000')
    def test_option(self):
        self.assertEqual(pack(OptInt()).hex().upper(), '01000000')
        self.assertEqual(pack(OptInt(None)).hex().upper(), '01000000')
        self.assertEqual(pack(OptInt(-1)).hex().upper(), '04000000FFFFFFFF')
        self.assertEqual(pack(7, CustomOption).hex().upper(), '0400000007000000')
        self.assertEqual(pack(None, CustomOption).hex().upper(), '01000000')
        self.assertEqual(pack([None], Tuple([CustomOption])).hex().upper(), '0000')
        self.assertEqual(pack([None, 7], Tuple([CustomOption, i32])).hex().upper(), '08000100000007000000')
    def test_tuple(self):
        self.assertEqual(pack(IntTuple((-1, 42))).hex().upper(), '0C00FFFFFFFF2A00000000000000')
    def test_variant(self):
        self.assertEqual(pack(TestVariant('TestObject', TestObject(5, False))).hex().upper(), '000700000005000500000000')
    def test_string(self):
        self.assertEqual(pack(String('foo')).hex().upper(), '03000000666F6F')
    def test_bool(self):
        self.assertEqual(pack(Bool(True)).hex().upper(), '01')
    def test_empty(self):
        self.assertEqual(pack(Empty()).hex().upper(), '')
        self.assertEqual(pack([Empty], NestedEmpty).hex().upper(), '040000000000')
    def test_compat(self):
        self.assertIsNone(compatibility(i32, i64))
        self.assertIsNone(compatibility(i32, u32))
        self.assertIsNone(compatibility(f32, f64))
        self.assertIsNone(compatibility(TestObject, f64))
        self.assertIsNone(compatibility(TestTuple, f64))
        self.assertIsNone(compatibility(TestVariant, f64))
        self.assertIsNone(compatibility(FracPack(Empty), f64))
        self.assertIsNone(compatibility(TestStruct, f64))
        self.assertTrue(is_equivalent(i32, i32))
        self.assertTrue(is_equivalent(f32, f32))
        self.assertTrue(is_equivalent(TestObject, TestObject))
        self.assertTrue(is_equivalent(TestTuple, TestTuple))
        self.assertTrue(is_equivalent(TestVariant, TestVariant))
        self.assertTrue(is_equivalent(IntList, IntList))
        self.assertTrue(is_equivalent(IntArray, IntArray))
        self.assertTrue(is_equivalent(OptInt, OptInt))
        self.assertEqual(compatibility(TestObject, TestTuple), TypeCompatibility())
        self.assertEqual(compatibility(TestObject, ExtTestObject), TypeCompatibility(addField=True))
        self.assertEqual(compatibility(TestObject, ExtTestTuple), TypeCompatibility(addField=True))
        self.assertEqual(compatibility(TestTuple, ExtTestObject), TypeCompatibility(addField=True))
        self.assertEqual(compatibility(TestTuple, ExtTestTuple), TypeCompatibility(addField=True))
        self.assertEqual(compatibility(ExtTestObject, TestObject), TypeCompatibility(dropField=True))
        self.assertEqual(compatibility(ExtTestObject, TestTuple), TypeCompatibility(dropField=True))
        self.assertEqual(compatibility(ExtTestTuple, TestObject), TypeCompatibility(dropField=True))
        self.assertEqual(compatibility(ExtTestTuple, TestTuple), TypeCompatibility(dropField=True))
        self.assertEqual(compatibility(TestVariant, ExtVariant), TypeCompatibility(addAlternative=True))
        self.assertEqual(compatibility(ExtVariant, TestVariant), TypeCompatibility(dropAlternative=True))
        self.assertEqual(compatibility(FracPack(Empty), Bytes), TypeCompatibility(addAlternative=True))
        self.assertEqual(compatibility(Bytes, FracPack(Empty)), TypeCompatibility(dropAlternative=True))
    def test_schema(self):
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
