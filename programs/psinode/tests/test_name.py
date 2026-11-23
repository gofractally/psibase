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
        import json
        from pathlib import Path
        root = Path(__file__).resolve().parents[3]
        data = json.loads((root / "libraries/psibase/common/share/action-name-vectors.json").read_text())
        for row in data["vectors"]:
            with self.subTest(text=row["text"]):
                number = name.method_to_number(row["text"])
                self.assertEqual(number, int(row["value_u64"]))
                self.assertEqual(name.number_to_method(number), row["decoded"])
                self.assertEqual(name.method_to_number(row["decoded"]), number)
        for invalid in data["invalid_names"]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(name.InvalidName):
                    name.method_to_number(invalid)
        for invalid in data["invalid_u64_decimal"]:
            with self.assertRaises(name.InvalidName):
                name.number_to_method(int(invalid))

if __name__ == '__main__':
    unittest.main()
