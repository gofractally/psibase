#!/usr/bin/env python3
"""The test VmAdmissionCorpus: no module of psizam's structured corpus is
admitted by the chain and refused by this build's engine.

    run_vm_admission_corpus.py --tool VmAdmissionFuzz --psizam external/psizam --dir DIR

psizam's generator (wasmtime/tests/gen_admission_corpus.py) writes about 8,200
small modules, each valid except for one twist named in its file name
(NNNNN__family__twist.wasm). psizam's runner (run_admission_corpus.py) gives
them in batches to VmAdmissionFuzz, which puts each through the chain's own
admission under the default limits (admitNativeModule) and, if admitted,
through wasmtime's compiler as the node configures it.

Fails, naming the files, if
  - a module is admitted and wasmtime refuses it (a split between nodes),
  - a module crashed or hung the tool, or has no verdict,
  - a family that has modules every engine accepts has none that was admitted
    and compiled (so the test cannot pass because admission refuses everything
    or the generator wrote nothing).

Nothing is tolerated: psizam's own test accepts three splits (more than 1,000
parameters, more than 50,000 locals) because its parser leaves those limits to
the host, and the chain's limits refuse them. Standard library only.
"""

import argparse
import collections
import os
import re
import subprocess
import sys
import time

# Families in which the chain admits nothing, and why. Every other family of
# the corpus must have at least one module that is admitted and compiles.
#   eh, gc, tag:   every module uses exception handling or GC, which are off.
#   constnumeric,
#   constprefix:   every module has a constant expression of more than one
#                  instruction, or one that is not a constant instruction.
#   constop:       every module imports a global (for global.get to read),
#                  and the chain permits function imports only. So the twist
#                  of these 1,280 is not what refuses them here; psizam's own
#                  test (execution.admission-corpus) is what covers each
#                  opcode in a constant expression, with the same parser
#                  switches.
NOTHING_ADMITTED = {"eh", "gc", "tag", "constnumeric", "constprefix", "constop"}

# The splits psizam's own test accepts; each must be refused here.
PSIZAM_TOLERATES = ["typeform/func-1001-params", "body/locals-50001", "body/locals-1000000"]

LINE = re.compile(r"^(\S+) (\d+)__([a-z0-9-]+)__([a-z0-9-]+)\.wasm: ?(.*)$")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tool", required=True, help="VmAdmissionFuzz")
    ap.add_argument("--psizam", required=True, help="psizam's source directory")
    ap.add_argument("--dir", required=True, help="where the corpus and the log are written")
    args = ap.parse_args()

    tests = os.path.join(args.psizam, "wasmtime", "tests")
    log = os.path.join(args.dir, "verdicts.log")
    os.makedirs(args.dir, exist_ok=True)
    if os.path.exists(log):
        os.remove(log)
    started = time.time()
    runner = subprocess.run(
        [sys.executable, os.path.join(tests, "run_admission_corpus.py"),
         "--tool", args.tool, "--generate", os.path.join(tests, "gen_admission_corpus.py"),
         "--dir", args.dir, "--log", log, "--check"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    sys.stdout.write(runner.stdout.decode("utf-8", "replace"))

    failures = []
    if runner.returncode:
        failures.append("psizam's runner exited %d" % runner.returncode)
    verdicts = collections.defaultdict(collections.Counter)
    by_twist = {}
    bad = []
    if os.path.exists(log):
        with open(log) as lines:
            for line in lines:
                m = LINE.match(line.rstrip("\n"))
                if not m:
                    failures.append("unreadable line in %s: %s" % (log, line.rstrip()))
                    continue
                verdict, _, family, twist, message = m.groups()
                verdicts[family][verdict] += 1
                by_twist["%s/%s" % (family, twist)] = verdict
                if verdict not in ("ADMIT", "REFUSE"):
                    bad.append((verdict, line.split(" ", 1)[1].split(":", 1)[0], message))
    else:
        failures.append("psizam's runner wrote no log")

    total = collections.Counter()
    print("\n%-14s %8s %8s %8s %8s" % ("family", "modules", "admitted", "refused", "other"))
    for family in sorted(verdicts):
        count = verdicts[family]
        modules = sum(count.values())
        other = modules - count["ADMIT"] - count["REFUSE"]
        total.update(count)
        print("%-14s %8d %8d %8d %8d" % (family, modules, count["ADMIT"], count["REFUSE"], other))
        if family in NOTHING_ADMITTED:
            if count["ADMIT"]:
                failures.append("family %s: %d modules admitted and compiled, none expected (update "
                                "NOTHING_ADMITTED if that is now right)" % (family, count["ADMIT"]))
        elif not count["ADMIT"]:
            failures.append("family %s: no module was admitted and compiled" % family)
    modules = sum(total.values())
    print("%-14s %8d %8d %8d %8d" % ("total", modules, total["ADMIT"], total["REFUSE"],
                                      modules - total["ADMIT"] - total["REFUSE"]))
    if not modules:
        failures.append("the corpus is empty")
    for family in NOTHING_ADMITTED:
        if family not in verdicts:
            failures.append("family %s is not in the corpus" % family)
    for twist in PSIZAM_TOLERATES:
        if by_twist.get(twist) != "REFUSE":
            failures.append("%s (a split psizam's own test accepts) is %s here, not refused by admission"
                            % (twist, by_twist.get(twist, "not in the corpus")))

    for verdict, name, message in bad:
        if verdict == "SPLIT":
            failures.append("admitted by the chain, refused by wasmtime: %s: %s" % (name, message))
        else:
            failures.append("%s %s: %s" % (verdict, name, message))

    print("\n%d modules, %d admitted and compiled, %d refused by admission, %d admitted but refused by "
          "wasmtime, %.1f s" % (modules, total["ADMIT"], total["REFUSE"], total["SPLIT"],
                                time.time() - started))
    for failure in failures:
        print("FAILED: " + failure)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
