#!/usr/bin/python

import unittest
import name

class TestName(unittest.TestCase):
    def test_account(self):
        self.assertEqual(name.account_to_number(""), 0)
        self.assertEqual(name.number_to_account(0), "")
        self.assertEqual(name.account_to_number("a"), 49158)
        self.assertEqual(name.number_to_account(49158), "a")
        self.assertEqual(name.account_to_number("b"), 184)
        self.assertEqual(name.number_to_account(184), "b")
        self.assertEqual(name.account_to_number("c"), 16538)
        self.assertEqual(name.number_to_account(16538), "c")
        self.assertEqual(name.account_to_number("abc123"), 1754468116)
        self.assertEqual(name.number_to_account(1754468116), "abc123")
        self.assertEqual(name.account_to_number("spiderman"), 483466201442)
        self.assertEqual(name.number_to_account(483466201442), "spiderman")
    def test_method(self):
        self.assertEqual(name.method_to_number(""), 0)
        self.assertEqual(name.number_to_method(0), "")
        self.assertEqual(name.method_to_number("a"), 32783)
        self.assertEqual(name.number_to_method(32783), "a")
        self.assertEqual(name.method_to_number("b"), 196)
        self.assertEqual(name.number_to_method(196), "b")
        self.assertEqual(name.method_to_number("c"), 32884)
        self.assertEqual(name.number_to_method(32884), "c")
        self.assertEqual(name.method_to_number("spiderman"), 311625498215)
        self.assertEqual(name.number_to_method(311625498215), "spiderman")
        self.assertEqual(name.method_to_number("anthonystark"), 50913722085663764)
        self.assertEqual(name.number_to_method(50913722085663764), "anthonystark")
        self.assertEqual(name.method_to_number("natasharomanoff"), 6905860632893337981)
        self.assertEqual(name.method_to_number("#psaoryoiluhlrpyn"), 6905860632893337981)
        self.assertEqual(name.number_to_method(6905860632893337981), "#psaoryoiluhlrpyn")

if __name__ == '__main__':
    unittest.main()
