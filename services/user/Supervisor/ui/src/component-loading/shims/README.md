# Description

These are browser shims for core libraries that components may depend on. The wasip2 shims are copied from the minified browser shims provided by the BytecodeAlliance.

- [Source](https://github.com/bytecodealliance/jco/tree/main/packages/preview2-shim/lib/browser)

There is no provided wasi-keyvalue browser shim, because the interface is not yet accepted as a wasi standard. `wasi-keyvalue.js` is therefore a custom shim used to remain maximally compliant and simplify the efforts to migrate once it's standardized.

# Availability

Not all shims are necessarily available to components. The supervisor infra can be updated to allow/disallow different components access to different shims based on various conditions.
