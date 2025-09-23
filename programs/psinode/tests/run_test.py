#!/usr/bin/env python3

import sys
import argparse
import unittest
import testutil

def main():
    parser = argparse.ArgumentParser(description='Run psibase tests')
    parser.add_argument('--psinode', default='/root/psibase/build/psinode',
                        help='Path to the psinode executable')
    parser.add_argument('--log-filter', metavar='FILTER', help='Filter for log messages')
    parser.add_argument('--log-format', metavar='FORMAT', help='Format for log messages')
    parser.add_argument('--print-logs', metavar='NODE', action='append',
                        help='Nodes whose logs should be printed')
    parser.add_argument('--test-packages', metavar='DIRECTORY',
                        help='Directory containing test packages')
    parser.add_argument('--libsofthsm2', metavar='PATH', help='Path to libsofthsm.so')
    parser.add_argument('--test-wasms', metavar='PATH',
                        help='Directory containing wasm programs used by the test suite')
    parser.add_argument('test_name', nargs='?', default=None,
                        help='Test name (e.g., test_psibase.TestPsibase.test_info)')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    # Set up testutil args
    testutil.args = argparse.Namespace(
        psinode=args.psinode,
        log_filter=args.log_filter,
        log_format=args.log_format,
        print_logs=args.print_logs,
        test_packages=args.test_packages,
        libsofthsm2=args.libsofthsm2,
        test_wasms=args.test_wasms
    )

    # Run the test
    if args.test_name:
        print(f"Running test: {args.test_name}")
        loader = unittest.TestLoader()
        suite = loader.loadTestsFromName(args.test_name)
        runner = unittest.TextTestRunner(verbosity=2 if args.verbose else 1)
        result = runner.run(suite)
        print(f"\nResults: {result.testsRun} tests run, {len(result.failures)} failures, {len(result.errors)} errors")
        return 0 if (result.wasSuccessful()) else 1
    else:
        # Run all tests
        loader = unittest.TestLoader()
        suite = loader.discover('.', pattern='test_*.py')
        runner = unittest.TextTestRunner(verbosity=2 if args.verbose else 1)
        result = runner.run(suite)
        print(f"\nResults: {result.testsRun} tests run, {len(result.failures)} failures, {len(result.errors)} errors")
        return 0 if (result.wasSuccessful()) else 1

if __name__ == '__main__':
    sys.exit(main())
