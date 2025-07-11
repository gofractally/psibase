# System Functions

Some parts of the C++ standard library that interact with the host system are restricted or unavailable in services.

## I/O

Only stdout and stderr are available. They both write to a single merged stream which is in included the transaction trace. stdin is not supported.

Supported APIs:
- `write`
- `printf` family
- `std::cout`, `std::cerr`, `std::clog`

## Clocks

UTC, monotonic, and CPU clocks are available to subjective services. The monotonic clock is only guaranteed to be monotonic within a block. The CPU clock measures CPU time spent on the current transaction.

Supported APIs:
- `clock_gettime` with `CLOCK_REALITME`, `CLOCK_MONOTONIC`, or `CLOCK_PROCESS_CPUTIME_ID`
- `clock`
- `time`
- `std::chrono::system_clock`
- `std::chrono::monotonic_clock`
- `std::chrono::high_resolution_clock`

## Unavailable Functionality

- Filesystem
- Nondeterministic random numbers
- Concurrency
- Exceptions
- `setjmp`/`longjmp`
