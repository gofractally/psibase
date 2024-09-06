# Building Packages

A [psibase package](../../../specifications/data-formats/package.md) may be composed of one or more crates. It can be built by `cargo psibase package` or installed on a running chain with `cargo psibase install`.

`cargo psibase` reads the `[package.metadata.psibase]` section of `Cargo.toml`. At the minimum, `package-name` must be specified.

The available fields are:

- `package-name`: Must be present on the top-level crate for the package.
- `services`: A list of services to include in the psibase package.
- `server`: May be present on any crate that builds a service. The value is a crate which will handle HTTP requests sent to this service. The other crate will be built and included in the current package.
- `plugin`: May be present on any crate that builds a service. The value is a crate that should be built with `cargo component` and uploaded as `/plugin.wasm`
- `flags`: [Flags](../../../specifications/data-formats/package.md#serviceservicejson) for the service.
- `postinstall`: An array of actions to run when the package is installed. May be specified on the top-level crate or on any service. Actions from a single `postinstall` will be run in order. The order of actions from multiple crates is unspecified.
- `data`: An array of `{src, dst}` paths to upload to the service. `src` is relative to the location of Cargo.toml. If `src` is a directory, its contents will be included recursively.
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
# Run the service's init action
postinstall = [{sender="tpack", service="tpack", method="init", rawData="0000"}]
# Upload the UI
data = [{src = "ui/", dst = "/"}]

[package.metadata.psibase.dependencies]
HttpServer = "0.12.0"
```
