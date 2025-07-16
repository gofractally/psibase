# Description

These are browser shims for core libraries that components may depend on. The WASI Preview2 shims are now automatically generated from the official `@bytecodealliance/preview2-shim` package provided by JCO.

- [JCO Preview2 Shim Source](https://github.com/bytecodealliance/jco/tree/main/packages/preview2-shim)

There is no provided wasi-keyvalue browser shim, because the interface is not yet accepted as a wasi standard. `wasi-keyvalue.js` is therefore a custom shim used to remain maximally compliant and simplify the efforts to migrate once it's standardized.

## Migration from Bundled Shims

The previous implementation used a bundled `wasip2-shim.js` file. This has been replaced with dynamic generation from the official `@bytecodealliance/preview2-shim` package, which provides:

- CLI interfaces (environment, exit, stderr, stdin, stdout)
- Clock interfaces (monotonic-clock, wall-clock)  
- Filesystem interfaces (types, preopens)
- IO interfaces (error, streams)
- Random interface

This change allows us to stay current with the latest WASI Preview2 implementations while maintaining the same security whitelisting approach.

# Availability

Not all shims are necessarily available to components. The supervisor infra can be updated to allow/disallow different components access to different shims based on various conditions.
