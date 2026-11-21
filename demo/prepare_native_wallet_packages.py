#!/usr/bin/env python3
"""Refresh local fixture packages with the tested native request handlers.

Only the local demo archives and their index are replaced. Token financial code,
balances, service flags and package scripts are preserved. Released SDK archives
are never modified, including when a local archive is initially a symlink.
"""
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "demo/artifacts/packages"
OVERRIDES = {
    "HttpServer": ("http", ROOT / "demo/http-server-build/HttpServer.wasm",
                   ROOT / "demo/http-server-build/HttpServer-schema.json"),
    "CommonApi": ("common-api", ROOT / "demo/common-api-build/CommonApi.wasm",
                  ROOT / "demo/common-api-build/CommonApi-schema.json"),
    "Tokens": ("tokens/1", ROOT / "build-native-wallet/query-target/wasm32-wasip1/release/r-tokens.wasm",
               ROOT / "build-native-wallet/query-target/wasm32-wasip1/release/r-tokens.schema.json"),
}


def main():
    index = json.loads((DEST / "index.json").read_text())
    records = []
    for entry in index:
        if entry["name"] not in OVERRIDES:
            continue
        account, wasm, schema = OVERRIDES[entry["name"]]
        code = wasm.read_bytes()
        fresh_schema = json.loads(schema.read_text())
        fresh_schema = fresh_schema.get("schema", fresh_schema)
        path = DEST / entry["file"]
        with tempfile.TemporaryDirectory(dir=DEST) as directory:
            output = Path(directory) / "package.psi"
            with zipfile.ZipFile(path) as old, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as new:
                for item in old.infolist():
                    data = old.read(item.filename)
                    if item.filename == f"service/{account}.wasm":
                        data = code
                    elif item.filename == f"service/{account}.json":
                        metadata = json.loads(data)
                        metadata["schema"] = fresh_schema
                        data = json.dumps(metadata).encode()
                    new.writestr(item, data)
            output.replace(path)
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        records.append({"package": entry["name"], "reader": account,
                        "wasm_sha256": hashlib.sha256(code).hexdigest(),
                        "package_sha256": entry["sha256"]})
    (DEST / "index.json").write_text(json.dumps(index) + "\n")
    (ROOT / "demo/native-wallet-fixture-packages.json").write_text(json.dumps(records, indent=2) + "\n")
    print("Updated local request-handler fixtures; token financial WASM preserved")


if __name__ == "__main__":
    main()
