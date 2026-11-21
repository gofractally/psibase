#!/usr/bin/env python3
"""Build/test Exchange without changing another task's unfinished workspace.

The clean workspace manifest/lock are taken from HEAD. Current Exchange source
and the native fixture-fork helper are overlaid into an isolated build snapshot.
No source, manifest or lock file belonging to concurrent BTC bridge work is
modified. Build provenance records all financial source hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / "build-exchange-verification"
SOURCE = VERIFY / "source"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare():
    VERIFY.mkdir(exist_ok=True)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    marker = VERIFY / "snapshot-head"
    if not marker.exists() or marker.read_text().strip() != head:
        if SOURCE.exists():
            shutil.rmtree(SOURCE)
        SOURCE.mkdir()
        with tempfile.TemporaryFile() as archive:
            subprocess.run(["git", "archive", "--format=tar", head], cwd=ROOT, stdout=archive, check=True)
            archive.seek(0)
            with tarfile.open(fileobj=archive) as tar:
                tar.extractall(SOURCE, filter="data")
        marker.write_text(head + "\n")
    exchange = Path("packages/user/Exchange")
    shutil.copytree(ROOT / exchange, SOURCE / exchange, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
    # The package includes the native wallet component. Its WIT must match the
    # current client interfaces even though these fixtures exercise services.
    for relative in ("packages/user/Tokens/plugin", "packages/user/Tokens/query-service", "packages/system/Transact/plugin",
                     "packages/user/Permissions/plugin"):
        shutil.copytree(ROOT / relative, SOURCE / relative, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("target", "node_modules", "__pycache__"))
    manifest = SOURCE / "packages/user/Cargo.toml"
    contents = manifest.read_text()
    if '"Exchange/plugin"' not in contents:
        manifest.write_text(contents.replace("members = [", 'members = [\n    "Exchange/plugin",', 1))
    helper = Path("rust/psibase/src/tester.rs")
    shutil.copy2(ROOT / helper, SOURCE / helper)
    runner_source = Path("programs/psitest/main.cpp")
    shutil.copy2(ROOT / runner_source, SOURCE / runner_source)
    packager_source = Path("rust/cargo-psibase/src/main.rs")
    shutil.copy2(ROOT / packager_source, SOURCE / packager_source)
    tracked = [*sorted((ROOT / exchange / "service").rglob("*.rs")),
               *sorted((ROOT / exchange / "query-service").rglob("*.rs")),
               ROOT / "packages/user/Tokens/query-service/src/lib.rs",
               ROOT / "packages/system/HttpServer/src/HttpServer.cpp",
               ROOT / "packages/user/Sites/src/Sites.cpp",
               ROOT / helper, ROOT / runner_source, ROOT / packager_source]
    runner = ROOT / "build/psitest"
    packager = ROOT / "rust/target/release/cargo-psibase"
    provenance = {"base_commit": head, "workspace_manifest": "committed HEAD (concurrent work excluded)",
                  "source_sha256": {str(p.relative_to(ROOT)): sha256(p) for p in tracked},
                  "test_runner": {"executable": str(runner),
                                  "sha256": sha256(runner) if runner.is_file() else None,
                                  "source": str(runner_source),
                                  "cpu_clock_ids_required": [2, 3],
                                  "note": "Source and executable hashes are recorded separately; rebuild psitest before CPU measurements. Metrics fail if either CPU clock is unavailable."},
                  "packager": {"executable": str(packager),
                               "sha256": sha256(packager) if packager.is_file() else None,
                               "source": str(packager_source)}}
    (VERIFY / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return SOURCE / "packages/user/Cargo.toml"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "test", "package"))
    parser.add_argument("args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    manifest = prepare()
    if args.operation == "prepare":
        print(manifest)
        return
    command = [str(ROOT / "rust/target/release/cargo-psibase"), "psibase",
               f"--psitest={ROOT / 'build/psitest'}", "-p",
               "exchange" if args.operation == "test" else "exchange-pkg",
               args.operation, "--manifest-path", str(manifest)]
    if args.args:
        command += args.args
    environment = {**os.environ, "CARGO_TARGET_DIR": str(VERIFY / "target")}
    raise SystemExit(subprocess.call(command, cwd=SOURCE, env=environment))


if __name__ == "__main__":
    main()
