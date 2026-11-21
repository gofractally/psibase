#!/usr/bin/env python3
"""Overlay current source WASMs on the released platform-independent packages.

Run before a FRESH chain boot. In particular the token secondary index must
exist from the first shared-balance write; this is not a live-chain migration.
"""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "demo/upstream/psidk-ubuntu-2404/share/psibase/packages"
DEST = ROOT / "demo/artifacts/packages"
DEST.mkdir(parents=True, exist_ok=True)
WASM = ROOT / "packages/user/target/wasm32-wasip1/release"
overrides = {
    "AccountsService": ("accounts", ROOT / "demo/accounts-build/Accounts.wasm",
                        ROOT / "demo/accounts-build/Accounts-schema.json"),
    **{name: (name.lower(), WASM / f"{name.lower()}.wasm",
              WASM / f"{name.lower()}.schema.json") for name in ("Tokens", "Nft", "Symbol")},
}
for package, account, stem in (("DiffAdjust", "diff-adj", "diff-adjust"),
                                ("NameMarket", "namemarket", "name-market"),
                                ("TokenSwap", "token-swap", "token-swap")):
    overrides[package] = (account, WASM / f"{stem}.wasm", WASM / f"{stem}.schema.json")
SYSTEM = ROOT / "packages/system/target/wasm32-wasip1/release"
overrides["VirtualServer"] = ("vserver", SYSTEM / "virtual-server.wasm", SYSTEM / "virtual-server.schema.json")
overrides["InviteService"] = ("invite", ROOT / "demo/invite-build/Invite.wasm",
                               ROOT / "demo/invite-build/Invite-schema.json")
if (SYSTEM / "credentials.wasm").exists():
    overrides["Credentials"] = ("credential", SYSTEM / "credentials.wasm", SYSTEM / "credentials.schema.json")
index = json.loads((SOURCE / "index.json").read_text())
for entry in index:
    original = SOURCE / entry["file"]
    target = DEST / entry["file"]
    if target.exists() or target.is_symlink():
        target.unlink()
    with zipfile.ZipFile(original) as archive:
        script = json.loads(archive.read("script/postinstall.json")) if "script/postinstall.json" in archive.namelist() else []
    migrate_args = any(a.get("service") == "accounts" and "requireMatch" in (a.get("data") or {}) for a in script)
    if entry["name"] in overrides or migrate_args:
        override = overrides.get(entry["name"])
        service, wasm, schema = override if override else (None, None, None)
        fresh_schema = json.loads(schema.read_text()) if schema else None
        if fresh_schema and "schema" in fresh_schema:
            fresh_schema = fresh_schema["schema"]
        with zipfile.ZipFile(original) as old, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as new:
            for item in old.infolist():
                data = old.read(item.filename)
                if item.filename == f"service/{service}.wasm":
                    data = wasm.read_bytes()
                elif item.filename == f"service/{service}.json":
                    metadata = json.loads(data)
                    metadata["schema"] = fresh_schema
                    data = json.dumps(metadata).encode()
                elif item.filename == "script/postinstall.json" and migrate_args:
                    for a in script:
                        args = a.get("data") or {}
                        if a.get("service") == "accounts" and "requireMatch" in args:
                            args["mode"] = int(args.pop("requireMatch"))
                    data = json.dumps(script).encode()
                if entry["name"] == "InviteService" and item.filename == "service/invite/1.wasm":
                    data = (ROOT / "demo/invite-build/RInvite.wasm").read_bytes()
                elif entry["name"] == "InviteService" and item.filename == "service/invite/1.json":
                    metadata = json.loads(data)
                    metadata["schema"] = json.loads((ROOT / "demo/invite-build/RInvite-schema.json").read_text())
                    data = json.dumps(metadata).encode()
                new.writestr(item, data)
    else:
        target.symlink_to(original)
    entry["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
exchange = WASM / "packages/Exchange.psi"
if exchange.exists():
    output = DEST / "Exchange.psi"
    if output.exists() or output.is_symlink():
        output.unlink()
    # Copy freezes the build selected for this chain, independent of test builds.
    output.write_bytes(exchange.read_bytes())
    with zipfile.ZipFile(output) as archive:
        metadata = json.loads(archive.read("meta.json"))
    metadata.update(file="Exchange.psi", sha256=hashlib.sha256(output.read_bytes()).hexdigest())
    index.append(metadata)
(DEST / "index.json").write_text(json.dumps(index))
(ROOT / "demo/artifacts/source-artifacts.json").write_text(json.dumps({
    name: {"wasm_sha256": hashlib.sha256(wasm.read_bytes()).hexdigest(),
           "schema_sha256": hashlib.sha256(schema.read_bytes()).hexdigest()}
    for name, (_, wasm, schema) in overrides.items()
}, indent=2) + "\n")
print(DEST)
