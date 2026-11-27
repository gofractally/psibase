#!/usr/bin/env python3
"""Real, funded local-devnet market activity. Never generates display-only data.

Dedicated AuthAny demo accounts own these orders. Existing user orders are
untouched. Seed is idempotent: it tops up only missing maker inventory. Run
submits small, bounded trades to the native exchange, then replenishes orders.
"""
import argparse
import json
import os
from pathlib import Path
import random
import signal
import subprocess
import sys
import time
import threading
import fcntl
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from bridge import (ROOT, CLI, API, KEYS, NODE_ARGS, sign_flags, action, push, quantity,
                    read_state, settlements, fund_claims)
from run import active, start

MAKERS = ("demomakera", "demomakerb", "demomakerc")
TAKER = "demotaker"
MARKER = ROOT / "demo/market-activity.json"
NAME = "market-activity"
SCRIPT = Path(__file__).resolve()
STATUS = ROOT / "demo/market-activity-status.json"
BASE_TARGET = 5 * 10**8
QUOTE_TARGET = 500_000 * 10**4
MAX_BASE_TRADE = 20_000_000
MIN_BASE_TRADE = 30_000
RESERVE_FRACTION = Decimal('.0015')
PASSIVE_GUARD = Decimal('.002')
MAINTENANCE_EVERY = 4


def write_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


@contextmanager
def activity_lock():
    current = active(NAME, SCRIPT)
    if current and current != os.getpid():
        raise RuntimeError(f"Demo activity already running (PID {current})")
    with (ROOT / 'demo/market-activity.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Demo activity is already running') from error
        pidfile = ROOT / f'demo/{NAME}.pid'
        pidfile.write_text(str(os.getpid()))
        try:
            yield
        finally:
            if pidfile.exists() and pidfile.read_text().strip() == str(os.getpid()):
                pidfile.unlink()


def quote_center(config):
    return int(config.get('quote_center', config['center']))


def recenter_quotes(config, target, elapsed, last_recenter):
    if elapsed - last_recenter < 60 or abs(target - quote_center(config)) <= 250:
        return False
    config['quote_center'] = int((target / 25).to_integral_value(rounding=ROUND_HALF_UP)) * 25
    return True


def send(actions):
    if actions:
        return push(actions)


def setup():
    if MARKER.exists():
        config = json.loads(MARKER.read_text())
        config.setdefault('operating_center', config['center'])
        config.setdefault('quote_center', config['center'])
        return config
    seed = json.loads((ROOT / "demo/seed.json").read_text())
    state = read_state("liquidity")
    market = next(m for m in state["markets"] if int(m["id"]) == seed["market"])
    config = {"market": seed["market"], "base": seed["base"], "quote": seed["quote"],
              "center": round(int(market["y"]) * int(market["base_lot"]) /
                              (int(market["x"]) * int(market["quote_tick"])) / 100) * 100,
              "accounts": []}
    # Persist each completed setup so a rerun never resets or duplicates funds.
    config['operating_center'] = config['quote_center'] = config['center']
    write_json(MARKER, config)
    return config


