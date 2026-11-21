#!/usr/bin/env python3
"""Publish the native client stack without replacing financial service WASMs.

Build components using build_native_wallet.py first. Platform UI dist folders
are built by their Yarn workspaces. This is a local operator deployment, not a
public network authority/migration procedure.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from bridge import ROOT, CLI, API, action, push

BUILD = ROOT / "build-native-wallet"
PLATFORM = BUILD / "platform/wasm32-wasip1/release"
USER = BUILD / "user/wasm32-wasip1/release"
COMPAT = BUILD / "compat/wasm32-wasip1/release"
COMPONENTS = {
    **{f"host_{name}": ("host", f"/{name}.wasm") for name in
       ("client", "db", "http", "types", "prompt", "crypto", "auth", "accounts")},
    "login_prompt": ("host", "/login-prompt.wasm"),
    "auth_any": ("auth-any", "/plugin.wasm"),
    "auth_sig": ("auth-sig", "/plugin.wasm"),
    "accounts": ("accounts", "/plugin.wasm"),
    "accounts_query": ("accounts", "/query.wasm"),
    "permissions": ("perms", "/plugin.wasm"),
    "transact": ("transact", "/plugin.wasm"),
    "transact_admin": ("transact", "/admin.wasm"),
    **{name: (name, "/plugin.wasm") for name in ("clientdata", "aes", "kdf", "base64")},
    "web_crypto": ("webcrypto", "/plugin.wasm"),
    "invite": ("invite", "/plugin.wasm"),
}
PUBLISHED = []


def link_dependencies():
    # File upload does not run the package manager's dyn-ld linking step. Keep
    # existing package groups, adding current native component namespaces only.
    aliases = {name: name for name in ("host", "accounts", "auth-any", "auth-sig",
                                       "transact", "clientdata", "aes", "kdf", "base64",
                                       "webcrypto", "tokens", "exchange", "invite")}
    aliases.update({"permissions": "perms", "web-crypto": "webcrypto",
                    "name-market": "namemarket", "credentials": "credential",
                    "virtual-server": "vserver"})
    deps = [{"name": name, "service": service} for name, service in sorted(aliases.items())]
    accounts = {account for account, _ in COMPONENTS.values()} | {"tokens", "exchange", "namemarket", "credential", "vserver"}
    push([action(account, "dyn-ld", "link", {"group": "NativeWallet", "deps": deps})
          for account in sorted(accounts)])


def upload(account, source, destination, recursive=False):
    source = Path(source)
    if not source.exists():
        raise RuntimeError(f"Missing built native client asset: {source}")
    command = [CLI, "upload", "-a", API, "-S", account]
    if recursive:
        command.append("-r")
    command.extend([str(source), destination])
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:] or result.stdout[-4000:])
    files = sorted(source.rglob("*")) if recursive else [source]
    for path in files:
        if path.is_file():
            relative = str(path.relative_to(source)) if recursive else ""
            PUBLISHED.append({"account": account, "path": destination.rstrip("/") +
                              ("/" + relative if relative else ""),
                              "source": str(path.relative_to(ROOT)),
                              "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    print(f"Published {account}: {destination}", flush=True)


def publish_token_prompt():
    subprocess.run(["node", "build.mjs"], cwd=ROOT / "packages/user/Tokens/ui", check=True)
    dist = ROOT / "packages/user/Tokens/ui/dist"
    upload("tokens", dist, "/", True)
    upload("tokens", dist / "plugin/web/prompt/transfer/index.html", "/plugin/web/prompt/transfer")
    # Sites upload replaces per-file policy. Apply this after both uploads.
    supervisor = "http://supervisor.psibase.localhost:8089"
    policy = ("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';"
              "img-src 'self' data:;font-src 'self';connect-src 'self';"
              f"frame-src {supervisor};frame-ancestors 'self' {supervisor};"
              "base-uri 'none';form-action 'self';object-src 'none';")
    push([action("tokens", "sites", "setCsp", {"path": path, "csp": policy})
          for path in ("/plugin/web/prompt/transfer", "/plugin/web/prompt/transfer/index.html")])


def main():
    for stem, (account, destination) in COMPONENTS.items():
        upload(account, PLATFORM / f"{stem}.wasm", destination)
    for stem, account in (("tokens_plugin", "tokens"), ("exchange_plugin", "exchange")):
        upload(account, USER / f"{stem}.wasm", "/plugin.wasm")
    for stem, account in (("credentials_plugin", "credential"), ("name_market_plugin", "namemarket"),
                          ("virtual_server_plugin", "vserver")):
        upload(account, COMPAT / f"{stem}.wasm", "/plugin.wasm")
    link_dependencies()
    common = ROOT / "packages/user/CommonApi/common/packages/common-lib/dist/common-lib.js"
    upload("common-api", common, "/common/common-lib.js")
    upload("common-api", BUILD / "parser/wasm32-wasip1/release/component_parser.wasm",
           "/common/component_parser.wasm")
    for account, relative in (("supervisor", "Supervisor"),
                              ("host", "Host/LoginPrompt"), ("perms", "Permissions")):
        dist = ROOT / f"packages/user/{relative}/ui/dist"
        upload(account, dist, "/", True)
        if account == "host":
            for path in ("/import", "/plugin/web/prompt/connect", "/plugin/web/prompt/import",
                         "/plugin/web/prompt/create"):
                upload(account, dist / "index.html", path)
    publish_token_prompt()
    sibling = "http://psibase.localhost:8089 http://*.psibase.localhost:8089"
    supervisor_policy = (
        "default-src 'self';script-src 'self' 'wasm-unsafe-eval' blob:;"
        "style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';"
        f"connect-src 'self' blob: {sibling};frame-src {sibling};"
        f"frame-ancestors {sibling};base-uri 'none';form-action 'self';object-src 'none';")
    app_policy = ("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';"
                  "img-src 'self' data:;font-src 'self';connect-src 'self';"
                  "frame-src http://supervisor.psibase.localhost:8089;"
                  "frame-ancestors 'self' http://supervisor.psibase.localhost:8089;base-uri 'none';"
                  "form-action 'self';object-src 'none';")
    push([action(account, "sites", "setCsp", {"path": "*", "csp": policy})
          for account, policy in (("supervisor", supervisor_policy), ("host", app_policy),
                                  ("perms", app_policy))])
    push([action("supervisor", "sites", "setCsp", {
        "path": "/prompt.html", "csp": supervisor_policy.replace(
            f"frame-ancestors {sibling};", "frame-ancestors 'none';")})])
    subprocess.run(["python3", "demo/publish_ui.py"], cwd=ROOT, check=True)
    (ROOT / "demo/native-wallet-deployment.json").write_text(json.dumps({
        "financial_services_replaced": False,
        "build_source": json.loads((BUILD / "source.json").read_text()),
        "assets": PUBLISHED,
    }, indent=2) + "\n")
    print("Native wallet published; financial service state and code preserved.")


if __name__ == "__main__":
    main()
