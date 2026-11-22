#!/usr/bin/python
"""Two nodes on one chain, each running a different execution engine.

The producer boots a chain and keeps producing. The other node syncs every
block from it and re-executes each one; it only accepts a block if its own
execution reproduces the producer's state. Agreement on the same block id at
the same height is therefore agreement on everything the blocks did. The chain also signs periodic
checksums of its whole state, and at the end both nodes' full state dumps are
compared byte for byte.

  cross_engine.py --engine jit2=<build>/psinode --engine wasmtime=<build>/psinode \\
                  --psibase <build>/rust/release/psibase
"""
import os, sys, time, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psinode

ENGINES = {}
CLI = None

def scenario(producer, validator, extra_blocks, root):
    label = '%s produces, %s validates' % (producer, validator)
    workdir = os.path.join(root, producer + '-to-' + validator)
    shutil.rmtree(workdir, ignore_errors=True)
    cluster = psinode.Cluster(dir=workdir)
    with cluster:
        a = cluster.make_node('a', executable=ENGINES[producer])
        a.psibase = CLI
        t0 = time.time()
        a.boot()
        boot_seconds = time.time() - t0
        # Give the producer a signing key and turn on periodic state
        # checkpoints: every few seconds the producer signs a checksum of the
        # whole chain state. A node only has a verified checkpoint if its own
        # state matches what was signed.
        a.push_action('root', 'accounts', 'setAuthServ', {'authService': 'auth-any'})
        with a.post('/native/admin/keys', service='x-admin', json={"service": "verify-sig"}) as reply:
            reply.raise_for_status()
            auth = {"name": a.producer, "auth": reply.json()[0]}
        a.set_producers([auth], algorithm='cft')
        a.push_action('transact', 'transact', 'setSnapTime', {"seconds": 3})
        b = cluster.make_node(executable=ENGINES[validator])
        b.psibase = CLI
        b.connect(a)
        target = a.get_block_header()['blockNum'] + extra_blocks
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                hb = b.get_block_header()['blockNum']
            except Exception:
                hb = 0
            if hb >= target:
                break
            time.sleep(1)
        ha = a.get_block_header()
        hb = b.get_block_header()
        common = min(ha['blockNum'], hb['blockNum'])
        ia = a.get_block_header(common)
        ib = b.get_block_header(common)
        same = ia == ib
        print('%s: boot %.1fs, producer head %d, validator head %d, header at %d identical: %s'
              % (label, boot_seconds, ha['blockNum'], hb['blockNum'], common, same), flush=True)
        if not same or hb['blockNum'] < target:
            print('  producer header :', ia)
            print('  validator header:', ib)
            for n, node in (('producer', a), ('validator', b)):
                with open(node.logpath) as f:
                    lines = [l for l in f.read().splitlines() if 'error' in l.lower() or 'fail' in l.lower()]
                print('  %s log errors (%d):' % (n, len(lines)))
                for l in lines[-8:]:
                    print('    ' + l[:300])
        ok = same and hb['blockNum'] >= target
        # Stop the producer, let the validator reach the final block, then dump
        # each node's full chain state and compare the dumps byte for byte.
        a.shutdown()
        final = None
        for _ in range(30):
            hb = b.get_block_header()
            if final is not None and hb['blockNum'] == final:
                break
            final = hb['blockNum']
            time.sleep(1)
        b.shutdown()
        time.sleep(1)
        digests = []
        for node in (a, b):
            out = os.path.join(node.dir, 'state.snapshot')
            r = node.run_psibase(['create-snapshot', node.dir, out], check=False)
            if r.returncode != 0 or not os.path.exists(out):
                print('  create-snapshot failed for', node.dir)
                digests.append(None)
                continue
            import hashlib
            with open(out, 'rb') as f:
                data = f.read()
            digests.append((len(data), hashlib.sha256(data).hexdigest()))
        print('  final block %s; state dump producer %s' % (final, digests[0]))
        print('  %sstate dump validator %s -> %s' % (' ' * len('final block %s; ' % final), digests[1],
              'IDENTICAL' if digests[0] and digests[0] == digests[1] else 'DIFFERENT'), flush=True)
        return ok and digests[0] is not None and digests[0] == digests[1]

if __name__ == '__main__':
    import argparse, tempfile
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', action='append', required=True, metavar='NAME=PSINODE',
                        help='a psinode binary built with one execution engine; give two or more')
    parser.add_argument('--psibase', required=True, help='the psibase command-line tool')
    parser.add_argument('--dir', help='directory for node databases (default: temporary)')
    args = parser.parse_args()
    for spec in args.engine:
        name, path = spec.split('=', 1)
        ENGINES[name] = os.path.abspath(path)
    CLI = os.path.abspath(args.psibase)
    root = args.dir or tempfile.mkdtemp(prefix='cross-engine-')
    ok = True
    for producer in ENGINES:
        for validator in ENGINES:
            if producer != validator:
                ok = scenario(producer, validator, 15, root) and ok
    sys.exit(0 if ok else 1)
