#!/usr/bin/python

import unittest
import name

class TestName(unittest.TestCase):
    def test_account(self):
        self.assertEqual(name.account_to_number(""), 0)
        self.assertEqual(name.number_to_account(0), "")
        self.assertEqual(name.account_to_number("a"), 331048532879956736)
        self.assertEqual(name.number_to_account(331048532879956736), "a")
        self.assertEqual(name.account_to_number("b"), 364153386167952384)
        self.assertEqual(name.number_to_account(364153386167952384), "b")
        self.assertEqual(name.account_to_number("c"), 397258239455948032)
        self.assertEqual(name.number_to_account(397258239455948032), "c")
        self.assertEqual(name.account_to_number("abc123"), 342084831226198272)
        self.assertEqual(name.number_to_account(342084831226198272), "abc123")
        self.assertEqual(name.account_to_number("spiderman"), 950660654012764416)
        self.assertEqual(name.number_to_account(950660654012764416), "spiderman")
        self.assertEqual(name.account_to_number("a☺0"), 331048532879956736)
        self.assertEqual(name.account_to_number("a☺42"), 331048532879956736 + 42)
        self.assertEqual(name.number_to_account(331048532879956736 + 42), "a☺42")
        self.assertEqual(name.account_to_number("a☺9"), 331048532879956736 + 9)
        self.assertEqual(name.number_to_account(331048532879956736 + 9), "a☺9")
        self.assertEqual(name.account_to_number("a☺90"), 331048532879956736 + 90)
        self.assertEqual(name.number_to_account(331048532879956736 + 90), "a☺90")
        self.assertEqual(name.account_to_number("spiderman☺255"), 950660654012764416 + 255)
        self.assertEqual(name.number_to_account(950660654012764416 + 255), "spiderman☺255")
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
