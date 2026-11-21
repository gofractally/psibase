#!/usr/bin/env python3
"""Seed a FRESH local development chain with native, immutable BTC/USD tokens.

These are demo assets, not externally backed BTC or dollars. Administration
NFTs are burned after symbol mapping and issuance. All transactions are real.
"""
import json
from pathlib import Path
import subprocess
from bridge import ROOT, CLI, API, push, action, quantity


def call(sender, service, method, args):
    result = push([action(sender, service, method, args)])
    return result["actionTraces"][0].get("retval")


def create_account(name):
    result = subprocess.run([CLI, "create", "-a", API, "-i", "-S", "accounts", name],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)


def issue(symbol, precision, supply):
    token = int(call("liquidity", "tokens", "create", {
        "precision": precision, "max_issued_supply": quantity(supply)}))
    info = call("liquidity", "tokens", "getToken", {"token_id": token})
    admin = info["nft_id"]
    call("liquidity", "nft", "debit", {"nftId": admin, "memo": "Accept token administration"})
    call("liquidity", "tokens", "mint", {
        "token_id": token, "amount": quantity(supply), "memo": "Local demo issuance"})
    call("symbol", "symbol", "admin_create", {"symbol": symbol, "recipient": "liquidity"})
    name = call("liquidity", "symbol", "getSymbol", {"symbol": symbol})
    symbol_nft = name["ownerNft"]
    push([
        action("liquidity", "nft", "debit", {"nftId": symbol_nft, "memo": "Accept reserved symbol"}),
        action("liquidity", "nft", "credit", {"nft_id": symbol_nft, "debitor": "symbol", "memo": "Map reserved symbol"}),
        action("liquidity", "symbol", "mapSymbol", {"token_id": token, "symbol": symbol}),
        action("liquidity", "tokens", "setTokenConf", {"token_id": token, "index": 1, "enabled": True}),
        action("liquidity", "nft", "burn", {"nftId": admin}),
    ])
    print(f"Issued immutable native {symbol.upper()}, token #{token}", flush=True)
    return token


def main():
    marker = ROOT / "demo/seed.json"
    if marker.exists():
        raise RuntimeError("Demo is already seeded; refusing duplicate issuance")
    for wallet in ("alice", "bob", "carol", "liquidity"):
        create_account(wallet)
        call(wallet, "tokens", "setUserConf", {"index": 0, "enabled": False})
    btc = issue("btc", 8, 10_000 * 10**8)
    usd = issue("usd", 4, 1_000_000_000 * 10**4)
    for user in ("alice", "bob", "carol"):
        for token, amount in ((btc, 10 * 10**8), (usd, 1_000_000 * 10**4)):
            push([
                action("liquidity", "tokens", "credit", {"token_id": token, "debitor": user,
                       "amount": quantity(amount), "memo": "Local demo wallet funding"}),
                action(user, "tokens", "debit", {"token_id": token, "creditor": "liquidity",
                       "amount": quantity(amount), "memo": "Accept demo funds"}),
            ])
    for user in ("alice", "bob", "carol", "liquidity"):
        for token, amount in ((btc, (200 if user == "liquidity" else 2) * 10**8),
                              (usd, (20_000_000 if user == "liquidity" else 200_000) * 10**4)):
            call(user, "tokens", "credit", {"token_id": token, "debitor": "exchange",
                 "amount": quantity(amount), "memo": "Native shared exchange deposit"})
    market = int(call("liquidity", "exchange", "create", {
        "base": btc, "quote": usd, "base_amount": 100 * 10**8,
        "quote_amount": 10_000_000 * 10**4, "base_lot": 10_000, "quote_tick": 1}))
    call("liquidity", "exchange", "lend", {"market": market, "base": True, "amount": 50 * 10**8})
    call("liquidity", "exchange", "lend", {"market": market, "base": False, "amount": 5_000_000 * 10**4})
    for user, bid, price, amount in (
        ("alice", True, 99_000, 50_000 * 10**4),
        ("carol", True, 99_000, 25_000 * 10**4),
        ("bob", False, 101_000, 50_000_000),
        ("carol", False, 102_000, 25_000_000),
    ):
        call(user, "exchange", "limit", {"market": market, "bid": bid, "price": price, "amount": amount})
    # A live overcollateralized position, below its shared price trigger.
    call("alice", "exchange", "borrow", {"market": market, "long": True, "price": 80_000, "units": 100})
    metadata = {"base": btc, "quote": usd, "market": market, "price_usd": 100_000,
                "assets": "Local demonstration tokens; no external BTC/USD redemption"}
    marker.write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata), flush=True)


if __name__ == "__main__":
    main()
