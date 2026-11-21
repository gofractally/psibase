#!/usr/bin/env python3
"""Loopback-only development wallet for the actual Psibase exchange service.

No exchange accounting lives here. Transactions execute in psinode; GETs read
the native query service. AuthAny demo identities must never be used on a
public deployment. The UI can replace this adapter with its own wallet/plugin.
"""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
CLI = os.environ.get("EXCHANGE_CLI", str(ROOT / "rust/target/release/psibase"))
API = os.environ.get("EXCHANGE_CHAIN", "http://psibase.localhost:8089/")
PORT = int(os.environ.get("EXCHANGE_PORT", "8090"))
ACCOUNTS = {"alice", "bob", "carol", "liquidity"}
METHODS = {"create", "trade", "limit", "cancel", "lend", "unlend", "borrow",
           "repay", "liquidate", "addliq", "remliq", "claim", "settle", "renew"}
LOCK = threading.RLock()
AUTH = {}


def bearer(account):
    """Authenticate once, then use native owner-authorized read-only queries."""
    with LOCK:
        cached = AUTH.get(account)
        if cached and time.monotonic() - cached[0] < 240:
            return cached[1]
        result = subprocess.run([CLI, "login", "-a", API, account],
                                capture_output=True, text=True, timeout=60)
        token = result.stdout.strip()
        if result.returncode or not token.lower().startswith("bearer "):
            raise ValueError("Native wallet authentication failed: " + result.stderr[-1000:])
        token = "Bearer " + token.split(" ", 1)[1]
        AUTH[account] = time.monotonic(), token
        return token


def native_numbers(value):
    if isinstance(value, dict):
        return {k: native_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [native_numbers(v) for v in value]
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    return value


def push(actions):
    """Uses on-chain schemas to pack/sign and push one atomic transaction."""
    with LOCK:
        result = subprocess.run([CLI, "push", "-a", API, "--trace", "json",
                                 "--console=false", "-"],
                                input=json.dumps(actions), text=True,
                                capture_output=True, timeout=120)
    try:
        trace = json.loads(result.stdout)
    except json.JSONDecodeError:
        trace = {}
    if result.returncode or trace.get("error"):
        raise ValueError(trace.get("error") or result.stderr[-4000:] or result.stdout[-4000:])
    # Current Psibase wraps requested actions in a transact trace. Present the
    # requested action results in submission order, retaining their real inner
    # traces, rather than mistaking the outer transact's empty return for them.
    def walk(item):
        yield item
        for inner in item.get("innerTraces", []):
            child = inner.get("inner", {}).get("ActionTrace")
            if child:
                yield from walk(child)
    flattened = [item for top in trace.get("actionTraces", []) for item in walk(top)]
    selected, offset = [], 0
    for requested in actions:
        for index in range(offset, len(flattened)):
            entry = flattened[index]
            actual = entry.get("action", {})
            if (actual.get("sender") == requested["sender"] and
                    actual.get("service") == requested["service"] and
                    actual.get("method", "").casefold() == requested["method"].casefold()):
                selected.append(entry)
                offset = index + 1
                break
        else:
            raise ValueError("Confirmed transaction did not contain the requested action trace")
    return {"actionTraces": selected, "error": None}


def action(account, service, method, args):
    return {"sender": account, "service": service, "method": method,
            "data": native_numbers(args)}


def read_state(account, retry=True):
    # Override Host explicitly: no dependency on OS resolution of *.localhost.
    endpoint = urlsplit(API)
    req = urllib.request.Request(
        f"http://127.0.0.1:{endpoint.port or 80}/snapshot?owner={account}",
        headers={"Host": f"exchange.psibase.localhost:{endpoint.port or 80}",
                 "Authorization": bearer(account)})
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            state = json.load(reply)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 403):
            raise
        AUTH.pop(account, None)
        if retry:
            return read_state(account, False)
        raise ValueError("Native snapshot authorization failed") from error
    if isinstance(state, str):
        state = json.loads(state)
    state["network"] = "Psibase local development chain"
    state["accounts"] = sorted(ACCOUNTS)
    return state


def read_tokens(after=0, limit=200):
    after, limit = int(after), int(limit)
    if not 0 <= after <= (1 << 32) - 1 or not 1 <= limit <= 200:
        raise ValueError("Invalid native token cursor or page size")
    endpoint = urlsplit(API)
    req = urllib.request.Request(
        f"http://127.0.0.1:{endpoint.port or 80}/tokens?after={after}&limit={limit}",
        headers={"Host": f"exchange.psibase.localhost:{endpoint.port or 80}"})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.load(reply)


def quantity(value):
    number = int(value)
    if not 0 < number <= (1 << 64) - 1:
        raise ValueError("Amount must be a positive token quantity")
    return {"value": number}


def settlements(account, state):
    """Owner pays for its own funded claims, folded into the same transaction."""
    actions, accrued = [], {}
    markets = {int(m["id"]): m for m in state["markets"]}
    def available_market(mid):
        market = markets.get(int(mid))
        if market is None or market.get("legacy_unsupported", False):
            return None
        for key in ("escrow_base", "escrow_quote"):
            if key in market and market[key].get("funded") is not True:
                return None
        return market
    for pos in state.get("positions", []):
        paid = int(pos.get("proceeds", 0))
        m = available_market(pos["market"])
        if paid and m is not None:
            token = int(m["base"] if pos["bid"] else m["quote"])
            accrued[token] = accrued.get(token, 0) + paid
            actions.append(action(account, "exchange", "settle", {
                "market": pos["market"], "bid": pos["bid"], "price": pos["price"]}))
    loans = {int(g["generation"]): g for g in state.get("loans", [])}
    for pos in state.get("loan_positions", []):
        g = loans.get(int(pos["generation"]))
        m = available_market(pos["market"])
        if g and not g["active"] and m is not None:
            paid = int(pos["units"]) * int(g["original_surplus"]) // int(g["original_units"])
            token = int(m["quote"] if pos["long"] else m["base"])
            accrued[token] = accrued.get(token, 0) + paid
            actions.append(action(account, "exchange", "claim", {
                "market": pos["market"], "long": pos["long"], "price": pos["price"]}))
    if len(actions) > 64:
        raise ValueError("Settle some existing positions before this wallet transaction")
    return actions, accrued


