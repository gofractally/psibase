"""Bounded owner-wallet preparation; these tests do not simulate matching."""
import copy
import io
import importlib.util
import json
from email.message import Message
from pathlib import Path
import unittest
from unittest.mock import patch,MagicMock

spec=importlib.util.spec_from_file_location("wallet_prep_bridge",Path(__file__).with_name("bridge.py"))
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

def snapshot(auto=False):
    return {"owner":"alice","markets":[{"id":1,"base":1,"quote":2,
            "base_lot":10000,"quote_tick":1,"x":11,"y":19,"lp_supply":7}],
            "balances":[{"token":token,"wallet":1000,"incoming":0,"outgoing":0,"auto_debit":auto}
                        for token in (1,2)],"positions":[],"loans":[],"loan_positions":[],"stop_positions":[]}

class NativeWallet:
    """Apply only native transfer/receipt effects for transaction construction."""
    def __init__(self,state):self.state=copy.deepcopy(state);self.calls=[]
    def row(self,token):return next(row for row in self.state["balances"] if row["token"]==token)
    def read(self,account):
        assert account=="alice"
        return copy.deepcopy(self.state)
    def receive(self,token,amount):
        row=self.row(token)
        row["wallet" if row["auto_debit"] else "incoming"]+=amount
    def push(self,actions):
        self.calls.append(copy.deepcopy(actions))
        for action in actions:
            assert action["sender"]=="alice"
            method,args=action["method"],action["data"]
            if method=="settle":
                pos=next(p for p in self.state["positions"] if p["market"]==args["market"] and p["price"]==args["price"] and p["bid"]==args["bid"])
                market=next(m for m in self.state["markets"] if m["id"]==pos["market"])
                self.receive(market["base"] if pos["bid"] else market["quote"],int(pos["proceeds"]))
                pos["proceeds"]=0
            elif method=="claim":
                pos=next(p for p in self.state["loan_positions"] if p["market"]==args["market"] and p["long"]==args["long"] and p["price"]==args["price"])
                loan=next(g for g in self.state["loans"] if g["generation"]==pos["generation"])
                market=next(m for m in self.state["markets"] if m["id"]==pos["market"])
                paid=int(loan["claimable_surplus"]) if "claimable_surplus" in loan else int(pos["units"])*int(loan["original_surplus"])//int(loan["original_units"])
                self.receive(market["quote"] if pos["long"] else market["base"],paid)
                self.state["loan_positions"].remove(pos)
            elif method=="claimstop":
                pos=next(p for p in self.state["stop_positions"] if p["generation"]==args["generation"])
                market=next(m for m in self.state["markets"] if m["id"]==pos["market"])
                self.receive(market["base"] if pos["sell_base"] else market["quote"],int(pos["claimable_input"]))
                self.receive(market["quote"] if pos["sell_base"] else market["base"],int(pos["claimable_output"]))
                self.state["stop_positions"].remove(pos)
            elif method in ("credit","debit","uncredit"):
                row=self.row(args["token_id"]);amount=args["amount"]["value"]
                if method=="credit":row["wallet"]-=amount;row["outgoing"]+=amount
                else:row["incoming" if method=="debit" else "outgoing"]-=amount;row["wallet"]+=amount
                assert all(row[k]>=0 for k in ("wallet","incoming","outgoing"))
        return {"actionTraces":[]}

