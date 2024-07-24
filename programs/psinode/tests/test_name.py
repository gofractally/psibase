#!/usr/bin/python

import unittest
import name

class TestName(unittest.TestCase):
    def test_account(self):
        self.assertEqual(name.account_to_number(""), 0)
        self.assertEqual(name.account_to_number("a"), 49158)
        self.assertEqual(name.account_to_number("b"), 184)
        self.assertEqual(name.account_to_number("c"), 16538)
        self.assertEqual(name.account_to_number("abc123"), 1754468116)
        self.assertEqual(name.account_to_number("spiderman"), 483466201442)
    def test_method(self):
        self.assertEqual(name.method_to_number(""), 0)
        self.assertEqual(name.method_to_number("a"), 32783)
        self.assertEqual(name.method_to_number("b"), 196)
        self.assertEqual(name.method_to_number("c"), 32884)
        self.assertEqual(name.method_to_number("spiderman"), 311625498215)
        self.assertEqual(name.method_to_number("anthonystark"), 50913722085663764)
        #self.assertEqual(name.method_to_number("natasharomanoff"), 796603392265069093)
        self.assertEqual(name.method_to_number("#niiutpmlecuamehe"), 796603392265069093)

if __name__ == '__main__':
    unittest.main()
