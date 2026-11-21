#!/usr/bin/env python3
"""Summarize per-request native HTTP CPU samples, excluding fixture setup."""
import argparse
import json
from pathlib import Path
import statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    samples, fixtures = {}, []
    for line in args.log.read_text().splitlines():
        if "EXCHANGE_PAGE_METRIC " in line:
            value = json.loads(line.split("EXCHANGE_PAGE_METRIC ", 1)[1])
            samples.setdefault(value["scenario"], []).append(value)
        if "EXCHANGE_PAGE_FIXTURE " in line:
            fixtures.append(json.loads(line.split("EXCHANGE_PAGE_FIXTURE ", 1)[1]))
    if not fixtures or not samples:
        raise SystemExit("No completed native fixtures and request measurements found")
    summary = {}
    for scenario, rows in samples.items():
        times = [int(r["thread_cpu_ns"]) / 1_000_000 for r in rows]
        summary[scenario] = {"requests": len(times), "cpu_ms_median": statistics.median(times),
                             "cpu_ms_min": min(times), "cpu_ms_max": max(times),
                             "response_bytes": sorted({r["response_bytes"] for r in rows})}
    result = {"fixtures": fixtures, "per_request": summary,
              "scope": "Observed native HTTP request CPU on this machine, not a latency guarantee or probability of financial correctness.",
              "samples": samples}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"fixtures": fixtures, "per_request": summary}, indent=2))


if __name__ == "__main__":
    main()
