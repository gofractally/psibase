#!/usr/bin/env python3
"""Start/stop the persistent, loopback-only native exchange demonstration."""
from pathlib import Path
import argparse
import os
import signal
import socket
import shlex
import subprocess
import sys
import time
import urllib.request
import urllib.error
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def state_dir():
    """Keep independently bootstrapped demos' databases, logs and PIDs apart."""
    return Path(os.environ.get("EXCHANGE_DEMO_STATE_DIR", str(ROOT / "demo"))).expanduser().resolve()


def check_port_available(port):
    with socket.socket() as probe:
        # A listener is a conflict; connections left in TIME_WAIT after our
        # previous node exited are not. Match the node's reuse-address setting.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", port))


def command_for_pid(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "stat=", "-o", "command="],
                            text=True, capture_output=True).stdout.strip().split(None, 1)
    # A just-exited child may briefly remain as a zombie, with its command
    # replaced by '(psinode)' or '<defunct>'. It no longer owns a listener or
    # database lock; retain the strict identity check for live reused PIDs.
    if len(result) < 2 or result[0].startswith("Z"):
        return ""
    return result[1]


def active(name, expected):
    file = state_dir() / f"{name}.pid"
    if not file.exists():
        return None
    pid = int(file.read_text())
    command = command_for_pid(pid)
    if not command:
        return None
    arguments = shlex.split(command)
    same_program = any(Path(arg).is_absolute() and Path(arg).resolve() == Path(expected).resolve()
                       for arg in arguments[:2])
    if str(expected) not in command and not same_program:
        raise RuntimeError(f"Refusing stale {name} PID {pid}: it belongs to another process")
    return pid


def start(name, command, expected):
    pid = active(name, expected)
    if pid:
        print(f"{name} already running (PID {pid})")
        return
    state_dir().mkdir(parents=True, exist_ok=True)
    with (state_dir() / f"{name}.log").open("a") as log:
        process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    (state_dir() / f"{name}.pid").write_text(str(process.pid))
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
    programs = {"node": Path(os.environ.get("EXCHANGE_NODE", str(ROOT / "build/psinode"))).expanduser().resolve(),
                "bridge": ROOT / "demo/bridge.py"}
    api = os.environ.get("EXCHANGE_CHAIN", "http://psibase.localhost:8089/")
    endpoint = urlsplit(api)
    if args.operation == "start":
        if not (state_dir() / "chain/config").exists():
            raise RuntimeError("Initialize the fresh chain first; see docs/exchange/RUNNING.md")
        if not active("node", programs["node"]):
            # An unrelated HTTP listener must not look like a successful node
            # startup while our child fails to bind its configured demo port.
            check_port_available(endpoint.port or 80)
        start("node", [str(programs["node"]), str(state_dir() / "chain")], programs["node"])
        wait_http(f"http://127.0.0.1:{endpoint.port or 80}/")
        print(f"Exchange: {endpoint.scheme}://exchange.{endpoint.netloc}/")
    else:
        programs["market-activity"] = ROOT / "demo/market_activity.py"
        for name in ("market-activity", "bridge", "node"):
            pid = active(name, programs[name])
            print(f"{name}: {'running PID '+str(pid) if pid else 'stopped'}")
            if pid and args.operation == "stop":
                os.kill(pid, signal.SIGTERM)
                deadline = time.monotonic() + 35
                while True:
                    # Identity is checked before the signal. If it changes
                    # afterward, our original process is gone; never signal
                    # or wait for a new owner of the same numeric PID.
                    try:
                        waiting = active(name, programs[name]) == pid
                    except RuntimeError:
                        break
                    if not waiting:
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"{name} did not stop; inspect its log before restarting")
                    time.sleep(.1)


if __name__ == "__main__":
    main()
