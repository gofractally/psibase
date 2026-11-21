#!/usr/bin/env python3
"""Run Linux triedent correctness tests with restricted child memory locking."""
import os
import resource
import sys

if sys.platform != "linux":
    raise SystemExit("restricted_memlock.py is a Linux-only test launcher")
if len(sys.argv) < 2:
    raise SystemExit("usage: restricted_memlock.py TEST_BINARY [ARGUMENTS...]")

before_soft, hard = resource.getrlimit(resource.RLIMIT_MEMLOCK)
soft = 64 * 1024
for inherited in (before_soft, hard):
    if inherited != resource.RLIM_INFINITY:
        soft = min(soft, inherited)
resource.setrlimit(resource.RLIMIT_MEMLOCK, (soft, hard))
print(f"triedent test memory-lock soft limit: {before_soft} -> {soft} bytes; "
      f"hard limit unchanged: {hard}", file=sys.stderr, flush=True)
os.execv(sys.argv[1], sys.argv[1:])
