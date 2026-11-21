#!/usr/bin/env python3
"""Start/stop the persistent, loopback-only native exchange demonstration."""
from pathlib import Path
import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def command_for_pid(pid):
    return subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                          text=True, capture_output=True).stdout.strip()


def active(name, expected):
    file = ROOT / f"demo/{name}.pid"
    if not file.exists():
        return None
    pid = int(file.read_text())
    command = command_for_pid(pid)
    if not command:
        return None
    if str(expected) not in command:
        raise RuntimeError(f"Refusing stale {name} PID {pid}: it belongs to another process")
    return pid


def start(name, command, expected):
    pid = active(name, expected)
    if pid:
        print(f"{name} already running (PID {pid})")
        return
    with (ROOT / f"demo/{name}.log").open("a") as log:
        process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    (ROOT / f"demo/{name}.pid").write_text(str(process.pid))
    print(f"Started {name} (PID {process.pid})")


def wait_http(url):
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except urllib.error.HTTPError:
            return
        except OSError:
            time.sleep(.2)
    raise RuntimeError(f"Server did not start: {url}; see demo/*.log")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["start", "stop", "status"], default="start", nargs="?")
    args = parser.parse_args()
    programs = {"node": ROOT / "build/psinode", "bridge": ROOT / "demo/bridge.py"}
    if args.operation == "start":
        if not (ROOT / "demo/chain/config").exists():
            raise RuntimeError("Initialize the fresh chain first; see docs/exchange/RUNNING.md")
        start("node", [str(programs["node"]), str(ROOT / "demo/chain")], programs["node"])
        wait_http("http://127.0.0.1:8089/")
        start("bridge", [sys.executable, str(programs["bridge"])], programs["bridge"])
        wait_http("http://127.0.0.1:8090/api/health")
        print("Exchange: http://exchange.psibase.localhost:8089/")
    else:
        programs["market-activity"] = ROOT / "demo/market_activity.py"
        for name in ("market-activity", "bridge", "node"):
            pid = active(name, programs[name])
            print(f"{name}: {'running PID '+str(pid) if pid else 'stopped'}")
            if pid and args.operation == "stop":
                os.kill(pid, signal.SIGTERM)


if __name__ == "__main__":
    main()
