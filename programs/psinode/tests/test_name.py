#!/usr/bin/python

import unittest
import name
import psio

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
        self.assertEqual(name.account_to_number("a+0"), 331048532879956736)
        self.assertEqual(name.account_to_number("a+42"), 331048532879956736 + 42)
        self.assertEqual(name.number_to_account(331048532879956736 + 42), "a+42")
        self.assertEqual(name.account_to_number("a+9"), 331048532879956736 + 9)
        self.assertEqual(name.number_to_account(331048532879956736 + 9), "a+9")
        self.assertEqual(name.account_to_number("a+90"), 331048532879956736 + 90)
        self.assertEqual(name.number_to_account(331048532879956736 + 90), "a+90")
        self.assertEqual(name.account_to_number("spiderman+255"), 950660654012764416 + 255)
        self.assertEqual(name.number_to_account(950660654012764416 + 255), "spiderman+255")
    def test_method(self):
        self.assertEqual(psio.method_to_number(""), 0)
        self.assertEqual(psio.number_to_method(0), "")
        self.assertEqual(psio.method_to_number("a"), 32783)
        self.assertEqual(psio.number_to_method(32783), "a")
        self.assertEqual(psio.method_to_number("b"), 196)
        self.assertEqual(psio.number_to_method(196), "b")
        self.assertEqual(psio.method_to_number("c"), 32884)
        self.assertEqual(psio.number_to_method(32884), "c")
        self.assertEqual(psio.method_to_number("spiderman"), 311625498215)
        self.assertEqual(psio.number_to_method(311625498215), "spiderman")
        self.assertEqual(psio.method_to_number("anthonystark"), 50913722085663764)
        self.assertEqual(psio.number_to_method(50913722085663764), "anthonystark")
        self.assertEqual(psio.method_to_number("natasharomanoff"), 6905860632893337981)
        self.assertEqual(psio.method_to_number("#psaoryoiluhlrpyn"), 6905860632893337981)
        self.assertEqual(psio.number_to_method(6905860632893337981), "#psaoryoiluhlrpyn")
        self.assertEqual(psio.method_to_number("NATASHAROMANOFF"), 679355919866582572)
        self.assertEqual(psio.method_to_number("abcdefghijklmnopqrstuvwxyz"), 2393445670689189432)
        # psio::compress_name: a name that does not decode back from its
        # compressed number is hashed; a digit or '_' is the letter of its
        # symbol; text that names no method is 0.
        for text, number in [
                ("checkFirstAuth", 0xcd29c38cde224f8e), ("cpu_min_unit", 0x13fb233a1d98cbd8),
                ("frozenAccounts", 0x27303f52c1c094da), ("get_resources", 0xd5137f98107c0181),
                ("getSymbolType", 0xd55df3070b8758eb), ("regEvIdx", 0x413db64868a8ec0f),
                ("removeCallback", 0x978d530fdfe275cb), ("rowsBySecondary", 0x83a92f4d480665a6),
                ("create_request", 0xf997f22d796b5e2b), ("set_paid_occ", 0x15d82d05366fa15c),
                ("Transfer", 0xce42aab641), ("grryhn4d3x0", 0x1077e590319b98c2),
                ("#abc", 0), ("#eeeeeeeeeeeeeeee", 0), ("x--b", 0)]:
            self.assertEqual(psio.method_to_number(text), number, text)
        self.assertEqual(psio.number_to_method(0xd55df3070b8758eb), "#hmlnslheseoypnnp")

if __name__ == '__main__':
    unittest.main()
