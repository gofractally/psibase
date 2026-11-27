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
# A chain that is not the loopback fixture: reached through a proxy (the
# node's Unix socket), with accounts that sign, and with the node's HTTP
# listener and public host name given separately.
PROXY = os.environ.get("EXCHANGE_PROXY")
KEYS = os.environ.get("EXCHANGE_KEYS")
_PORT = urlsplit(API).port or 80
LOCAL = os.environ.get("EXCHANGE_LOCAL", f"127.0.0.1:{_PORT}")
HOST = os.environ.get("EXCHANGE_HOST", f"exchange.psibase.localhost:{_PORT}")
LOCAL_HEADERS = {"X-Psibase-Local": "1"} if os.environ.get("EXCHANGE_LOCAL_OPERATOR") else {}
NODE_ARGS = ["-a", API] + (["--proxy", PROXY] if PROXY else [])


def sign_flags(senders):
    """--sign for each sender that has a key file under EXCHANGE_KEYS."""
    flags = []
    if KEYS:
        for sender in dict.fromkeys(senders):
            key = Path(KEYS) / f"{sender}.key.pem"
            if key.exists():
                flags += ["--sign", str(key)]
    return flags
NATIVE_UI_ORIGIN = f"http://exchange.psibase.localhost:{urlsplit(API).port or 80}"
UI_ORIGINS = (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}", NATIVE_UI_ORIGIN)
ACCOUNTS = {"alice", "bob", "carol", "liquidity"}
METHODS = {"create", "trade", "limit", "cancel", "lend", "unlend", "borrow",
           "repay", "liquidate", "addliq", "remliq", "claim", "settle", "renew",
           "stop", "cancelstop", "claimstop", "process"}
LOCK = threading.RLock()
AUTH = {}