def fund_accounts(config):
    for owner in (*MAKERS, TAKER):
        if owner in config["accounts"]:
            continue
        # Account creation uses KEEP_EXISTING; -i selects local AuthAny.
        if KEYS:
            # A chain whose accounts sign: the owner gets a key of its own and
            # is created by the account named in EXCHANGE_CREATOR.
            key = Path(KEYS) / f"{owner}.key.pem"
            public = Path(KEYS) / f"{owner}.pub.pem"
            if not key.exists():
                subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                                "ec_paramgen_curve:secp256k1", "-out", str(key)],
                               check=True, capture_output=True)
                key.chmod(0o600)
            subprocess.run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(public)],
                           check=True, capture_output=True)
            creator = os.environ.get("EXCHANGE_CREATOR", "prod")
            result = subprocess.run([CLI, "create", *NODE_ARGS, "-S", creator,
                                     *sign_flags([creator]), "-k", str(public), owner],
                                    capture_output=True, text=True, timeout=60)
            if result.returncode and "already exists" in (result.stderr or ""):
                result = subprocess.CompletedProcess(result.args, 0, "", "")
        else:
            result = subprocess.run([CLI, "create", "-a", API, "-i", "-S", "accounts", owner],
                                    capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr)
        send([action(owner, "tokens", "setUserConf", {"index": 0, "enabled": False})])
        state = read_state(owner)
        rows = {int(r["token"]): r for r in state["balances"]}
        acts = []
        for token, target in ((config["base"], BASE_TARGET), (config["quote"], QUOTE_TARGET)):
            row = rows.get(token, {})
            existing = sum(int(row.get(k, 0)) for k in ("wallet", "incoming", "outgoing"))
            if existing < target:
                q = quantity(target - existing)
                acts.extend([
                    action("liquidity", "tokens", "credit", {"token_id": token, "debitor": owner,
                           "amount": q, "memo": "Fund local demo market activity"}),
                    action(owner, "tokens", "debit", {"token_id": token, "creditor": "liquidity",
                           "amount": q, "memo": "Accept local demo funding"}),
                ])
            wallet = int(row.get("wallet", 0)) + max(0, target - existing)
            if wallet:
                acts.append(action(owner, "tokens", "credit", {"token_id": token,
                            "debitor": "exchange", "amount": quantity(wallet),
                            "memo": "Native funding for local demo orders"}))
        send(acts)
        config["accounts"].append(owner)
        write_json(MARKER, config)


