The Linux `n-triedent-tests` CTest registration limits only its child process's
memory-lock soft limit to at most 64 KiB, preserving a lower inherited soft or
hard limit and leaving the hard limit unchanged. Other platforms retain their
existing launcher. The wrapper executes the same binary, all cases and all
generated inputs, and preserves the binary's exit status. It changes no timeout.

These correctness fixtures repeatedly create databases with three 1 GiB cache
tiers even when they contain only a few keys. On a Linux host with a 64 GiB
memory-lock limit, successful `mlock` calls fault in approximately 2.8 TiB across
the complete generated suite. This allocation behavior can exceed the existing
600-second test limit without a deadlock. Under a restricted memory-lock limit,
the same mappings and database operations remain exercised, while oversized
pin requests fail as they do on restricted CI hosts.

This is not a memory pressure or successful-pinning qualification. Run
`triedent-tests` directly under an explicitly recorded memory-lock policy for
that purpose. The test wrapper does not change psinode, psitest, the database
configuration, or any production memory-lock policy.
