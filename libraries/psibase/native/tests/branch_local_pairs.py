#!/usr/bin/env python3
"""The measure that the wasm limits max_branch_local_pairs and
max_module_branch_local_pairs bound (gofractally/psibase#2267), computed from
the bytes of a module without the node's code. The node gets it from psizam's
parser (AdmissionWriter in ../src/PsizamPolicy.cpp); this is the same
definition written a second time, and the test VmBranchLocalPairs holds the
two equal. The definition, why it is this, and what a unit costs a compiler
are at vmOptionCeilings in ../include/psibase/PsizamPolicy.hpp.

    branch_local_pairs.py [--functions] <file.wasm>...
    branch_local_pairs.py --compare VmAdmissionFuzz [--cost-modules GEN]
                          [--corpus GEN] [--dir DIR] [<file.wasm>...]

The first form prints for each core module
    PAIRS <file>: functions N, largest M (function I), sum S
with --functions also, for each defined function,
    FUNCTION <file> <function index> <pairs>
and then the largest function, the largest module sum and percentiles. A file
that is not a core module (a component, say) is reported and skipped. To
survey a build tree:
    find BUILD -name '*.wasm' | xargs branch_local_pairs.py | tail -4

The second form is the test: it asks the tool for the same lines
(VmAdmissionFuzz --pairs --functions) and fails if any function of any module
the tool admits has a different value here, if the tool fails, or if nothing
was compared. --cost-modules names gen_compile_cost_modules.py and --corpus
psizam's gen_admission_corpus.py; each is run to write its modules under DIR.

A region is a block, a loop or an if, from its opening instruction to its
end. For each region of a function,
    edges  = the branches that name its label (one for each br and br_if, one
             for each entry of a br_table and one for its default), plus 1
             for a block or a loop, plus 2 for an if
    values = the distinct locals that a local.set or local.tee inside the
             region names, plus the operands a branch to its label carries
             (the results of a block or if, the parameters of a loop)
and the function's measure is the sum of edges x values over its regions,
plus (branches to the function's own label + 1) x its results. The module's
is the sum over its functions.

Reads the proposals the chain admits: MVP, sign extension, saturating
conversions, multi-value, bulk memory, reference types, SIMD, relaxed SIMD,
atomics instructions, wide arithmetic. Standard library only.
"""
import argparse
import glob
import os
import re
import subprocess
import sys


class NotCore(Exception):
    pass


