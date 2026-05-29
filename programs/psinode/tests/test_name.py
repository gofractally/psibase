#!/usr/bin/python

import unittest
import name

class TestName(unittest.TestCase):
    def test_account(self):
        self.assertEqual(name.account_to_number(""), 0)
        self.assertEqual(name.number_to_account(0), "")
        self.assertEqual(name.account_to_number("a"), 1293158331562331)
        self.assertEqual(name.number_to_account(1293158331562331), "a")
        self.assertEqual(name.account_to_number("b"), 1422474164718564)
        self.assertEqual(name.number_to_account(1422474164718564), "b")
        self.assertEqual(name.account_to_number("c"), 1551789997874797)
        self.assertEqual(name.number_to_account(1551789997874797), "c")
        self.assertEqual(name.account_to_number("abc123"), 1336268871977337)
        self.assertEqual(name.number_to_account(1336268871977337), "abc123")
        self.assertEqual(name.account_to_number("spiderman"), 3713518179737361)
        self.assertEqual(name.number_to_account(3713518179737361), "spiderman")
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
        self.assertEqual(name.method_to_number("NATASHAROMANOFF"), 679355919866582572)
        self.assertEqual(name.method_to_number("abcdefghijklmnopqrstuvwxyz"), 2393445670689189432)

if __name__ == '__main__':
    unittest.main()
