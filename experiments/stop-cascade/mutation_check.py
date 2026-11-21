#!/usr/bin/env python3
"""Targeted mutation checks of the independent MODEL, not native WASM coverage.

Each syntactically valid mutant runs the unmodified reference test suite in an
isolated temporary directory. The repository source and live chain are untouched.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
SOURCE = (ROOT / "reference_model.py").read_text()
TESTS = (ROOT / "test_reference_model.py").read_text()
MUTATIONS = [
    ("relay_rounding_floor_instead_of_ceil",
     "remaining = (k + end - 1) // end", "remaining = k // end"),
    ("claim_uses_shrinking_instead_of_original_denominator",
     "contribution * output // total", "contribution * output // max(1, total - contribution)"),
    ("claim_refunds_full_principal_after_partial_sale",
     "stop_total, stop_used, stop_output, stop_total - stop_used,",
     "stop_total, stop_used, stop_output, stop_total,"),
    ("no_invalidated_seed_fallback",
     "replay.seed_used < original.seed_used or not set(replay.loan_ids)",
     "False or not set(replay.loan_ids)"),
    ("ignore_seed_minimum_output",
     "if seed_output < seed_min_output:", "if False:"),
    ("process_uses_own_future_input_to_trigger",
     "s.trigger_reserve <= u:", "s.trigger_reserve <= u + s.amount:"),
    ("ignore_current_due_margin_after_last_seed_step",
     "if due is not None:", "if False:"),
    ("routing_budget_off_by_one_extra_leg",
     "if routing_steps == route_budget:", "if routing_steps > route_budget:"),
]


def main():
    observed = []
    for name, old, new in MUTATIONS:
        assert old in SOURCE, f"mutation anchor missing: {name}"
        mutant = SOURCE.replace(old, new)
        compile(mutant, f"{name}.py", "exec")
        with tempfile.TemporaryDirectory(prefix="exchange-model-mutation-") as directory:
            folder = Path(directory)
            (folder / "reference_model.py").write_text(mutant)
            (folder / "test_reference_model.py").write_text(TESTS)
            try:
                result = subprocess.run([sys.executable, "-m", "unittest", "test_reference_model"],
                                        cwd=folder, text=True, capture_output=True, timeout=15)
                # Require actual test failures, rather than import/syntax errors.
                killed = result.returncode != 0 and "FAILED (" in result.stderr
                observed.append({"name": name, "killed": killed})
            except subprocess.TimeoutExpired:
                observed.append({"name": name, "killed": True, "timeout_seconds": 15})
    print(json.dumps({"scope": "independent Python model only; not native financial coverage",
                      "mutants": observed, "killed": sum(r["killed"] for r in observed),
                      "total": len(observed)}, indent=2))
    return 0 if all(r["killed"] for r in observed) else 1


if __name__ == "__main__":
    raise SystemExit(main())
