"""Wallet transaction construction tests; financial execution is tested on chain."""
import copy
import json
import io
from email.message import Message
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("exchange_demo_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def state(auto=False):
    return {
        "markets": [{"id": 1, "base": 1, "quote": 2}],
        "balances": [
            {"token": 1, "wallet": 1000, "incoming": 20, "outgoing": 30, "auto_debit": auto},
            {"token": 2, "wallet": 1000, "incoming": 7, "outgoing": 9, "auto_debit": auto},
        ],
        "positions": [
            {"market": 1, "bid": True, "price": 90, "proceeds": 100},
            {"market": 1, "bid": False, "price": 110, "proceeds": 80},
        ],
        "loans": [], "loan_positions": [],
    }


def amount(action):
    return action["data"]["amount"]["value"]


class WalletTests(unittest.TestCase):
    def test_cross_origin_mutation_is_rejected_before_wallet_execution(self):
        handler = object.__new__(bridge.Handler)
        handler.headers = Message()
        handler.headers["Host"] = f"127.0.0.1:{bridge.PORT}"
        handler.headers["Origin"] = "https://untrusted.example"
        handler.headers["Content-Type"] = "application/json"
        handler.path = "/api/action"
        body = json.dumps({"account": "alice", "method": "claim", "args": {
            "market": 1, "long": True, "price": 80000}}).encode()
        handler.headers["Content-Length"] = str(len(body))
        handler.rfile = io.BytesIO(body)
        handler.send_json = MagicMock()
        with patch.object(bridge, "push") as push:
            handler.do_POST()
        push.assert_not_called()
        reply, status = handler.send_json.call_args.args
        self.assertEqual(status, 400)
        self.assertIn("Cross-origin", reply["error"])

    def test_native_transaction_wrapper_returns_requested_action_result(self):
        requested = bridge.action("alice", "tokens", "getToken", {"token_id": 1})
        actual = {"action": {"sender": "alice", "service": "tokens", "method": "getToken"},
                  "retval": {"id": 1}, "innerTraces": [], "error": None}
        trace = {"error": None, "actionTraces": [{
            "action": {"sender": "", "service": "transact", "method": ""},
            "rawRetval": "", "innerTraces": [
                {"inner": {"ActionTrace": {"action": {"sender": "tokens", "service": "db", "method": "open"}, "retval": 0}}},
                {"inner": {"ActionTrace": actual}},
            ]}]}
        with patch.object(bridge.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(trace), stderr="")):
            result = bridge.push([requested])
        self.assertEqual(result["actionTraces"], [actual])

    def test_native_login_normalizes_bearer_and_caches_private_credentials(self):
        with patch.dict(bridge.AUTH, {}, clear=True), patch.object(bridge.subprocess, "run",
                return_value=SimpleNamespace(returncode=0, stdout="bearer test-token\n", stderr="")) as run:
            self.assertEqual(bridge.bearer("alice"), "Bearer test-token")
            self.assertEqual(bridge.bearer("alice"), "Bearer test-token")
            run.assert_called_once()

    def withdraw(self, current, token, quantity):
        with patch.object(bridge, "read_state", return_value=copy.deepcopy(current)), \
                patch.object(bridge, "push", side_effect=lambda actions: actions) as push:
            result = bridge.wallet_transfer("alice", token, quantity, False)
            push.assert_called_once()
            return result

    def test_manual_debit_claims_stay_pending_before_withdrawal(self):
        actions = self.withdraw(state(False), 1, 140)
        self.assertEqual([a["method"] for a in actions], ["settle", "settle", "debit", "uncredit"])
        self.assertEqual(amount(actions[-2]), 120)
        self.assertEqual(amount(actions[-1]), 20)

    def test_auto_debit_partial_claim_withdrawal_recredits_excess(self):
        actions = self.withdraw(state(True), 1, 50)
        self.assertEqual([a["method"] for a in actions], ["settle", "settle", "credit", "credit"])
        credits = {a["data"]["token_id"]: amount(a) for a in actions if a["method"] == "credit"}
        self.assertEqual(credits, {1: 50, 2: 80})
        # The requested 50 was already delivered by the first settled claim.
        self.assertFalse(any(a["method"] in ("debit", "uncredit") for a in actions))

    def test_auto_debit_claim_and_existing_pending_are_not_double_counted(self):
        actions = self.withdraw(state(True), 1, 140)
        self.assertEqual([a["method"] for a in actions], ["settle", "settle", "credit", "debit", "uncredit"])
        self.assertEqual(actions[2]["data"]["token_id"], 2)
        self.assertEqual(amount(actions[2]), 80)
        self.assertEqual(amount(actions[-2]), 20)
        self.assertEqual(amount(actions[-1]), 20)
        self.assertEqual(100 + amount(actions[-2]) + amount(actions[-1]), 140)

    def test_claims_fund_following_exchange_action_under_both_native_settings(self):
        for auto in (False, True):
            current = state(auto)
            prefix, accrued = bridge.settlements("alice", current)
            funded = bridge.fund_claims("alice", current, prefix, accrued)
            self.assertEqual(accrued, {1: 100, 2: 80})
            credits = [a for a in funded if a["method"] == "credit"]
            self.assertEqual(len(credits), 2 if auto else 0)
            if auto:
                self.assertEqual([amount(a) for a in credits], [100, 80])
            self.assertTrue(all(a["sender"] == "alice" for a in funded))

    def test_mixed_token_auto_debit_overrides(self):
        current = state(False)
        current["balances"][0]["auto_debit"] = True
        actions = self.withdraw(current, 2, 40)
        self.assertEqual([a["method"] for a in actions], ["settle", "settle", "credit", "debit"])
        self.assertEqual(actions[2]["data"]["token_id"], 1)
        self.assertEqual(amount(actions[2]), 100)
        self.assertEqual(amount(actions[-1]), 40)

    def test_recalled_or_legacy_book_cannot_block_healthy_wallet_actions(self):
        current = state(False)
        current["markets"][0]["escrow_quote"] = {"funded": False}
        current["markets"].append({"id": 2, "base": 1, "quote": 2,
                                   "escrow_base": {"funded": True},
                                   "escrow_quote": {"funded": True}})
        current["positions"].append({"market": 2, "bid": True, "price": 90, "proceeds": 50})
        prefix, accrued = bridge.settlements("alice", current)
        self.assertEqual(accrued, {1: 50})
        self.assertEqual([a["data"]["market"] for a in prefix], [2])
        actions = self.withdraw(current, 1, 80)
        self.assertEqual([a["method"] for a in actions], ["settle", "debit", "uncredit"])
        self.assertEqual(amount(actions[-2]), 70)
        self.assertEqual(amount(actions[-1]), 10)
        current["markets"][1]["legacy_unsupported"] = True
        self.assertEqual(bridge.settlements("alice", current), ([], {}))

    def test_insufficient_shared_and_claimed_balance_never_pushes(self):
        with patch.object(bridge, "read_state", return_value=state(True)), patch.object(bridge, "push") as push:
            with self.assertRaisesRegex(ValueError, "Insufficient"):
                bridge.wallet_transfer("alice", 1, 151, False)
            push.assert_not_called()

    def test_closed_loan_surplus_is_settled_once(self):
        current = state(True)
        current["positions"] = []
        current["loans"] = [{"generation": 5, "active": False, "original_surplus": 101, "original_units": 3}]
        current["loan_positions"] = [{"generation": 5, "market": 1, "long": True, "price": 80, "units": 2}]
        prefix, accrued = bridge.settlements("alice", current)
        self.assertEqual(accrued, {2: 67})
        self.assertEqual([a["method"] for a in prefix], ["claim"])
        funded = bridge.fund_claims("alice", current, prefix, accrued)
        self.assertEqual([a["method"] for a in funded], ["claim", "credit"])
        self.assertEqual(amount(funded[-1]), 67)

    def test_u64_quantities_remain_exact_in_native_actions(self):
        exact = (1 << 64) - 1
        self.assertEqual(bridge.quantity(str(exact)), {"value": exact})
        with self.assertRaises(ValueError):
            bridge.quantity(1 << 64)
        with self.assertRaises(ValueError):
            bridge.quantity(0)
        actions = bridge.fund_claims("alice", state(True), [], {1: exact})
        self.assertEqual(amount(actions[0]), exact)

    def test_loopback_host_validation_blocks_dns_rebinding(self):
        for host in (f"127.0.0.1:{bridge.PORT}", f"localhost:{bridge.PORT}"):
            self.assertTrue(bridge.Handler.local_host(SimpleNamespace(headers={"Host": host})))
        for host in (f"attacker.example:{bridge.PORT}", "127.0.0.1", "", "localhost.evil"):
            self.assertFalse(bridge.Handler.local_host(SimpleNamespace(headers={"Host": host})))

    def test_public_native_token_catalog_proxy_has_bounded_exact_cursor(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"tokens":[{"id":123}],"next":123}'
        with patch.object(bridge.urllib.request, "urlopen", return_value=response) as fetch:
            self.assertEqual(bridge.read_tokens("122", "1")["tokens"][0]["id"], 123)
            request = fetch.call_args.args[0]
            self.assertTrue(request.full_url.endswith("/tokens?after=122&limit=1"))
            self.assertIn("exchange.psibase.localhost", request.get_header("Host"))
        for cursor, size in ((-1, 1), (1 << 32, 1), (0, 0), (0, 201)):
            with self.assertRaises(ValueError):
                bridge.read_tokens(cursor, size)


if __name__ == "__main__":
    unittest.main(verbosity=2)
