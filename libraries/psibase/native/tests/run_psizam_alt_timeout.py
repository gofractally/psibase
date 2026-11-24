#!/usr/bin/env python3
"""Keep VM deadline regressions bounded even when a generated loop never traps."""
import argparse
import os
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable')
    # The bound only has to catch a loop that never traps. The probe takes about
    # a second on an idle machine and several times that when a parallel test
    # run has every core busy, so the bound is far from both.
    parser.add_argument('--timeout', type=float, default=60.0)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='psizam-alt-timeout-') as state:
        env = dict(os.environ, TMPDIR=state)
        try:
            result = subprocess.run([args.executable, '[.alt-timeout-probe]'],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, timeout=args.timeout, env=env)
        except subprocess.TimeoutExpired as error:
            output = error.stdout or b''
            if isinstance(output, bytes):
                output = output.decode(errors='replace')
            print(output, end='')
            print('Alt-context deadline failed: generated execution exceeded the subprocess bound.')
            return 1
        print(result.stdout, end='')
        return result.returncode if result.returncode >= 0 else 1


if __name__ == '__main__':
    sys.exit(main())
