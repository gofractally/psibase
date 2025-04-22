# Description

The wasip2 shims are provided by the JCO library.

There is no provided wasi-keyvalue browser shim, because the interface is not yet accepted as a wasi standard. `wasi-keyvalue.js` is therefore a custom shim used to remain maximally compliant and simplify the efforts to migrate once it's standardized.

# Availability

Not all shims are necessarily available to components. The supervisor infra can be updated to allow/disallow different components access to different shims based on various conditions.
