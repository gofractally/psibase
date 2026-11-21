#!/usr/bin/env python3
"""Summarize per-transaction native fixture samples, never full-suite runtime."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def distribution(values):
    values = sorted(values)
    return {"samples":len(values), "median_ms":statistics.median(values),
            "p95_ms":values[max(0,math.ceil(.95*len(values))-1)],
            "min_ms":values[0],"max_ms":values[-1]}


def summarize(paths):
    paths = [paths] if isinstance(paths,Path) else paths
    groups, work = {}, {}
    for line in "\n".join(path.read_text() for path in paths).splitlines():
        if line.startswith("EXCHANGE_METRIC "):
            record=json.loads(line.split(" ",1)[1])
            axes={k:v for k,v in record["metadata"].items() if k not in
                  ("repeat","seed","permutation","order_slot")}
            key=json.dumps([record["scenario"],axes],sort_keys=True)
            groups.setdefault(key,[]).append(record)
        elif line.startswith("EXCHANGE_WORK "):
            record=json.loads(line.split(" ",1)[1])
            key=(record["scenario"],record.get("owners"))
            work.setdefault(key,[]).append(record["work_steps"])
    output=[]
    for key,records in groups.items():
        scenario,axes=json.loads(key)
        row={"scenario":scenario,"axes":axes,
             "sampling":"identical_native_fixture_repeats" if all("repeat" in r["metadata"] for r in records) else "single_native_actions",
             "native_billable_time":distribution([int(r["native_billable_ns"])/1e6 for r in records]),
             "tester_wall_time":distribution([int(r["wall_ns"])/1e6 for r in records]),
             "rejections":sum(r["rejected"] for r in records),
             "inner_action_counts":sorted({r["inner_action_count"] for r in records})}
        row["raw_samples"]=[{k:v for k,v in r.items() if k in
            ("metadata","wall_ns","process_cpu_ns","thread_cpu_ns","native_billable_ns","rejected")}
            for r in records]
        for field,label in (("process_cpu_ns","process_cpu_time"),("thread_cpu_ns","thread_cpu_time")):
            if all(field in r for r in records):
                row[label]=distribution([int(r[field])/1e6 for r in records])
        steps=work.get((scenario,axes.get("owners")),[])
        if steps:
            row["deterministic_work_steps"]=sorted(set(steps))
            assert len(set(steps))==1,"Repeated identical fixture had different work counts"
        output.append(row)
    if not output:
        raise ValueError("No native transaction metrics in this log")
    return {"source_logs":[{"path":str(path.relative_to(ROOT)),
                            "sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths],
            "platform":platform.platform(),
            "cpu":subprocess.check_output(["sysctl","-n","machdep.cpu.brand_string"],text=True).strip()
                  if platform.system()=="Darwin" else platform.processor(),
            "clock_scope":"Direct process/thread CPU clocks bracket only each native push in psitest; process CPU includes host worker threads, thread CPU is the calling host thread. Native billable watchdog is monotonic elapsed on macOS and thread CPU on Linux and pauses for some runtime work. Tester wall includes the complete push. Durations are not deterministic.",
            "fixture_scope":"Repeated benchmark samples fork identical funded native state and block time. Regression measurements are single native actions, not repeated latency samples. Setup, boot, fixture cloning, and post-action full audit are excluded from each timed push.",
            "confidence_scope":"Observed timing distributions for explicit fixtures on this machine, not a production latency guarantee or probability of financial correctness.",
            "scenarios":output}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log",type=Path,nargs="+")
    parser.add_argument("--output",type=Path,default=ROOT/"demo/stop-native-benchmarks.json")
    args=parser.parse_args()
    logs=[p.resolve() for p in args.log]
    result=summarize(logs)
    args.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
