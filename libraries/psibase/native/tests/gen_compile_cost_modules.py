#!/usr/bin/env python3
"""Modules that cost a compiler far more than their size suggests: the family
behind the wasm limits max_branch_local_pairs and max_module_branch_local_pairs
(gofractally/psibase#2267; the measurements are summarised at vmOptionCeilings
in ../include/psibase/PsizamPolicy.hpp).

    gen_compile_cost_modules.py --out DIR            the whole family
    gen_compile_cost_modules.py --out DIR --small    a few small ones (the test
                                                     VmBranchLocalPairs)

Every function has type (i32) -> i64: one i32 parameter and L - 1 i64 locals.
The first is exported as f0. Names say the shape:

  g_<variant>_L<l>_T<t>[_K<k>]   K merges in sequence. Each is a block reached
        by an arm that writes every local, and by T more edges from one
        br_table. Variants:
          live    every local is read after the merge and the sum returned
          unused  read after the merge, the sum dropped
          last    as live, read only after the last merge
          dead    never read after the merge (costs a compiler nothing)
          same    never written, read after (costs nothing)
  e_<variant>_L<l>_T<t>          the same with T br_if instead of the table
  n_if_L<l>_D<d>                 D nested ifs, every local written in the
        innermost and read after the outermost: two edges into each of D
        merges and L new values at each. The most memory per unit of the
        measure of any shape tried.
  n_brif_L<l>_D<d>               the same with D nested blocks and D br_if,
        one to each block's end
  n_loop_L<l>_D<d>               D nested loops, each with one back edge
  s_L<l>_T<t>_N<n>               N copies of g_live in one module

To measure what a compiler needs for one of them, as the node configures it
(the limits have to be lifted for the module to reach the compiler):

    /usr/bin/time -l VmAdmissionFuzz --verbose \\
        --set max_branch_local_pairs=4294967295 \\
        --set max_module_branch_local_pairs=4294967295 DIR/n_if_L2047_D128.wasm

and its measure: VmAdmissionFuzz --pairs FILE, or branch_local_pairs.py FILE.
Standard library only.
"""
import argparse
import os


def leb(n):
    b = bytearray()
    while True:
        c = n & 0x7f
        n >>= 7
        if n:
            b.append(c | 0x80)
        else:
            b.append(c)
            return bytes(b)


def sec(i, body):
    return bytes([i]) + leb(len(body)) + body


def vec(items):
    return leb(len(items)) + b''.join(items)


def module(bodies):
    m = b'\0asm\1\0\0\0'
    m += sec(1, vec([b'\x60\x01\x7f\x01\x7e']))
    m += sec(3, vec([leb(0)] * len(bodies)))
    m += sec(7, vec([leb(2) + b'f0' + b'\x00' + leb(0)]))
    m += sec(10, vec([leb(len(b)) + b for b in bodies]))
    return m


def declare(L):
    return leb(1) + leb(L - 1) + b'\x7e' if L > 1 else leb(0)


def read_all(L):
    """The sum of the i64 locals."""
    if L == 1:
        return b'\x42\x00'
    o = bytearray(b'\x20' + leb(1))
    for i in range(2, L):
        o += b'\x20' + leb(i) + b'\x7c'
    return bytes(o)


def write_all(L, k=0):
    o = bytearray()
    for i in range(1, L):
        o += b'\x42' + leb((i + k) % 64) + b'\x21' + leb(i)
    return bytes(o)


def merges(L, T, K=1, variant='live', edge='table'):
    b = bytearray(declare(L))
    for k in range(K):
        b += b'\x02\x40\x02\x40'               # block $a, block $b
        b += b'\x20\x00\x04\x40'               # local.get 0, if
        if variant != 'same':
            b += write_all(L, k)
        b += b'\x0c\x02\x0b'                   # br $a, end
        if edge == 'table':
            b += b'\x20\x00\x0e' + leb(T) + b'\x01' * T + b'\x00'
        else:
            b += b'\x20\x00\x0d\x01' * T       # local.get 0, br_if $a
        b += b'\x0b\x0b'                       # end $b, end $a: the merge
        if variant in ('live', 'same', 'unused') and k < K - 1:
            b += read_all(L) + b'\x1a'
    if variant in ('live', 'same', 'last'):
        b += read_all(L)
    elif variant == 'unused':
        b += read_all(L) + b'\x1a\x42\x07'
    else:
        b += b'\x42\x07'
    return bytes(b + b'\x0b')


def nested_if(L, D):
    b = bytearray(declare(L))
    b += b'\x20\x00\x04\x40' * D               # local.get 0, if
    b += write_all(L) + b'\x0b' * D + read_all(L)
    return bytes(b + b'\x0b')


def nested_br_if(L, D):
    b = bytearray(declare(L))
    b += b'\x02\x40' * D
    for d in range(D):
        b += b'\x20\x00\x0d' + leb(d)          # local.get 0, br_if d
    b += write_all(L) + b'\x0b' * D + read_all(L)
    return bytes(b + b'\x0b')


def nested_loop(L, D):
    b = bytearray(declare(L))
    b += b'\x03\x40' * D
    b += write_all(L)
    b += b'\x20\x00\x0d\x00\x0b' * D           # local.get 0, br_if 0, end
    b += read_all(L)
    return bytes(b + b'\x0b')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--small", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    def w(name, bodies):
        with open(os.path.join(args.out, name + '.wasm'), 'wb') as f:
            f.write(module(bodies))

    if args.small:
        sizes, tables, depths, copies = [(1, 3), (16, 16), (128, 256)], [(64, 64, 3)], [(64, 50)], 4
    else:
        sizes = [(L, T) for L in (16, 128, 512, 2047) for T in (16, 256, 1024, 4096)]
        tables = [(512, 512, 2), (1024, 1024, 2), (2047, 4096, 2), (2047, 4096, 4)]
        depths = [(L, D) for L in (128, 512, 2047) for D in (128, 250, 1000)]
        copies = 16
    for L, T in sizes:
        for variant in ('live', 'unused', 'dead', 'same'):
            w('g_%s_L%d_T%d' % (variant, L, T), [merges(L, T, 1, variant)])
        for variant in ('live', 'unused'):
            w('e_%s_L%d_T%d' % (variant, L, T), [merges(L, T, 1, variant, 'brif')])
    for L, T, K in tables:
        for variant in ('live', 'last', 'unused'):
            w('g_%s_L%d_T%d_K%d' % (variant, L, T, K), [merges(L, T, K, variant)])
    for L, D in depths:
        w('n_if_L%d_D%d' % (L, D), [nested_if(L, D)])
        w('n_brif_L%d_D%d' % (L, D), [nested_br_if(L, D)])
        w('n_loop_L%d_D%d' % (L, D), [nested_loop(L, D)])
    L, T = sizes[-1] if args.small else (512, 1000)
    w('s_L%d_T%d_N%d' % (L, T, copies), [merges(L, T)] * copies)


if __name__ == "__main__":
    main()