def inventory(config, refresh=False, owners=MAKERS, plan_only=False, max_updates=None, max_cancels=4):
    """Quote dedicated owners only. Off-chain guards are not a post-only API."""
    if any(owner not in MAKERS for owner in owners):
        raise ValueError('Maintenance may only modify dedicated demo makers')
    state = read_state(MAKERS[0])
    m = next(m for m in state["markets"] if int(m["id"]) == config["market"])
    spot = Decimal(int(m["y"]) * int(m["base_lot"])) / Decimal(int(m["x"]) * int(m["quote_tick"]))
    updates, planned = 0, []
    for owner in owners:
        index = MAKERS.index(owner)
        state = read_state(owner)
        rows = {(bool(p["bid"]), int(p["price"])): p for p in state["positions"]
                if int(p["market"]) == config["market"] and p.get('owner', owner) == owner}
        acts, accrued = settlements(owner, state)
        acts = fund_claims(owner, state, acts, accrued)
        budget = {int(r["token"]): int(r["spendable"]) + accrued.get(int(r["token"]), 0)
                  for r in state["balances"]}
        desired_keys = {(bid, quote_center(config) + (-1 if bid else 1) * (25 + level * 25))
                        for bid in (True, False) for level in range(24)
                        if (level + index) % 3 != 0}
        stale = sorted((key for key in rows if key not in desired_keys),
                       key=lambda key: abs(key[1] - quote_center(config)), reverse=True)
        for bid, price in stale[:max_cancels]:
            acts.append(action(owner, 'exchange', 'cancel', {'market': config['market'],
                               'bid': bid, 'price': price}))
        # Cancellation refunds are deliberately NOT added to this quoted budget:
        # another actor may fill a position between snapshot and submission.
        rng = random.Random(100 + index)
        for bid in (True, False):
            for level in range(24):
                size = rng.randrange(120, 650) * 40_000  # 0.0480–0.2596 BTC per maker
                if (level + index) % 3 == 0:
                    continue
                price = quote_center(config) + (-1 if bid else 1) * (25 + level * 25)
                if ((bid and price >= spot * (1 - PASSIVE_GUARD)) or
                        (not bid and price <= spot * (1 + PASSIVE_GUARD))):
                    continue  # Guarded at planning time; another actor can race.
                desired = size // int(m["base_lot"]) * price * int(m["quote_tick"]) if bid else size
                current = int(rows.get((bid, price), {}).get("refund", 0))
                missing = desired - current
                token = config["quote"] if bid else config["base"]
                if (missing <= 0 or (refresh and missing < desired // 2) or
                        missing > budget.get(token, 0) or
                        (max_updates is not None and updates >= max_updates)):
                    continue
                acts.append(action(owner, "exchange", "limit", {"market": config["market"],
                            "bid": bid, "price": price, "amount": missing}))
                budget[token] -= missing
                updates += 1
        if plan_only:
            planned.extend(acts)
        else:
            # Keep transactions short and interleave normally with human activity.
            for offset in range(0, len(acts), 8):
                send(acts[offset:offset + 8])
    return planned if plan_only else updates


class LiveFeed:
    def __init__(self):
        self.lock = threading.Lock()
        self.price, self.received, self.tick_time = None, 0, None
        self.heartbeat_received = 0
        self.closed = False
        self.process = subprocess.Popen(["node", str(ROOT / "demo/btc_feed.mjs")],
                                        stdout=subprocess.PIPE, text=True)
        threading.Thread(target=self.collect, daemon=True).start()

    def collect(self):
        for line in self.process.stdout:
            try:
                tick = json.loads(line)
                self.accept(tick)
            except (ValueError, KeyError, TypeError, InvalidOperation):
                pass

    def accept(self, tick):
        with self.lock:
            if tick.get('type') == 'ticker':
                try:
                    price = Decimal(str(tick['price']))
                except (KeyError, InvalidOperation, TypeError):
                    return
                if not price.is_finite() or price <= 0:
                    return
                self.price, self.tick_time = price, tick.get('time')
                self.received = time.monotonic()
            elif tick.get('type') == 'heartbeat':
                self.heartbeat_received = time.monotonic()

    def current(self):
        with self.lock:
            process = getattr(self, 'process', None)
            if process is not None and process.poll() is not None:
                raise RuntimeError('Live BTC feed worker exited; restart required')
            if self.price is None or time.monotonic() - self.received > 5:
                raise ValueError("Live BTC/USD feed unavailable or stale; trading paused")
            return self.price, self.tick_time

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


def plan_trade(m, target, step):
    """At most .2 BTC AND .15% reserve notional; source target is absolute."""
    x, y, lot, tick = (int(m[k]) for k in ('x', 'y', 'base_lot', 'quote_tick'))
    spot = Decimal(y * lot) / Decimal(x * tick)
    target_x = (Decimal(int(m['k']) * lot) / (target * tick)).sqrt()
    cap = min(MAX_BASE_TRADE, int(Decimal(x) * RESERVE_FRACTION))
    base_amount = min(cap, max(MIN_BASE_TRADE, int(abs(Decimal(x) - target_x))))
    if base_amount <= lot:
        raise ValueError('Relay too thin for a bounded demo trade')
    sell = spot > target if abs(spot - target) > Decimal('.1') else bool(step % 2)
    quote_amount = int(Decimal(base_amount) * spot * tick / lot)
    expected = quote_amount - int(spot * tick) if sell else base_amount - lot
    if expected <= 0:
        raise ValueError('Demo trade below safe output precision')
    return {'sell': sell, 'amount': base_amount if sell else quote_amount,
            'base_amount': base_amount, 'min_output': expected * 998 // 1000,
            'spot': spot}


def target_price(live_price, operating_center):
    if not live_price.is_finite() or live_price <= 0 or operating_center <= 0:
        raise ValueError("Invalid live price")
    if not Decimal('.95') <= live_price / Decimal(operating_center) <= Decimal('1.05'):
        raise ValueError("Feed moved outside the demo's 5% operating band; trading paused")
    return live_price


def submit_concurrently(actions):
    """CLI waits for confirmation (~1.5s); overlap confirmation, never execution.

    The node serializes all financial mutations. Bounded concurrent waiters let
    us submit once/second without altering the CLI or weakening confirmation.
    """
    result = subprocess.run([CLI, "push", *NODE_ARGS, "--trace", "json", "--console=false",
                             *sign_flags(a["sender"] for a in actions), "-"],
                            input=json.dumps(actions), text=True, capture_output=True, timeout=30)
    trace = json.loads(result.stdout or "{}")
    if result.returncode or trace.get("error"):
        raise RuntimeError(trace.get("error") or result.stderr[-1000:])
    return time.time()


def run(config, interval):
    with activity_lock():
        return run_locked(config, interval)


def run_locked(config, interval):
    print(f"Background Coinbase BTC-USD follower; funded native transactions every {interval}s.", flush=True)
    feed = LiveFeed()
    workers = ThreadPoolExecutor(max_workers=3)
    stopping = threading.Event()
    pending = []
    confirmed, step = 0, 0
    deadline = time.monotonic()
    last_status, last_recenter = None, float('-inf')
    failure = None
    started = time.time()
    latest = {}

    def status(state, **extra):
        write_json(STATUS, {**latest, 'state': state, 'pid': os.getpid(),
                           'started_at': started, 'updated_at': time.time(),
                           'submitted': step, 'confirmed': confirmed,
                           'pending': len(pending), 'interval_seconds': interval, **extra})

    # Signal handlers only request shutdown. Cleanup runs once in finally;
    # another signal cannot reenter a blocking worker shutdown.
    def request_stop(*_):
        stopping.set()
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        while not stopping.is_set():
            for future in list(pending):
                if future.done():
                    pending.remove(future)
                    completed = future.result()  # Rejection/unknown confirmation fails closed.
                    confirmed += 1
                    print(json.dumps({'confirmed_at': completed, 'confirmed': confirmed}), flush=True)
            try:
                if len(pending) >= 3:
                    raise ValueError('Native confirmation backlog; skipping this tick')
                live_price, tick_time = feed.current()
                target = target_price(live_price, config.get('operating_center', config['center']))
                state = read_state(TAKER)
                m = next(m for m in state['markets'] if int(m['id']) == config['market'])
                if (int(m['base']) != config['base'] or int(m['quote']) != config['quote'] or
                        int(m['base_lot']) != 10_000 or int(m['quote_tick']) != 1):
                    raise RuntimeError('Demo market identity/grid changed; absolute USD pricing unavailable')
                plan = plan_trade(m, target, step)
                token = config['base' if plan['sell'] else 'quote']
                available = next(int(r['spendable']) for r in state['balances'] if int(r['token']) == token)
                if plan['amount'] > available:
                    raise RuntimeError('Dedicated demo taker funding exhausted')
                if recenter_quotes(config, target, time.monotonic(), last_recenter):
                    last_recenter = time.monotonic()
                    write_json(MARKER, config)
                # Maintenance executes BEFORE this tick's trade, so our own
                # tracking leg cannot turn a planned passive quote into a taker.
                # Other actors can still race a working limit; no post-only
                # guarantee is claimed without a native post-only action.
                actions = []
                if step % MAINTENANCE_EVERY == 0:
                    owner = MAKERS[(step // MAINTENANCE_EVERY) % len(MAKERS)]
                    actions = inventory(config, refresh=True, owners=(owner,),
                                        plan_only=True, max_updates=8, max_cancels=4)
                # First-time native wallet authentication can take seconds.
                # Use the latest ticker, not just proof that *some* newer tick
                # arrived while the old target's plan waited on those queries.
                if actions:
                    state = read_state(TAKER)
                    m = next(m for m in state['markets'] if int(m['id']) == config['market'])
                if stopping.is_set():
                    break
                live_price, tick_time = feed.current()
                target = target_price(live_price, config.get('operating_center', config['center']))
                plan = plan_trade(m, target, step)
                token = config['base' if plan['sell'] else 'quote']
                available = next(int(r['spendable']) for r in state['balances'] if int(r['token']) == token)
                if plan['amount'] > available:
                    raise RuntimeError('Dedicated demo taker funding exhausted')
                actions.append(action(TAKER, 'exchange', 'trade', {'market': config['market'],
                    'sell_base': plan['sell'], 'amount': plan['amount'],
                    'min_output': plan['min_output'], 'max_events': 64}))
                if stopping.is_set():
                    break
                submitted = time.time()
                pending.append(workers.submit(submit_concurrently, actions))
                step += 1
                latest = {'source': 'Coinbase Exchange BTC-USD WebSocket',
                          'feed_price': str(live_price), 'feed_time': tick_time,
                          'target': str(target), 'spot_before': str(plan['spot']),
                          'side': 'sell' if plan['sell'] else 'buy',
                          'base_atoms': plan['base_amount'], 'quote_center': quote_center(config),
                          'operating_center': config.get('operating_center', config['center']),
                          'submitted_at': submitted}
                status('running')
                print(json.dumps({**latest, 'submitted': step, 'confirmed': confirmed}), flush=True)
                last_status = None
            except ValueError as error:
                if str(error) != last_status:
                    print(str(error), flush=True)
                    last_status = str(error)
                status('paused', reason=str(error))
            deadline += interval
            if deadline < time.monotonic():
                deadline = time.monotonic()  # Never burst to catch up missed ticks.
            stopping.wait(max(0, deadline - time.monotonic()))
    except BaseException as error:
        failure = error
        status('failed', reason=str(error))
        raise
    finally:
        stopping.set()
        if failure is None:
            status('stopping')
        try:
            feed.close()
        except BaseException as error:
            failure = failure or error
        try:
            workers.shutdown(wait=True, cancel_futures=True)
        except BaseException as error:
            failure = failure or error
        for future in pending:
            if future.cancelled():
                continue
            try:
                future.result()
                confirmed += 1
            except BaseException as error:
                failure = failure or error
        pending.clear()
        status('failed' if failure else 'stopped', **({'reason': str(failure)} if failure else {}))


def initialize_quote_center(config):
    """Read the live source before a seed/start changes maker quotes."""
    feed = LiveFeed()
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                target = target_price(feed.current()[0], config.get('operating_center', config['center']))
                config['quote_center'] = int((target / 25).to_integral_value(rounding=ROUND_HALF_UP)) * 25
                write_json(MARKER, config)
                return
            except ValueError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
    finally:
        feed.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("seed", "start", "run", "stop", "status"))
    parser.add_argument("--interval", type=float, default=1)
    args = parser.parse_args()
    if args.operation in ("stop", "status"):
        pid = active(NAME, SCRIPT)
        print(f"Real demo activity: {'running PID ' + str(pid) if pid else 'stopped'}")
        if pid and args.operation == "stop":
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 35
            while active(NAME, SCRIPT) == pid:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Bot still stopping; inspect pending confirmations before restarting')
                time.sleep(.1)
        return
    if not 1 <= args.interval <= 3600:
        parser.error("interval must be between 1 and 3600 seconds")
    # Repeated start must not replenish or fund anything in a running bot.
    if args.operation == 'start':
        pid = active(NAME, SCRIPT)
        if pid:
            print(f'Demo activity already running (PID {pid})')
            return
    config = setup()
    if args.operation == 'run':
        return run(config, args.interval)
    fund_accounts(config)
    initialize_quote_center(config)
    count = inventory(config)
    print(f"Added or replenished {count} funded orders across 48 prices")
    if args.operation == "start":
        start(NAME, [sys.executable, str(SCRIPT), "run", "--interval", str(args.interval)], SCRIPT)


if __name__ == "__main__":
    sys.exit(main())