def fund_claims(account, state, actions, accrued, delivered_token=None, delivered=0):
    """Keep auto-accepted claims spendable, except cash being withdrawn.

    When AUTO_DEBIT is on, a native claim arrives in the owner's PRIMARY
    wallet. The same owner-authorized transaction credits it back to the
    exchange's revocable shared funding before the next exchange action.
    No other user's account or cached deposit balance is involved.
    """
    rows = {int(row.get("token_id", row.get("token", 0))): row
            for row in state.get("balances", [])}
    result = list(actions)
    for token, amount in sorted(accrued.items()):
        if rows.get(int(token), {}).get("auto_debit", False):
            keep = amount - (delivered if int(token) == delivered_token else 0)
            if keep:
                result.append(action(account, "tokens", "credit", {
                    "token_id": int(token), "debitor": "exchange",
                    "amount": quantity(keep), "memo": "Accrued exchange proceeds"}))
    return result


def wallet_transfer(account, token, amount, depositing):
    """Deposit credits user->DEX. Withdraw accepts/revokes native shared funds."""
    amount = int(amount)
    q = quantity(amount)
    if depositing:
        return push([action(account, "tokens", "credit", {
            "token_id": int(token), "debitor": "exchange", "amount": q,
            "memo": "Exchange deposit"})])
    state = read_state(account)
    actions, accrued = settlements(account, state)
    # Exchange outputs are DEX->user pending credits; deposited principal is
    # user->DEX pending credit. Neither is a cached synthetic balance.
    row = next((r for r in state.get("balances", [])
                if int(r.get("token_id", r.get("token", 0))) == int(token)), {})
    earned = accrued.get(int(token), 0)
    incoming = int(row.get("incoming", 0)) + earned
    outgoing = int(row.get("outgoing", 0))
    if amount > incoming + outgoing:
        raise ValueError("Insufficient free shared balance")
    # An auto-accepted claim is already in the primary wallet. Count that
    # delivery once, preserve any excess as shared funding, and withdraw only
    # the remaining request from previously pending balances.
    delivered = min(earned, amount) if row.get("auto_debit", False) else 0
    actions = fund_claims(account, state, actions, accrued, int(token), delivered)
    incoming -= delivered
    if row.get("auto_debit", False):
        # All earned proceeds were accepted/recredited, so only the original
        # incoming transfer plus recredited principal can be debited here.
        incoming = int(row.get("incoming", 0))
        outgoing += earned - delivered
    remaining = amount - delivered
    accept = min(incoming, remaining)
    if accept:
        actions.append(action(account, "tokens", "debit", {
            "token_id": int(token), "creditor": "exchange",
            "amount": quantity(accept), "memo": "Exchange withdrawal"}))
    if remaining > accept:
        actions.append(action(account, "tokens", "uncredit", {
            "token_id": int(token), "debitor": "exchange",
            "amount": quantity(remaining - accept), "memo": "Exchange withdrawal"}))
    return push(actions)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "packages/user/Exchange/ui/dist"), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def local_host(self):
        # Loopback binding alone does not prevent browser DNS rebinding.
        return self.headers.get("Host", "") in (
            f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def do_GET(self):
        if not self.local_host():
            self.send_json({"error": "Local wallet host required"}, 403)
            return
        parsed = urlsplit(self.path)
        try:
            if parsed.path == "/api/state":
                account = parse_qs(parsed.query).get("account", ["alice"])[0]
                if account not in ACCOUNTS:
                    raise ValueError("Unknown demo wallet")
                self.send_json(read_state(account))
            elif parsed.path == "/api/health":
                self.send_json({"chain": API, "wallet": "local demo", "ok": True})
            elif parsed.path == "/api/tokens":
                query = parse_qs(parsed.query)
                self.send_json(read_tokens(query.get("after", ["0"])[0],
                                           query.get("limit", ["200"])[0]))
            else:
                super().do_GET()
        except Exception as error:
            self.send_json({"error": str(error)}, 503)

    def do_POST(self):
        try:
            if not self.local_host():
                raise ValueError("Local wallet host required")
            origin = self.headers.get("Origin")
            if origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
                raise ValueError("Cross-origin wallet request rejected")
            if self.headers.get_content_type() != "application/json":
                raise ValueError("JSON request required")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(length))
            account = data.get("account")
            if account not in ACCOUNTS:
                raise ValueError("Unknown demo wallet")
            if self.path == "/api/action":
                method = data.get("method")
                if method not in METHODS:
                    raise ValueError("Unsupported exchange action")
                prefix = []
                if method not in {"claim", "settle", "liquidate", "cancel"}:
                    current = read_state(account)
                    prefix, accrued = settlements(account, current)
                    prefix = fund_claims(account, current, prefix, accrued)
                trace = push(prefix + [action(account, "exchange", method, data.get("args", {}))])
            elif self.path in ("/api/deposit", "/api/withdraw"):
                trace = wallet_transfer(account, data["tokenId"], data["amount"], self.path.endswith("deposit"))
            else:
                raise ValueError("Unknown wallet endpoint")
            self.send_json({"ok": True, "trace": trace})
        except Exception as error:
            self.send_json({"error": str(error)}, 400)


if __name__ == "__main__":
    print(f"Exchange demo: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
