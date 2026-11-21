"""Authenticated stop pagination and fresh, bounded older-receipt release."""
import copy
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import unittest
from unittest.mock import MagicMock,patch
try:
    from .test_wallet_preparation import NativeWallet,snapshot
except ImportError:
    from test_wallet_preparation import NativeWallet,snapshot

spec=importlib.util.spec_from_file_location("stop_page_bridge",Path(__file__).with_name("bridge.py"))
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

def stop(generation=7,auto=False):
    return {"owner":"alice","generation":generation,"market":1,"sell_base":True,"status":"partially_filled",
            "remaining_outgoing":0,"claimable_input":3,"claimable_output":8,
            "input_token":1,"output_token":2,"input_auto_debit":auto,"output_auto_debit":auto}

class StopPageTests(unittest.TestCase):
    def test_page_preserves_u64_cursors_and_uses_only_selected_owner_jwt(self):
        body={"owner":"alice","stop_positions":[stop("9007199254740997"),stop("9007199254740995")],"next_before":"9007199254740995"}
        with patch.object(bridge,"bearer",return_value="Bearer unit-test") as auth,patch.object(bridge.urllib.request,"urlopen",return_value=io.BytesIO(json.dumps(body).encode())) as request:
            self.assertEqual(bridge.read_stops("alice","9007199254740999","2"),body)
        auth.assert_called_once_with("alice")
        native=request.call_args.args[0]
        self.assertTrue(native.full_url.endswith("/stops?owner=alice&limit=2&before=9007199254740999"))
        self.assertEqual(native.get_header("Authorization"),"Bearer unit-test")
    def test_bad_page_or_point_inputs_never_reach_auth_or_network(self):
        with patch.object(bridge,"bearer") as auth,patch.object(bridge.urllib.request,"urlopen") as network:
            for before in ("",True,-1,"1&owner=bob","1.5","１２",1<<64):
                with self.assertRaises(ValueError):bridge.read_stops("alice",before)
            for limit in ("",True,0,201,"1e2"):
                with self.assertRaises(ValueError):bridge.read_stops("alice",None,limit)
            for generation in (None,"",True,0,-1,"7&owner=bob","1.5","１２",1<<64):
                with self.assertRaises(ValueError):bridge.read_stop("alice",generation)
            with self.assertRaises(ValueError):bridge.read_stops("alice&owner=bob")
            with self.assertRaises(ValueError):bridge.read_stop("unknown",7)
        auth.assert_not_called();network.assert_not_called()
    def test_foreign_owner_invalid_sort_and_mismatched_cursor_pages_fail_closed(self):
        cases=[{"owner":"bob","stop_positions":[],"next_before":None},
               {"owner":"alice","stop_positions":[dict(stop(),owner="bob")],"next_before":None},
               {"owner":"alice","stop_positions":[stop(7),stop(8)],"next_before":None},
               {"owner":"alice","stop_positions":[stop(7)],"next_before":6}]
        for body in cases:
            with self.subTest(body=body),patch.object(bridge,"bearer",return_value="Bearer unit-test"),patch.object(bridge.urllib.request,"urlopen",return_value=io.BytesIO(json.dumps(body).encode())):
                with self.assertRaises(ValueError):bridge.read_stops("alice",10,2)
    def test_point_null_does_not_reveal_another_owner_and_never_pushes(self):
        body={"owner":"alice","stop_position":None}
        with patch.object(bridge,"bearer",return_value="Bearer unit-test"),patch.object(bridge.urllib.request,"urlopen",return_value=io.BytesIO(json.dumps(body).encode())) as request,patch.object(bridge,"push") as push:
            self.assertEqual(bridge.read_stop("alice","7"),body)
        self.assertTrue(request.call_args.args[0].full_url.endswith("/stop?owner=alice&generation=7"))
        push.assert_not_called()
    def test_point_cannot_select_a_foreign_owner_or_different_generation(self):
        for row in (dict(stop(),owner="bob"),stop(8)):
            with patch.object(bridge,"bearer",return_value="Bearer unit-test"),patch.object(bridge.urllib.request,"urlopen",return_value=io.BytesIO(json.dumps({"owner":"alice","stop_position":row}).encode())):
                with self.assertRaises(ValueError):bridge.read_stop("alice",7)
    def test_older_release_uses_fresh_point_flags_without_snapshot_market_metadata(self):
        for auto in (False,True):
            row=stop(auto=auto);state=snapshot(auto);state["stop_positions"]=[row]
            wallet=NativeWallet(state)
            with patch.object(bridge,"read_stop",return_value={"owner":"alice","stop_position":copy.deepcopy(row)}) as point,patch.object(bridge,"read_state") as no_snapshot,patch.object(bridge,"push",side_effect=wallet.push):
                bridge.release_stop("alice",7)
            point.assert_called_once_with("alice",7);no_snapshot.assert_not_called()
            self.assertEqual([a["method"] for a in wallet.calls[0]],["claimstop","credit","credit"] if auto else ["claimstop"])
            self.assertEqual(wallet.row(1)["incoming"]+wallet.row(1)["outgoing"],3)
            self.assertEqual(wallet.row(2)["incoming"]+wallet.row(2)["outgoing"],8)
            self.assertEqual(wallet.row(1)["wallet"],1000);self.assertEqual(wallet.row(2)["wallet"],1000)
    def test_no_missing_armed_or_unknown_settings_receipt_can_push(self):
        for row,error in ((None,bridge.StopNotFound),(dict(stop(),status="armed"),ValueError),(dict(stop(),input_auto_debit=None),ValueError)):
            with patch.object(bridge,"read_stop",return_value={"owner":"alice","stop_position":row}),patch.object(bridge,"push") as push:
                with self.assertRaises(error):bridge.release_stop("alice",7)
            push.assert_not_called()
    def test_unknown_release_submission_is_never_retried(self):
        with patch.object(bridge,"read_stop",return_value={"owner":"alice","stop_position":stop()}),patch.object(bridge,"push",side_effect=TimeoutError("unknown")) as push:
            with self.assertRaises(TimeoutError):bridge.release_stop("alice",7)
        self.assertEqual(push.call_count,1)
    def test_blank_http_cursor_is_preserved_and_rejected_before_network(self):
        handler=object.__new__(bridge.Handler);handler.path="/api/stops?account=alice&before=";handler.headers=Message()
        handler.headers["Host"]=f"127.0.0.1:{bridge.PORT}";handler.send_json=MagicMock()
        with patch.object(bridge.urllib.request,"urlopen") as network:handler.do_GET()
        network.assert_not_called();self.assertEqual(handler.send_json.call_args.args[1],400)
    def test_release_http_missing_and_armed_results_are_404_and_400(self):
        for row,status in ((None,404),(dict(stop(),status="armed"),400)):
            payload=json.dumps({"account":"alice","generation":"7"}).encode()
            handler=object.__new__(bridge.Handler);handler.path="/api/release-stop";handler.rfile=io.BytesIO(payload);handler.headers=Message()
            for key,value in {"Host":f"127.0.0.1:{bridge.PORT}","Origin":bridge.NATIVE_UI_ORIGIN,"Content-Type":"application/json","Content-Length":str(len(payload))}.items():handler.headers[key]=value
            handler.send_json=MagicMock()
            with patch.object(bridge,"read_stop",return_value={"owner":"alice","stop_position":row}),patch.object(bridge,"push") as push:handler.do_POST()
            push.assert_not_called();self.assertEqual(handler.send_json.call_args.args[1],status)

if __name__=="__main__":unittest.main(verbosity=2)