class PreparationTests(unittest.TestCase):
    def with_wallet(self,wallet,call):
        with patch.object(bridge,"read_state",side_effect=wallet.read),patch.object(bridge,"push",side_effect=wallet.push):return call()
    def test_ready_cash_withdrawal_never_realizes_unrelated_receipts(self):
        state=snapshot();state["balances"][0]["outgoing"]=10
        state["positions"]=[{"owner":"alice","market":1,"bid":True,"price":p,"proceeds":1} for p in range(1,131)]
        wallet=NativeWallet(state)
        self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",1,5,False))
        self.assertEqual([[a["method"] for a in call] for call in wallet.calls],[["uncredit"]])
        self.assertTrue(all(p["proceeds"]==1 for p in wallet.state["positions"]))
    def test_more_than_64_receipts_make_bounded_progress_then_retry_succeeds(self):
        for auto in (False,True):
            state=snapshot(auto);state["positions"]=[{"owner":"alice","market":1,"bid":True,"price":p,"proceeds":1} for p in range(1,66)]
            wallet=NativeWallet(state)
            with self.assertRaises(bridge.PreparationProgress) as result:
                self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",1,65,False))
            self.assertEqual(len(wallet.calls),2);self.assertEqual(result.exception.progress["prepared"],64)
            self.assertTrue(all(sum(a["method"]=="settle" for a in call)==32 for call in wallet.calls))
            self.assertEqual(wallet.row(1)["incoming"]+wallet.row(1)["outgoing"],64)
            self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",1,65,False))
            self.assertEqual(wallet.row(1)["wallet"],1065)
            self.assertEqual(wallet.row(1)["incoming"]+wallet.row(1)["outgoing"],0)
    def test_partial_stop_returns_both_assets_and_prefunds_each_native_setting(self):
        for auto in (False,True):
            state=snapshot(auto);state["stop_positions"]=[{"owner":"alice","generation":7,"market":1,"sell_base":True,
                "status":"partially_filled","remaining_outgoing":0,"claimable_input":3,"claimable_output":8,"can_claim":True}]
            wallet=NativeWallet(state)
            self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",2,8,False))
            self.assertEqual(wallet.row(2)["wallet"],1008)
            self.assertEqual(wallet.row(1)["incoming"]+wallet.row(1)["outgoing"],3)
            self.assertEqual([a["method"] for a in wallet.calls[0]],["claimstop","credit","credit"] if auto else ["claimstop"])
    def test_fully_unfilled_stop_refund_is_available_without_output(self):
        for auto in (False,True):
            state=snapshot(auto);state["stop_positions"]=[{"owner":"alice","generation":7,"market":1,"sell_base":True,
                "status":"unfilled","remaining_outgoing":0,"claimable_input":8,"claimable_output":0}]
            wallet=NativeWallet(state)
            self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",1,8,False))
            self.assertEqual(wallet.row(1)["wallet"],1008);self.assertEqual(wallet.state["stop_positions"],[])
    def test_maker_loan_and_stop_receipts_combine_without_double_counting(self):
        for auto in (False,True):
            state=snapshot(auto)
            state["positions"]=[{"owner":"alice","market":1,"bid":False,"price":90,"proceeds":11}]
            state["loan_positions"]=[{"owner":"alice","generation":5,"market":1,"long":True,"price":80,"units":2}]
            state["loans"]=[{"generation":5,"active":False,"claimable_surplus":17}]
            state["stop_positions"]=[{"owner":"alice","generation":7,"market":1,"sell_base":True,
                "status":"partially_filled","claimable_input":3,"claimable_output":23}]
            wallet=NativeWallet(state)
            self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",2,51,False))
            self.assertEqual(wallet.row(2)["wallet"],1051)
            self.assertEqual(wallet.row(1)["incoming"]+wallet.row(1)["outgoing"],3)
            self.assertEqual([a["method"] for a in wallet.calls[0]][:3],["settle","claim","claimstop"])
    def test_foreign_unfunded_armed_and_unclaimable_stops_are_never_prepared(self):
        state=snapshot()
        base={"owner":"alice","generation":7,"market":1,"sell_base":True,"status":"filled","claimable_input":0,"claimable_output":8}
        state["stop_positions"]=[dict(base,owner="bob"),dict(base,status="armed"),dict(base,can_claim=False),dict(base,market=99)]
        self.assertEqual(bridge.claim_entries("alice",state),[])
        state["stop_positions"]=[base];state["markets"][0]["escrow_quote"]={"funded":False}
        self.assertEqual(bridge.claim_entries("alice",state),[])
    def test_auto_receipts_across_many_tokens_stay_within_action_budget(self):
        state=snapshot(True)
        for index in range(32):
            token,market=index+3,index+2
            state["markets"].append({"id":market,"base":token,"quote":2})
            state["balances"].append({"token":token,"wallet":1000,"incoming":0,"outgoing":0,"auto_debit":True})
            state["stop_positions"].append({"owner":"alice","generation":index+7,"market":market,"sell_base":True,
                "status":"partially_filled","claimable_input":1,"claimable_output":1})
        wallet=NativeWallet(state)
        self.with_wallet(wallet,lambda:bridge.wallet_transfer("alice",2,32,False))
        self.assertEqual([len(call) for call in wallet.calls],[63,3,1])
        self.assertEqual(wallet.row(2)["wallet"],1032)
        self.assertTrue(all(wallet.row(token)["outgoing"]==1 for token in range(3,35)))
    def test_exact_funding_requirements_cover_both_sides_and_round_up_liquidity(self):
        state=snapshot()
        self.assertEqual(bridge.required_inputs(state,"create",dict(base=1,quote=2,base_amount="9",quote_amount="11")),{1:9,2:11})
        self.assertEqual(bridge.required_inputs(state,"addliq",dict(market=1,shares=3)),{1:5,2:9})
        self.assertEqual(bridge.required_inputs(state,"borrow",dict(market=1,long=True,price=90,units=2)),{1:40000})
        self.assertEqual(bridge.required_inputs(state,"borrow",dict(market=1,long=False,price=90,units=2)),{2:360})
        self.assertEqual(bridge.required_inputs(state,"repay",dict(market=1,long=True,price=90,units=2)),{2:180})
        self.assertEqual(bridge.required_inputs(state,"stop",dict(market=1,sell_base=False,amount="1099511627775")),{2:1099511627775})
        with self.assertRaises(ValueError):bridge.required_inputs(state,"stop",dict(market=1,sell_base=False,amount="1099511627776"))
        with self.assertRaises(ValueError):bridge.required_inputs(state,"stop",dict(market=1,sell_base="false",amount=1))
    def test_unknown_final_submission_is_never_retried(self):
        state=snapshot();state["balances"][0]["outgoing"]=10
        with patch.object(bridge,"read_state",return_value=state),patch.object(bridge,"push",side_effect=TimeoutError("unknown submission")) as push:
            with self.assertRaises(TimeoutError):bridge.exchange_action("alice","stop",dict(market=1,sell_base=True,trigger=90,amount=1))
        self.assertEqual(push.call_count,1)
    def test_unknown_preparation_is_not_retried_and_next_request_reads_native_state(self):
        state=snapshot(True);state["positions"]=[{"owner":"alice","market":1,"bid":True,"price":90,"proceeds":10}]
        wallet=NativeWallet(state)
        def unknown(actions):
            wallet.push(actions)
            raise TimeoutError("unknown preparation")
        with patch.object(bridge,"read_state",side_effect=wallet.read),patch.object(bridge,"push",side_effect=unknown) as push:
            with self.assertRaises(TimeoutError):bridge.exchange_action("alice","stop",dict(market=1,sell_base=True,trigger=90,amount=5))
        self.assertEqual(push.call_count,1);self.assertEqual(wallet.state["positions"][0]["proceeds"],0)
        self.with_wallet(wallet,lambda:bridge.exchange_action("alice","stop",dict(market=1,sell_base=True,trigger=90,amount=5)))
        self.assertEqual([[a["method"] for a in call] for call in wallet.calls],[["settle","credit"],["stop"]])
    def test_http_progress_is_explicit_without_an_automatic_order_retry(self):
        payload=json.dumps({"account":"alice","tokenId":1,"amount":"65"}).encode()
        handler=object.__new__(bridge.Handler);handler.path="/api/withdraw";handler.rfile=io.BytesIO(payload)
        handler.headers=Message();handler.headers["Host"]=f"127.0.0.1:{bridge.PORT}"
        handler.headers["Origin"]=bridge.NATIVE_UI_ORIGIN;handler.headers["Content-Type"]="application/json"
        handler.headers["Content-Length"]=str(len(payload));handler.send_json=MagicMock()
        with patch.object(bridge,"wallet_transfer",side_effect=bridge.PreparationProgress(64,2,"withdrawal")) as transfer:
            handler.do_POST()
        self.assertEqual(transfer.call_count,1)
        body,status=handler.send_json.call_args.args
        self.assertEqual(status,409);self.assertEqual(body["progress"],{"prepared":64,"transactions":2})
        self.assertEqual(body["error"],"Your balance is updating; retry the withdrawal.")
    def test_non_integer_and_boolean_financial_quantities_are_rejected(self):
        for value in (True,1.5,"-1","1e3","١","",None):
            with self.assertRaises(ValueError):bridge.quantity(value)

if __name__=="__main__":unittest.main(verbosity=2)
