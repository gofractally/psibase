#!/usr/bin/env python3
"""Create a persistent, signed USD demo circle on a local Favor chain.

The journal makes setup repeatable without resetting users' subsequent payments.
Private keys are local files with mode 0600, never source or website assets.
"""
import argparse
import json
import os
import secrets
import stat
import subprocess
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

PEOPLE = {
    "favordan": "Dan",
    "favormik": "Mike",
    "favorlea": "Leah",
    "favorcar": "Carol",
    "favornor": "Nora",
}
# Creditor, debtor, credit extended, creditor's forwarding fee TO the debtor.
LINES = [
    ("favormik", "favordan", "100", 0),
    ("favordan", "favormik", "100", 0),
    ("favorlea", "favordan", "100", 0),
    ("favordan", "favorlea", "100", 0),
    ("favorcar", "favormik", "200", 0),
    ("favormik", "favorcar", "100", 10000),
    ("favorcar", "favorlea", "200", 0),
    ("favorlea", "favorcar", "100", 20000),
    ("favornor", "favorcar", "200", 0),
    ("favorcar", "favornor", "100", 5000),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True)
    parser.add_argument("--api", default="http://psibase.localhost:8089/")
    parser.add_argument("--state-dir", type=Path, required=True)
    args = parser.parse_args()
    node = urlsplit(args.api)
    if node.hostname != "psibase.localhost" or node.scheme != "http":
        raise SystemExit("This demo seeder is restricted to the local psibase.localhost chain.")
    state_dir = args.state_dir.resolve()
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_dir.chmod(0o700)
    key_dir = state_dir / "keys"
    key_dir.mkdir(exist_ok=True, mode=0o700)
    key_dir.chmod(0o700)
    journal_file = state_dir / "seed.json"
    journal = json.loads(journal_file.read_text()) if journal_file.exists() else {
        "api": args.api, "completed": [], "references": {
            "carol-payment": secrets.token_hex(16),
            "nora-payment": secrets.token_hex(16),
            "repayment": secrets.token_hex(16),
        },
    }
    if journal["api"] != args.api:
        raise SystemExit("This state directory belongs to another chain URL.")

    def save():
        temporary = journal_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(journal, indent=2) + "\n")
        temporary.chmod(0o600)
        temporary.replace(journal_file)

    save()
    private = {}
    public = {}
    for account in PEOPLE:
        key = key_dir / (account + ".pem")
        pub = key_dir / (account + ".pub.pem")
        if not key.exists():
            fd = os.open(key, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "wb") as output:
                subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                                "ec_paramgen_curve:prime256v1"], stdout=output,
                               stderr=subprocess.PIPE, check=True)
        if key.is_symlink() or not key.is_file() or stat.S_IMODE(key.stat().st_mode) & 0o077:
            raise RuntimeError("Demo signing key must be a private regular file: " + str(key))
        subprocess.run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(pub)],
                       stderr=subprocess.PIPE, check=True)
        private[account], public[account] = key, pub

    def cli(command, *arguments, actors=(), input=None):
        cmd = [args.cli, command, "-a", args.api]
        for account in sorted(set(actors)):
            cmd += ["--sign", str(private[account])]
        result = subprocess.run(cmd + list(arguments), input=input, text=True,
                                capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stderr[-2000:])
        return result.stdout

    def push(actions):
        text = cli("push", "--trace", "json", "--console=false", "-",
                   actors=[a["sender"] for a in actions if a["sender"] in PEOPLE],
                   input=json.dumps(actions))
        trace = json.loads(text)
        if trace.get("error"):
            raise RuntimeError(trace["error"])

    tokens = {}

    def query(service, text, user=None):
        headers = {"Content-Type": "application/json"}
        if user:
            if user not in tokens or time.monotonic() - tokens[user][0] > 180:
                login = cli("login", user, actors=[user]).strip()
                tokens[user] = time.monotonic(), "Bearer " + login.split(" ", 1)[1]
            headers["Authorization"] = tokens[user][1]
        url = f"{node.scheme}://{service}.{node.netloc}/graphql"
        request = urllib.request.Request(url, data=json.dumps({"query": text}).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        if result.get("errors"):
            raise RuntimeError(result["errors"])
        return result["data"]

    def step(name, callback):
        if name not in journal["completed"]:
            callback()
            journal["completed"].append(name)
            save()
            print("Completed " + name, flush=True)

    def action(sender, method, data, service="favor"):
        return {"sender": sender, "service": service, "method": method, "data": data}

    for account in PEOPLE:
        info = query("accounts", "{getAccount(accountName:" + json.dumps(account) + "){authService}}")['getAccount']
        if not info:
            cli("create", "-S", "accounts", "-k", str(public[account]), account)
            print("Created signed demo account " + account, flush=True)
        else:
            if info["authService"] != "auth-sig":
                raise RuntimeError("Refusing to change an existing account's authority: " + account)
            actual = query("auth-sig", "{account(name:" + json.dumps(account) + "){active{key}}}")['account']['active']['key']
            if actual.strip() != public[account].read_text().strip():
                raise RuntimeError("Existing account uses another signing key: " + account)

    if not query("favor", "{settings{routingReady}}", "favordan")['settings']['routingReady']:
        raise RuntimeError("Favor's routing key must be initialized first.")

    for account, name in PEOPLE.items():
        def configure(account=account, name=name):
            actions = [action(account, "setProfile", {
                "display_name": name + " · Favor demo",
                "bio": "Demo identity. USD entries in this circle are test IOUs, not funded dollars.",
            }, "profiles"), action(account, "set_receiving", {"request_only": False})]
            actions += [action(account, "set_line", {"peer": debtor, "symbol": "USD", "limit": limit,
                         "fee_ppm": fee, "forwarding": True})
                        for creditor, debtor, limit, fee in LINES if creditor == account]
            push(actions)
        step("configure-" + account, configure)

    def quote(payee, amount, reference=None):
        arguments = {"payee": payee, "symbol": "USD", "amount": amount,
                     "reference": reference or secrets.token_hex(16)}
        fields = ','.join(k + ':' + json.dumps(v) for k, v in arguments.items())
        return query("favor", "{quote(" + fields + "){payee symbol amount total fee expiresAt reference encodedRoute}}",
                     "favordan")['quote']

    def payment(name, payee, amount, expected_total, memo):
        reference = journal["references"][name]
        q = quote(payee, amount, reference)
        if q["total"] != expected_total:
            raise RuntimeError("Unexpected demo route price: " + q["total"])
        push([action("favordan", "pay", {"payee": payee, "symbol": "USD", "amount": amount,
              "max_total": q["total"], "encoded_route": q["encodedRoute"],
              "reference": q["reference"], "memo": memo})])

    step("payment-to-carol", lambda: payment("carol-payment", "favorcar", "20", "20.2",
         "Demo setup: Dan pays Carol through Mike"))
    step("payment-to-nora", lambda: payment("nora-payment", "favornor", "10", "10.1505",
         "Demo setup: Dan pays Nora through Mike and Carol"))
    step("cash-repayment", lambda: push([action("favorcar", "settle", {
        "peer": "favormik", "symbol": "USD", "amount": "5",
        "nonce": journal["references"]["repayment"],
    })]))

    snapshots = {}
    for account in PEOPLE:
        snapshots[account] = query("favor", "{lines(first:100){nodes{peer symbol youExtend theyExtend theyOwe youOwe canPay yourFeePpm} } activity(first:20){nodes{kind incoming outgoing received sent earned memo}}}", account)
        snapshots[account]["lines"]["nodes"] = [r for r in snapshots[account]["lines"]["nodes"] if r["symbol"] == "USD"]
    q1, q2, q3 = quote("favorcar", "10"), quote("favornor", "10"), quote("favorcar", "80")
    checks = {
        "two_hop_10_USD": {k:q1[k] for k in ["amount", "fee", "total"]},
        "three_hop_10_USD": {k:q2[k] for k in ["amount", "fee", "total"]},
        "fallback_80_USD": {k:q3[k] for k in ["amount", "fee", "total"]},
    }
    # Do not assert initial balances on later runs: users' demo payments persist.
    if "verified-initial-state" not in journal["completed"]:
        assert q1["total"] == "10.1" and q2["total"] == "10.1505" and q3["total"] == "81.6"
        dan_mike = next(l for l in snapshots["favordan"]["lines"]["nodes"] if l["peer"] == "favormik")
        carol_mike = next(l for l in snapshots["favorcar"]["lines"]["nodes"] if l["peer"] == "favormik")
        assert dan_mike["youOwe"] == "30.3505" and carol_mike["theyOwe"] == "25.05"
        assert any(a["kind"] == "routed" and a["earned"] == "0.1005"
                   for a in snapshots["favormik"]["activity"]["nodes"])
        journal["completed"].append("verified-initial-state")
        save()
    summary = {"app": f"http://favor.{node.netloc}/", "symbol": "USD", "accounts": [
        {"account": a, "name": name, "private_key_file": str(private[a])} for a,name in PEOPLE.items()],
        "credit_lines": [{"creditor":a,"debtor":b,"limit":v,"forwarding_fee_to_debtor_ppm":f}
                         for a,b,v,f in LINES], "verified_quotes": checks, "snapshots": snapshots}
    (state_dir / "demo.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"accounts":list(PEOPLE),"quotes":checks,"state_dir":str(state_dir)}, indent=2))


if __name__ == "__main__":
    main()
