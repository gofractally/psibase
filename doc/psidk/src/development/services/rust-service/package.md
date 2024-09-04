# Building Packages

A [psibase package](../../../specifications/data-formats/package.md) may be composed of one or more crates. It can be built by `cargo psibase package` or installed on a running chain with `cargo psibase install`.

`cargo psibase` reads the `[package.metadata.psibase]` section of `Cargo.toml`. At the minimum, `package-name` must be specified.

The available fields are:

- `package-name`: Must be present on the top-level crate for the package.
- `services`: A list of services to include in the psibase package.
- `server`: May be present on any crate that builds a service. The value is a crate which will handle HTTP requests sent to this service. The other crate will be built and included in the current package.
- `plugin`: May be present on any crate that builds a service. The value is a crate that should be built with `cargo component` and uploaded as `/plugin.wasm`
- `flags`: [Flags](../../../specifications/data-formats/package.md#serviceservicejson) for the service.
- `dependencies`: Additional packages, not build by cargo, that the package depends on.

Example:

```toml
[package]
name = "example"
version = "0.1.0"

[package.metadata.psibase]
# Builds example.psi
package-name = "example"
# Most services besides the core system services don't need extra flags.
flags = []
# This service handles its own HTTP requests
server = "example"
# Plugin for the front end
plugin = "example-plugin"

[package.metadata.psibase.dependencies]
HttpServer = "0.12.0"
```
