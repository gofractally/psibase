#!/usr/bin/env python3
"""Test/package Exchange against a frozen framework, without engine overlays.

First prepare build-exchange-pagination/source with the previously verified
framework snapshot and bin/{psitest,cargo-psibase}. This intentionally refuses
to recreate that baseline from a working tree undergoing engine migration.
Only packages/user/Exchange is copied on subsequent invocations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[4]
BUILD = ROOT / "build-exchange-pagination"
SOURCE = BUILD / "source"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "test", "package"))
    parser.add_argument("args", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    if not (SOURCE / "rust/psibase/Cargo.toml").is_file():
        raise SystemExit("Missing frozen framework baseline: build-exchange-pagination/source")
    exchange = Path("packages/user/Exchange")
    shutil.copytree(ROOT / exchange, SOURCE / exchange, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("node_modules", "__pycache__", "target"))
    inputs = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted((ROOT / exchange).rglob("*")) if p.is_file()
              and not any(part in ("node_modules", "dist", "target", "__pycache__")
                          for part in p.parts)}
    (BUILD / "exchange-inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    if options.operation == "prepare":
        print(SOURCE)
        return
    command = [str(BUILD / "bin/cargo-psibase"), "psibase",
               f"--psitest={BUILD / 'bin/psitest'}", "-p",
               "exchange" if options.operation == "test" else "exchange-pkg",
               options.operation, "--manifest-path", str(SOURCE / "packages/user/Cargo.toml"),
               *options.args]
    environment = {**os.environ,
                   "CARGO_TARGET_DIR": str(ROOT / "build-exchange-verification/target")}
    raise SystemExit(subprocess.call(command, cwd=SOURCE, env=environment))


if __name__ == "__main__":
    main()
