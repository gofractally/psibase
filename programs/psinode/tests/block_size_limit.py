#!/usr/bin/python
"""The chain's block size limit, changed on a live chain.

A producer and a second node (which may run a different execution engine)
share a chain. The script sends a burst of transactions under the default
limit, lowers the limit with transact::setMaxBlockSize, sends another burst,
restores it and sends a third. It checks that the producer packs blocks to
whatever the limit is at the time, that a limit outside the allowed range is
refused, and that the second node accepts every block.

  block_size_limit.py --producer <psinode> --validator <psinode> --psibase <cli>
"""
import argparse, os, shutil, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psinode

def transactions_per_block(node):
    out, n = [], 0
    for line in open(node.logpath, errors='replace'):
        if 'Transaction succeeded' in line or 'Transaction failed' in line:
            n += 1
        elif 'Produced block' in line:
            out.append(n)
            n = 0
    return out

def burst(node, count, tag):
    '''Creates `count` accounts at once; returns the transactions in each non-empty block.'''
    before = len(transactions_per_block(node))
    errors = []
    letters = 'abcdefghijklmnopqrstuvwxyz'
    def send(i):
        name = tag + letters[i % 26] + letters[(i // 26) % 26] + letters[i % 7]
        r = node.run_psibase(['create'] + node.node_args() + ['-i', name], check=False,
                             capture_output=True)
        if r.returncode:
            errors.append((r.stderr or b'')[-160:])
    threads = [threading.Thread(target=send, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    time.sleep(3)
    blocks = [n for n in transactions_per_block(node)[before:] if n]
    print('%s: %d sent, %d failed, transactions per non-empty block %s' % (tag, count, len(errors), blocks),
          flush=True)
    return blocks, errors

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--producer', required=True, help='psinode binary for the producing node')
    parser.add_argument('--validator', required=True, help='psinode binary for the second node')
    parser.add_argument('--psibase', required=True, help='the psibase command-line tool')
    parser.add_argument('--dir', help='directory for node databases (default: temporary)')
    args = parser.parse_args()
    root = args.dir or tempfile.mkdtemp(prefix='block-size-')
    shutil.rmtree(root, ignore_errors=True)
    ok = True
    with psinode.Cluster(dir=root) as cluster:
        a = cluster.make_node('a', executable=os.path.abspath(args.producer))
        a.psibase = os.path.abspath(args.psibase)
        a.boot()
        b = cluster.make_node(executable=os.path.abspath(args.validator))
        b.connect(a)

        wide, errors = burst(a, 40, 'wide')
        ok = ok and not errors and max(wide) > 20

        try:
            a.push_action('transact', 'transact', 'setMaxBlockSize', {'bytes': 100})
            print('a limit of 100 bytes was accepted', flush=True)
            ok = False
        except Exception as e:
            print('a limit of 100 bytes is refused: %s' % str(e)[:80], flush=True)

        a.push_action('transact', 'transact', 'setMaxBlockSize', {'bytes': 1024})
        time.sleep(2)
        narrow, errors = burst(a, 40, 'narrow')
        # An account creation is a little over 100 bytes: several fit in 1024, never 40.
        ok = ok and not errors and 1 < max(narrow) < 12 and sum(narrow) >= 40

        a.push_action('transact', 'transact', 'setMaxBlockSize', {'bytes': 4 << 20})
        time.sleep(2)
        again, errors = burst(a, 40, 'again')
        ok = ok and not errors and max(again) > 20

        time.sleep(4)
        ha, hb = a.get_block_header(), b.get_block_header()
        common = min(ha['blockNum'], hb['blockNum'])
        same = a.get_block_header(common) == b.get_block_header(common)
        refused = any('exceeds maxBlockSize' in l for l in open(b.logpath, errors='replace'))
        print('producer head %d, validator head %d, header at %d identical: %s, validator refused a block: %s'
              % (ha['blockNum'], hb['blockNum'], common, same, refused), flush=True)
        ok = ok and same and not refused and hb['blockNum'] >= ha['blockNum'] - 2
    sys.exit(0 if ok else 1)