class R:
    def __init__(self, b, p=0, e=None):
        self.b, self.p, self.e = b, p, len(b) if e is None else e

    def byte(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def u(self):
        v = s = 0
        while True:
            c = self.b[self.p]
            self.p += 1
            v |= (c & 0x7f) << s
            s += 7
            if not c & 0x80:
                return v

    def s(self):
        v = s = 0
        while True:
            c = self.b[self.p]
            self.p += 1
            v |= (c & 0x7f) << s
            s += 7
            if not c & 0x80:
                return v - (1 << s) if c & 0x40 else v

    def sub(self, n):
        r = R(self.b, self.p, self.p + n)
        self.p += n
        return r

    def skip(self, n):
        self.p += n

    def more(self):
        return self.p < self.e


VALTYPES = {0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f}


def function_pairs(r, types, ftype):
    """(pairs, edges, locals) of the body in r; edges and locals are the
    function's totals, for information."""
    params, results = types[ftype]
    locals_ = params
    for _ in range(r.u()):
        locals_ += r.u()
        r.byte()
    pairs = total_edges = 0
    # The writes so far, and for each local the number of its last one.
    now = 0
    last = {}
    # For every open region, the function outermost:
    # [branches to its label, operands such a branch carries, its own edges,
    #  the number of the first write inside it, locals whose last write is
    #  after that and before the next open region began]
    frames = [[0, results, 1, 1, 0]]

    def branch(depth):
        if depth < len(frames):
            frames[-1 - depth][0] += 1

    def blocktype():
        c = r.b[r.p]
        if c == 0x40:
            r.p += 1
            return 0, 0
        if c in VALTYPES:
            r.p += 1
            return 0, 1
        return types[r.s()]

    def memarg():
        r.u()
        r.u()

    while frames:
        op = r.byte()
        if op in (0x02, 0x03, 0x04):
            p, q = blocktype()
            frames.append([0, p if op == 0x03 else q, 2 if op == 0x04 else 1, now + 1, 0])
        elif op == 0x0b:
            branches, carried, own, _, written = frames.pop()
            if frames:
                frames[-1][4] += written
            else:
                written = 0  # no local is read after the function's end
            pairs += (branches + own) * (written + carried)
            total_edges += branches + own
        elif op in (0x0c, 0x0d):
            branch(r.u())
        elif op == 0x0e:
            for _ in range(r.u() + 1):
                branch(r.u())
        elif op in (0x21, 0x22):
            x = r.u()
            before = last.get(x)
            if before is not None:
                # The region whose part of the function that write is in.
                lo, hi = 0, len(frames) - 1
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if frames[mid][3] <= before:
                        lo = mid
                    else:
                        hi = mid - 1
                frames[lo][4] -= 1
            now += 1
            last[x] = now
            frames[-1][4] += 1
        elif op in (0x10, 0x20, 0x23, 0x24, 0x25, 0x26, 0xd0, 0xd2, 0x3f, 0x40):
            r.u()
        elif op == 0x11:
            r.u()
            r.u()
        elif op == 0x1c:
            for _ in range(r.u()):
                r.byte()
        elif 0x28 <= op <= 0x3e:
            memarg()
        elif op in (0x41, 0x42):
            r.s()
        elif op == 0x43:
            r.p += 4
        elif op == 0x44:
            r.p += 8
        elif op == 0xfc:
            sub = r.u()
            if sub in (8, 10, 12, 14):
                r.u()
                r.u()
            elif sub in (9, 11, 13, 15, 16, 17):
                r.u()
            elif sub > 22:
                raise ValueError("instruction 0xfc %d" % sub)
        elif op == 0xfd:
            sub = r.u()
            if sub <= 11 or sub in (92, 93):
                memarg()
            elif sub in (12, 13):
                r.p += 16
            elif 21 <= sub <= 34:
                r.p += 1
            elif 84 <= sub <= 91:
                memarg()
                r.p += 1
        elif op == 0xfe:
            if r.u() == 3:
                r.p += 1
            else:
                memarg()
        elif op in (0x00, 0x01, 0x05, 0x0f, 0x1a, 0x1b, 0xd1) or 0x45 <= op <= 0xc4:
            pass
        else:
            raise ValueError("instruction 0x%02x" % op)
    if r.p != r.e:
        raise ValueError("the body does not end where its size says")
    return pairs, total_edges, locals_


def module_pairs(data):
    """[(function index, pairs, edges, locals)] of the defined functions."""
    if data[:8] != b"\0asm\1\0\0\0":
        raise NotCore()
    r = R(data, 8)
    types, functions, imported, out = [], [], 0, []
    while r.more():
        sid = r.byte()
        s = r.sub(r.u())
        if sid == 1:
            for _ in range(s.u()):
                if s.byte() != 0x60:
                    raise ValueError("a type that is not a function type")
                p = s.u()
                s.skip(p)
                q = s.u()
                s.skip(q)
                types.append((p, q))
        elif sid == 2:
            for _ in range(s.u()):
                s.skip(s.u())
                s.skip(s.u())
                kind = s.byte()
                if kind == 0:
                    functions.append(s.u())
                    imported += 1
                elif kind in (1, 2):
                    if kind == 1:
                        s.byte()
                    flags = s.u()
                    s.u()
                    if flags & 1:
                        s.u()
                elif kind == 3:
                    s.byte()
                    s.byte()
                else:
                    raise ValueError("import kind %d" % kind)
        elif sid == 3:
            for _ in range(s.u()):
                functions.append(s.u())
        elif sid == 10:
            for i in range(s.u()):
                body = s.sub(s.u())
                out.append((imported + i,) + function_pairs(body, types, functions[imported + i]))
    return out


def percentile(sorted_values, p):
    if not sorted_values:
        return 0
    return sorted_values[min(len(sorted_values) - 1, int(len(sorted_values) * p))]


def survey(files, per_function):
    largest, sums, every = [], [], []
    for name in files:
        with open(name, "rb") as f:
            data = f.read()
        try:
            rows = module_pairs(data)
        except NotCore:
            print("SKIP %s: not a core module" % name)
            continue
        if per_function:
            for index, pairs, _, _ in rows:
                print("FUNCTION %s %d %d" % (name, index, pairs))
        top = max(rows, key=lambda row: row[1], default=(0, 0, 0, 0))
        total = sum(row[1] for row in rows)
        print("PAIRS %s: functions %d, largest %d (function %d), sum %d"
              % (name, len(rows), top[1], top[0], total))
        largest.append((top[1], name))
        sums.append((total, name))
        every.extend(row[1] for row in rows)
    if largest:
        largest.sort()
        sums.sort()
        every.sort()
        print("modules %d, functions %d" % (len(largest), len(every)))
        print("largest function: %d in %s; over modules: median %d, 99th percentile %d"
              % (largest[-1][0], largest[-1][1], percentile([v for v, _ in largest], 0.5),
                 percentile([v for v, _ in largest], 0.99)))
        print("over functions: median %d, 99th percentile %d, 99.9th %d"
              % (percentile(every, 0.5), percentile(every, 0.99), percentile(every, 0.999)))
        print("largest module sum: %d in %s; over modules: median %d, 99th percentile %d"
              % (sums[-1][0], sums[-1][1], percentile([v for v, _ in sums], 0.5),
                 percentile([v for v, _ in sums], 0.99)))


FUNCTION = re.compile(r"^FUNCTION (.*) (\d+) (\d+)$")
VERDICT = re.compile(r"^(PAIRS|REFUSE) (.*?): ")


def compare(tool, files):
    """The failures; prints what was compared."""
    failures = []
    modules = functions = refused = 0
    for start in range(0, len(files), 200):
        batch = files[start:start + 200]
        run = subprocess.run([tool, "--pairs", "--functions"] + batch,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if run.returncode:
            failures.append("%s exited %d on the batch that starts with %s: %s"
                            % (tool, run.returncode, batch[0],
                               run.stderr.decode("utf-8", "replace").strip()[-300:]))
            continue
        theirs, verdict = {}, {}
        for line in run.stdout.decode("utf-8", "replace").splitlines():
            m = FUNCTION.match(line)
            if m:
                theirs.setdefault(m.group(1), {})[int(m.group(2))] = int(m.group(3))
                continue
            m = VERDICT.match(line)
            if m:
                verdict[m.group(2)] = m.group(1)
        for name in batch:
            if verdict.get(name) == "REFUSE":
                refused += 1
                continue
            if verdict.get(name) != "PAIRS":
                failures.append("%s: the tool gave no verdict" % name)
                continue
            with open(name, "rb") as f:
                try:
                    ours = {index: pairs for index, pairs, _, _ in module_pairs(f.read())}
                except Exception as e:  # the tool admitted what this cannot read
                    failures.append("%s: admitted by the tool, unreadable here: %r" % (name, e))
                    continue
            modules += 1
            functions += len(ours)
            if ours != theirs.get(name, {}):
                got = theirs.get(name, {})
                differ = sorted(i for i in set(ours) | set(got) if ours.get(i) != got.get(i))
                failures.append("%s: function %d is %s here and %s in the tool (%d functions differ)"
                                % (name, differ[0], ours.get(differ[0]), got.get(differ[0]),
                                   len(differ)))
    print("%d modules: %d admitted and compared (%d functions), %d refused by admission"
          % (len(files), modules, functions, refused))
    if not modules:
        failures.append("nothing was compared")
    return failures


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--functions", action="store_true", help="print every function")
    ap.add_argument("--compare", metavar="TOOL", help="VmAdmissionFuzz; compare with its values")
    ap.add_argument("--cost-modules", metavar="GENERATOR", help="gen_compile_cost_modules.py")
    ap.add_argument("--corpus", metavar="GENERATOR", help="psizam's gen_admission_corpus.py")
    ap.add_argument("--dir", help="where generated modules are written")
    ap.add_argument("files", nargs="*")
    args = ap.parse_args()
    files = list(args.files)
    for generator, sub, arguments in ((args.cost_modules, "cost", ["--small"]),
                                      (args.corpus, "corpus", ["--seed", "1", "--count", "0"])):
        if not generator:
            continue
        if not args.dir:
            ap.error("--dir is needed to generate modules")
        out = os.path.join(args.dir, sub)
        os.makedirs(out, exist_ok=True)
        for old in glob.glob(os.path.join(out, "*.wasm")):
            os.remove(old)
        made = subprocess.run([sys.executable, generator] + arguments + ["--out", out],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if made.returncode:
            sys.exit("FAILED: %s exited %d: %s"
                     % (generator, made.returncode, made.stdout.decode("utf-8", "replace")[-500:]))
        written = sorted(glob.glob(os.path.join(out, "*.wasm")))
        print("%s wrote %d modules" % (os.path.basename(generator), len(written)))
        if not written:
            sys.exit("FAILED: %s wrote nothing" % generator)
        files += written
    if not args.compare:
        survey(files, args.functions)
        return
    failures = compare(args.compare, files)
    for failure in failures[:50]:
        print("FAILED: " + failure)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
