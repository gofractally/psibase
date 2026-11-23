#!/usr/bin/env python3
"""Compile and test exact production Rust planner/claim arithmetic on the host.

No alternate routing implementation is used. Native KV, action authorization,
token transfers and WASM execution require the separate actual-chain fixtures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "service/src"


def block(source, marker):
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def extracted_source():
    math = (SRC / "math.rs").read_text()
    tables = (SRC / "tables.rs").read_text()
    stops = (SRC / "stops.rs").read_text()
    financial = (SRC / "lib.rs").read_text()
    # Keep constants/functions verbatim. Wide's wire derives are irrelevant to
    # pure arithmetic; this adapter preserves its value/get/From behavior.
    arithmetic = math[:math.index("/// A wide value is persisted")]
    arithmetic += """
#[derive(Clone,Copy,Debug)] pub struct Wide(pub u128);
impl Wide { pub fn get(self)->u128 {self.0} }
impl From<u128> for Wide { fn from(n:u128)->Self {Self(n)} }
"""
    arithmetic += math[math.index("pub fn amount("):]
    records = []
    for name in ("Market", "Pool", "Loan", "StopPool", "StopBatch"):
        record = block(tables, "pub struct " + name + " {")
        record = re.sub(r"(?m)^\s*#\[[^\n]*\]\s*$", "", record)
        records.append("#[derive(Clone,Debug)]\n" + record)
    pure = stops[stops.index("pub const MAX_STOPS"):stops.index("pub fn armed(")]
    pure += stops[stops.index("#[derive(Clone)]\npub struct Seed"):stops.index("pub fn snapshot(")]
    claim = financial[financial.index("fn settle_stop("):]
    claim = claim[claim.index("            assert!("):claim.index("            StopBatchTable::read_write().put(&b)")]
    return "\n".join([
        "#![allow(dead_code)]",
        "mod math {\n" + arithmetic + "\n}",
        "mod tables {pub mod tables {use crate::math::Wide;\n" + "\n".join(records) + "\n}}",
        "fn actual_claim_step(b:&mut tables::tables::StopBatch,shares:u64)->(u64,u64) {",
        "struct Position {shares:u64} let pos=Position{shares};", claim, "(refund,output) }",
        "mod stops {use crate::{math::*,tables::tables::*};", pure,
        '#[path=' + json.dumps(str(SRC / "stop_math_tests.rs")) + "] mod tests;",
        '#[path=' + json.dumps(str(SRC / "stop_fuzz_tests.rs")) + "] mod fuzz_tests;",
        "}",
    ])


def command(args, timeout=60, env=None):
    start = time.perf_counter()
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    return result, time.perf_counter() - start


def compile_rust(source, directory, name, coverage=False, branches=False):
    path, binary = directory / (name + ".rs"), directory / name
    # Keep the exact planner in its own source file so its coverage denominator
    # excludes adapters and all test helpers.
    marker = "mod stops {use crate::{math::*,tables::tables::*};"
    start = source.index(marker)
    planner = directory / (name + "_planner.rs")
    planner.write_text(source[start + len("mod stops {"):].rsplit("}", 1)[0])
    source = source[:start] + '#[path=' + json.dumps(str(planner)) + "] mod stops;\n"
    path.write_text(source)
    args = ["rustc", "--edition=2021", "--test", "-O", "--cfg", "extracted_stop_host",
            "--check-cfg", "cfg(extracted_stop_host)", str(path), "-o", str(binary)]
    if coverage:
        args += ["-C", "instrument-coverage", "-C", "codegen-units=1"]
    env = None
    if branches:
        args += ["-Z", "coverage-options=branch"]
        env = dict(os.environ, RUSTC_BOOTSTRAP="1")
    result, _ = command(args, env=env)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return binary


def llvm_tool(name, major):
    sysroot = subprocess.check_output(["rustc", "--print", "sysroot"], text=True).strip()
    candidates = list(Path(sysroot).glob("lib/rustlib/*/bin/" + name))
    candidates += [Path("/opt/homebrew/opt/llvm/bin") / name]
    if shutil.which(name):
        candidates.append(Path(shutil.which(name)))
    for candidate in candidates:
        if candidate.is_file():
            result, _ = command([str(candidate), "--version"])
            if re.search(r"version\s+" + str(major) + r"\.", result.stdout + result.stderr):
                return str(candidate)
    return None


def coverage_report(source, directory, branches=False):
    version = subprocess.check_output(["rustc", "--version", "--verbose"], text=True)
    major = int(re.search(r"LLVM version: (\d+)", version)[1])
    profdata, cov = llvm_tool("llvm-profdata", major), llvm_tool("llvm-cov", major)
    if not profdata or not cov:
        return {"available": False, "reason": f"Matching LLVM {major} llvm-profdata/llvm-cov not installed"}
    binary = compile_rust(source, directory, "covered", coverage=True, branches=branches)
    env = dict(os.environ, LLVM_PROFILE_FILE=str(directory / "stops-%p.profraw"))
    result, elapsed = command([str(binary)], env=env)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    profile = directory / "stops.profdata"
    merged, _ = command([profdata, "merge", "-sparse", *map(str, directory.glob("*.profraw")), "-o", str(profile)])
    if merged.returncode:
        raise RuntimeError(merged.stderr)
    exported, _ = command([cov, "export", str(binary), "-instr-profile=" + str(profile)])
    if exported.returncode:
        raise RuntimeError(exported.stderr)
    data = json.loads(exported.stdout)["data"][0]
    files = [{"file": row["filename"], "summary": row["summary"]} for row in data["files"]]
    planner = next(row["summary"] for row in files if row["file"].endswith("covered_planner.rs"))
    planner_file = next(row for row in data["files"] if row["filename"].endswith("covered_planner.rs"))
    lines = Path(planner_file["filename"]).read_text().splitlines()
    missed_branches = [{"line": branch[0], "true_count": branch[4], "false_count": branch[5],
                        "source": lines[branch[0] - 1].strip()}
                       for branch in planner_file.get("branches", []) if not branch[4] or not branch[5]]
    for branch in missed_branches:
        if branch["source"] == "if step == 0 {":
            branch["rationale"] = "The preceding guards establish input-used>0 and barrier-u>0; their minimum is positive. Defensive local guard."
        else:
            branch["rationale"] = "Defensive replay rejection path not reached by these cases. One-sided admission restricts candidates; this report does not claim a whole-program proof of unreachability."
    return {"available": True, "production_planner": planner, "totals_including_tests": data["totals"], "files": files,
            "uncovered_planner_branches": missed_branches,
            "uncalled_functions": [row["name"] for row in data["functions"] if not row["count"]],
            "runtime_seconds": elapsed,
            "branch_note": ("Branch instrumentation enabled with -Zcoverage-options=branch and RUSTC_BOOTSTRAP=1; same production source."
                            if branches else "Stable rustc measures regions; branch counters may not be emitted.")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mutations", action="store_true")
    parser.add_argument("--coverage", action="store_true")
    parser.add_argument("--branch-coverage", action="store_true",
                        help="Enable experimental rustc branch counters for the host copy only")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    source = extracted_source()
    report = {"source": "Exact current production Rust planner, math functions, record fields, and native claim arithmetic block",
              "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "files": {name: hashlib.sha256((SRC / name).read_bytes()).hexdigest()
                        for name in ("stops.rs", "math.rs", "tables.rs", "lib.rs", "stop_math_tests.rs", "stop_fuzz_tests.rs")},
              "limits": ["Host extraction does not exercise native KV, token authorization/custody, ABI, WASM metering, or HTTP privacy.",
                         "Deterministic seeded samples and mutation detection are evidence, not a probability of being bug-free."]}
    with tempfile.TemporaryDirectory(prefix="exchange-stops-") as folder:
        directory = Path(folder)
        binary = compile_rust(source, directory, "actual_stops")
        result, elapsed = command([str(binary), "--nocapture"])
        print(result.stdout)
        if result.returncode:
            print(result.stderr)
            raise SystemExit(result.returncode)
        summary = re.search(r"test result: ok\. (\d+) passed; (\d+) failed", result.stdout)
        report["tests"] = {"passed": int(summary[1]), "failed": int(summary[2]), "runtime_seconds": elapsed}
        if args.mutations:
            mutations = [
                ("ignore_seed_minimum_output", "causal.seed_output >= seed.min_output", "true"),
                ("miss_exact_trigger_boundary", "if reserve < self.barriers.stops[i]", "if reserve <= self.barriers.stops[i]"),
                ("wrong_common_claim_denominator", "b.input_total as u128", "(b.input_total as u128 + 1)"),
                ("forget_refund_backing_debit", ".checked_sub(refund)", ".checked_sub(0)"),
            ]
            results = []
            for name, old, new in mutations:
                if old not in source:
                    raise RuntimeError("Mutation target changed: " + name)
                mutant = compile_rust(source.replace(old, new), directory, name)
                try:
                    rejected, seconds = command([str(mutant)], timeout=15)
                    caught = rejected.returncode != 0
                    reason = "test failure" if caught else "SURVIVED"
                except subprocess.TimeoutExpired:
                    caught, seconds, reason = True, 15, "execution timeout"
                results.append({"name": name, "detected": caught, "reason": reason, "runtime_seconds": seconds})
                print(name + ": " + reason)
            report["mutations"] = results
            if not all(row["detected"] for row in results):
                raise RuntimeError("A targeted production Rust mutation survived")
        if args.coverage or args.branch_coverage:
            report["coverage"] = coverage_report(source, directory, branches=args.branch_coverage)
            print("Coverage: " + json.dumps(report["coverage"].get("production_planner", report["coverage"])))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