def bearer(account):
    """Authenticate once, then use native owner-authorized read-only queries."""
    with LOCK:
        cached = AUTH.get(account)
        if cached and time.monotonic() - cached[0] < 240:
            return cached[1]
        result = subprocess.run([CLI, "login", *NODE_ARGS, *sign_flags([account]), account],
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
        result = subprocess.run([CLI, "push", *NODE_ARGS, "--trace", "json",
                                 "--console=false",
                                 *sign_flags(a["sender"] for a in actions), "-"],
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
        f"http://{LOCAL}/snapshot?owner={account}",
        headers={**LOCAL_HEADERS, "Host": HOST,
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
        f"http://{LOCAL}/tokens?after={after}&limit={limit}",
        headers={**LOCAL_HEADERS, "Host": HOST})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.load(reply)


def read_trades(market, limit="50", before=None, after=None):
    def parsed(value, label, maximum, minimum=0):
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise ValueError(f"Invalid {label}")
        text = str(value)
        if not text.isascii() or not text.isdigit():
            raise ValueError(f"Invalid {label}")
        result = int(text)
        if not minimum <= result <= maximum:
            raise ValueError(f"Invalid {label}")
        return result
    market = parsed(market, "trade market", (1 << 64) - 1, 1)
    limit = parsed(limit, "trade page size", 100, 1)
    cursor = "" if before is None else f"&before={parsed(before, 'trade cursor', (1 << 64) - 1)}"
    cursor += "" if after is None else f"&after={parsed(after, 'trade cursor', (1 << 64) - 1)}"
    endpoint = urlsplit(API)
    req = urllib.request.Request(
        f"http://{LOCAL}/trades?market={market}&limit={limit}{cursor}",
        headers={**LOCAL_HEADERS, "Host": HOST})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.load(reply)


MAX_AMOUNT = (1 << 40) - 1
CLAIMS_PER_PREPARATION = 32
MAX_PREPARATIONS = 2
MAX_PREPARATION_ACTIONS = 64
FUNDED_METHODS = {"create", "trade", "limit", "stop", "lend", "borrow", "repay", "addliq"}


def uint(value, label, maximum=(1 << 64) - 1, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError(f"Invalid {label}")
    text = str(value)
    if not text.isascii() or not text.isdigit() or not minimum <= int(text) <= maximum:
        raise ValueError(f"Invalid {label}")
    return int(text)


def quantity(value):
    return {"value": uint(value, "positive token quantity", minimum=1)}


def private_stop_query(account, path, retry=True):
    if account not in ACCOUNTS:
        raise ValueError("Unknown demo wallet")
    endpoint = urlsplit(API)
    req = urllib.request.Request(
        f"http://{LOCAL}{path}",
        headers={**LOCAL_HEADERS, "Host": HOST,
                 "Authorization": bearer(account)})
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            data = json.load(reply)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 403):raise
        AUTH.pop(account, None)
        if retry:return private_stop_query(account, path, False)
        raise ValueError("Native stop authorization failed") from error
    if isinstance(data, str):data = json.loads(data)
    if not isinstance(data, dict) or data.get("owner") != account:
        raise ValueError("Native stop owner mismatch")
    return data


def read_stops(account, before=None, limit=100):
    limit = uint(limit, "stop page size", 200, 1)
    cursor = None if before is None else uint(before, "stop cursor")
    suffix = "" if cursor is None else f"&before={cursor}"
    data = private_stop_query(account, f"/stops?owner={account}&limit={limit}{suffix}")
    rows = data.get("stop_positions")
    if not isinstance(rows, list) or len(rows) > limit:
        raise ValueError("Invalid native stop page")
    previous = cursor if cursor is not None else 1 << 64
    for row in rows:
        generation = uint(row.get("generation"), "native stop generation", minimum=1)
        if row.get("owner") != account or generation >= previous:
            raise ValueError("Invalid native stop page owner or order")
        previous = generation
    next_before = data.get("next_before")
    if next_before is not None and (not rows or uint(next_before, "native stop cursor") != previous):
        raise ValueError("Invalid native stop page cursor")
    return data


def read_stop(account, generation):
    generation = uint(generation, "stop generation", minimum=1)
    data = private_stop_query(account, f"/stop?owner={account}&generation={generation}")
    row = data.get("stop_position")
    if row is not None and (not isinstance(row, dict) or row.get("owner") != account or
                            uint(row.get("generation"), "native stop generation", minimum=1) != generation):
        raise ValueError("Native stop position mismatch")
    return data


def claim_entries(account, state):
    """Exact native owner receipts; no shared pool accounting is reproduced."""
    entries = []
    markets = {int(m["id"]): m for m in state["markets"]}
    def eligible(position):
        if position.get("owner", account) != account:
            return None
        market = markets.get(int(position["market"]))
        if market is None or market.get("legacy_unsupported", False):
            return None
        for key in ("escrow_base", "escrow_quote"):
            if key in market and market[key].get("funded") is not True:
                return None
        return market
    def append(method, args, payouts):
        paid = {int(token): uint(amount, "native payout") for token, amount in payouts.items() if int(amount)}
        if paid:
            entries.append((action(account, "exchange", method, args), paid))
    for position in state.get("positions", []):
        market = eligible(position)
        if market is not None:
            append("settle", {"market": position["market"], "bid": position["bid"], "price": position["price"]},
                   {market["base"] if position["bid"] else market["quote"]: position.get("proceeds", 0)})
    loans = {int(g["generation"]): g for g in state.get("loans", [])}
    for position in state.get("loan_positions", []):
        loan = loans.get(int(position["generation"]))
        market = eligible(position)
        if loan and not loan["active"] and market is not None:
            paid = (int(loan["claimable_surplus"]) if "claimable_surplus" in loan else
                    int(position["units"]) * int(loan["original_surplus"]) // int(loan["original_units"]))
            append("claim", {"market": position["market"], "long": position["long"], "price": position["price"]},
                   {market["quote"] if position["long"] else market["base"]: paid})
    for position in state.get("stop_positions", []):
        market = eligible(position)
        if (market is None or position.get("status") not in ("filled", "partially_filled", "unfilled") or
                position.get("can_claim") is False):
            continue
        input_token = market["base"] if position["sell_base"] else market["quote"]
        output_token = market["quote"] if position["sell_base"] else market["base"]
        append("claimstop", {"generation": position["generation"]},
               {input_token: position.get("claimable_input", 0), output_token: position.get("claimable_output", 0)})
    return entries


def selected_settlements(entries):
    actions, accrued = [], {}
    for claim, payouts in entries:
        actions.append(claim)
        for token, amount in payouts.items():
            accrued[token] = accrued.get(token, 0) + amount
    return actions, accrued


def settlements(account, state):
    """Compatibility helper for the demo maker: one bounded owner batch."""
    return selected_settlements(claim_entries(account, state)[:CLAIMS_PER_PREPARATION])


def required_inputs(state, method, args):
    """Derive only native action inputs, using exact integer service formulas."""
    def amount(name):return uint(args.get(name), name, MAX_AMOUNT, 1)
    def side(name):
        result = args.get(name)
        if not isinstance(result, bool):raise ValueError(f"Invalid {name}")
        return result
    def capped(value):return uint(value, "committed amount", MAX_AMOUNT, 1)
    if method == "create":
        base = uint(args.get("base"), "base token", (1 << 32) - 1)
        quote = uint(args.get("quote"), "quote token", (1 << 32) - 1)
        if base == quote:raise ValueError("Choose two different tokens")
        return {base: amount("base_amount"), quote: amount("quote_amount")}
    if method not in FUNDED_METHODS:return {}
    market_id = uint(args.get("market"), "market", minimum=1)
    market = next((m for m in state["markets"] if int(m["id"]) == market_id), None)
    if market is None:raise ValueError("Unknown market")
    base, quote = int(market["base"]), int(market["quote"])
    if method in ("trade", "stop"):
        return {base if side("sell_base") else quote: amount("amount")}
    if method == "limit":return {quote if side("bid") else base: amount("amount")}
    if method == "lend":return {base if side("base") else quote: amount("amount")}
    if method in ("borrow", "repay"):
        long = side("long");units, price = amount("units"), amount("price")
        face = capped(units * (price * int(market["quote_tick"]) if long else int(market["base_lot"])))
        if method == "repay":return {quote if long else base: face}
        collateral = capped(2 * units * (int(market["base_lot"]) if long else price * int(market["quote_tick"])))
        return {base if long else quote: collateral}
    if method == "addliq":
        shares, supply = amount("shares"), int(market["lp_supply"])
        capped(supply + shares)
        return {base: capped((shares * int(market["x"]) + supply - 1) // supply),
                quote: capped((shares * int(market["y"]) + supply - 1) // supply)}
    return {}


def shared_available(state, token):
    row = next((row for row in state.get("balances", [])
                if int(row.get("token_id", row.get("token", 0))) == int(token)), {})
    return int(row.get("incoming", 0)) + int(row.get("outgoing", 0))


class PreparationProgress(ValueError):
    def __init__(self, prepared, transactions, context):
        super().__init__(f"Your balance is updating; retry the {context}.")
        self.progress = {"prepared": prepared, "transactions": transactions}


def prepare_funds(account, required, current=None, context="order"):
    """At most two owner receipt transactions; final orders are never retried."""
    current = read_state(account) if current is None else current
    prepared = 0
    for step in range(MAX_PREPARATIONS + 1):
        needed = required(current) if callable(required) else required
        missing = {int(token): amount - shared_available(current, token)
                   for token, amount in needed.items() if amount > shared_available(current, token)}
        if not missing:return current
        entries = claim_entries(account, current)
        total = {token: sum(payouts.get(token, 0) for _, payouts in entries) for token in missing}
        if any(total[token] < amount for token, amount in missing.items()):
            raise ValueError("Insufficient available funds; deposit funds or reduce the amount")
        if step == MAX_PREPARATIONS:
            raise PreparationProgress(prepared, step, context)
        chosen = []
        for entry in entries:
            if not any(amount > 0 and entry[1].get(token, 0) for token, amount in missing.items()):continue
            candidate, payouts = selected_settlements(chosen + [entry])
            if len(fund_claims(account, current, candidate, payouts)) > MAX_PREPARATION_ACTIONS:break
            chosen.append(entry)
            for token in missing:missing[token] -= entry[1].get(token, 0)
            if len(chosen) == CLAIMS_PER_PREPARATION or all(amount <= 0 for amount in missing.values()):break
        actions, accrued = selected_settlements(chosen)
        # Re-credit every AUTO_DEBIT receipt inside this same transaction.
        # A later withdrawal then consumes fresh shared balances exactly once.
        actions = fund_claims(account, current, actions, accrued)
        assert len(actions) <= MAX_PREPARATION_ACTIONS
        push(actions)
        prepared += len(chosen)
        current = read_state(account)
    raise AssertionError("bounded preparation exhausted")


def exchange_action(account, method, args):
    if method not in METHODS:raise ValueError("Unsupported exchange action")
    if not isinstance(args, dict):raise ValueError("Invalid action arguments")
    if method in FUNDED_METHODS:
        prepare_funds(account, lambda state: required_inputs(state, method, args))
    # Never retry this push, including if its submission result is unknown.
    return push([action(account, "exchange", method, args)])


class StopNotFound(ValueError):
    pass


def release_stop(account, generation):
    """Realize one freshly verified old receipt without replay or stale cash."""
    row = read_stop(account, generation)["stop_position"]
    if row is None:raise StopNotFound("This stop order is no longer available.")
    if row.get("status") not in ("filled", "partially_filled", "unfilled"):
        raise ValueError("This stop order is still waiting for its trigger.")
    payouts, flags = {}, []
    for side, field in (("input", "claimable_input"), ("output", "claimable_output")):
        token = uint(row.get(f"{side}_token"), "receipt token", (1 << 32) - 1)
        amount = uint(row.get(field, 0), "receipt amount")
        auto = row.get(f"{side}_auto_debit")
        if not isinstance(auto, bool):raise ValueError("Native receipt settings unavailable; refresh and try again.")
        if amount:payouts[token] = payouts.get(token, 0) + amount
        flags.append({"token": token, "auto_debit": auto})
    if flags[0]["token"] == flags[1]["token"]:
        raise ValueError("Invalid native receipt assets")
    actions = fund_claims(account, {"balances": flags},
                          [action(account, "exchange", "claimstop", {"generation": generation})], payouts)
    # A failure, including an unknown submission outcome, is never retried.
    return push(actions)


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
    """Withdraw ready native cash directly; realize only needed owner receipts."""
    token = uint(token, "token", (1 << 32) - 1)
    q = quantity(amount)
    amount = q["value"]
    if depositing:
        return push([action(account, "tokens", "credit", {
            "token_id": token, "debitor": "exchange", "amount": q,
            "memo": "Exchange deposit"})])
    state = prepare_funds(account, {token: amount}, context="withdrawal")
    row = next((r for r in state.get("balances", [])
                if int(r.get("token_id", r.get("token", 0))) == token), {})
    incoming = int(row.get("incoming", 0))
    accept = min(incoming, amount)
    actions = []
    if accept:
        actions.append(action(account, "tokens", "debit", {
            "token_id": token, "creditor": "exchange", "amount": quantity(accept),
            "memo": "Exchange withdrawal"}))
    if amount > accept:
        actions.append(action(account, "tokens", "uncredit", {
            "token_id": token, "debitor": "exchange", "amount": quantity(amount - accept),
            "memo": "Exchange withdrawal"}))
    return push(actions)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "packages/user/Exchange/ui/dist"), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        if origin in UI_ORIGINS:
            # Only this local account UI may use the development wallet.
            # No wildcard, credential cookie, or arbitrary Psibase subdomain.
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
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

    def do_OPTIONS(self):
        requested = self.headers.get("Access-Control-Request-Method", "")
        headers = {h.strip().lower() for h in self.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
        if (not self.local_host() or self.headers.get("Origin") not in UI_ORIGINS or
                requested not in ("GET", "POST") or not headers.issubset({"content-type"})):
            self.send_json({"error": "Local wallet preflight rejected"}, 403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

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
            elif parsed.path == "/api/trades":
                query = parse_qs(parsed.query, keep_blank_values=True)
                self.send_json(read_trades(query.get("market", [None])[0],
                                          query.get("limit", ["50"])[0],
                                          query.get("before", [None])[0],
                                          query.get("after", [None])[0]))
            elif parsed.path == "/api/stops":
                query = parse_qs(parsed.query, keep_blank_values=True)
                self.send_json(read_stops(query.get("account", ["alice"])[0],
                                          query.get("before", [None])[0],
                                          query.get("limit", ["100"])[0]))
            elif parsed.path == "/api/stop":
                query = parse_qs(parsed.query, keep_blank_values=True)
                self.send_json(read_stop(query.get("account", ["alice"])[0],
                                         query.get("generation", [None])[0]))
            else:
                super().do_GET()
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
        except Exception as error:
            self.send_json({"error": str(error)}, 503)

    def do_POST(self):
        try:
            if not self.local_host():
                raise ValueError("Local wallet host required")
            origin = self.headers.get("Origin")
            if origin and origin not in UI_ORIGINS:
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
                trace = exchange_action(account, method, data.get("args", {}))
            elif self.path in ("/api/deposit", "/api/withdraw"):
                trace = wallet_transfer(account, data["tokenId"], data["amount"], self.path.endswith("deposit"))
            elif self.path == "/api/release-stop":
                trace = release_stop(account, data.get("generation"))
            else:
                raise ValueError("Unknown wallet endpoint")
            self.send_json({"ok": True, "trace": trace})
        except PreparationProgress as error:
            self.send_json({"ok": False, "error": str(error), "progress": error.progress}, 409)
        except StopNotFound as error:
            self.send_json({"error": str(error)}, 404)
        except Exception as error:
            self.send_json({"error": str(error)}, 400)


if __name__ == "__main__":
    print(f"Development wallet adapter: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
