# Building Packages

A [psibase package](../../../specifications/data-formats/package.md) may be composed of one or more crates. It can be built by `cargo psibase package` or installed on a running chain with `cargo psibase install`.

`cargo psibase` reads the `[package.metadata.psibase]` section of `Cargo.toml`. At the minimum, `package-name` must be specified.

## Available fields

In the top-level crate:

- `package-name`: Required.
- `services`: A list of services to include in the psibase package.
- `server`: May be present on any crate that builds a service. The value is a crate which will handle HTTP requests sent to this service. The other crate will be built and included in the current package. If HTTP requests are handled in the base service, it should reference the service. Can be omitted if service serves no HTTP requests.
- `plugin`: May be present on any crate that builds a service. The value is a crate that should be built with `cargo component` and uploaded as `/plugin.wasm`
- `flags`: [Flags](../../../specifications/data-formats/package.md#serviceservicejson) for the service.
- `postinstall`: An array of actions to run when the package is installed. May be specified on the top-level crate or on any service. Actions from a single `postinstall` will be run in order. The order of actions from multiple crates is unspecified.
- `data`: An array of `{src, dst}` paths to upload to the service's subdomain. `src` is relative to the location of Cargo.toml. If `src` is a directory, its contents will be included recursively.
- `dependencies`: Additional packages, not build by cargo, that the package depends on. May be specified on the top-level crate or on any service.

In any crate that builds a service:

- `server`: The value is a crate which will handle HTTP requests sent to this service. The other crate will be built and included in the current package. If HTTP requests are handled in the base service, it should reference the service. Can be omitted if service serves no HTTP requests.
- `plugin`: The value is a crate that should be built with `cargo component` and uploaded as `/plugin.wasm`
- `flags`: [Flags](../../../specifications/data-formats/package.md#serviceservicejson) for the service.
- `data`: An array of `{src, dst}` paths to upload to the service's subdomain. `src` is relative to the location of Cargo.toml. If `src` is a directory, its contents will be included recursively.

In top-level crate or any crate that builds a service:

- `postinstall`: An array of actions to run when the package is installed. Actions from a single `postinstall` will be run in order. The order of actions from multiple crates is unspecified.
- `dependencies`: Additional packages, not build by cargo, that the package depends on.

## Example

./Cargo.toml

```toml
[package]
name = "example"
version = "0.1.0"
description = "An example package"

[package.metadata.psibase]
# (required) Builds example.psi
package-name = "example"
# Most services besides the core system services don't need extra flags.
flags = []
# This service handles its own HTTP requests
server = "example"
# Plugin for the front end
plugin = "example-plugin"
# Run the service's init action; "0000" represents <no args> from the Facpack perspective
postinstall = [{sender="tpack", service="tpack", method="init", rawData="0000"}]
# Upload the UI
data = [{src = "ui/", dst = "/"}]

[package.metadata.psibase.dependencies]
HttpServer = "0.13.0"
```

./service/Cargo.toml

```toml
[package]
name = "service1"
version = "0.1.0"
description = "A service to be included in the package"

[package.metadata.psibase]
# Most services besides the core system services don't need extra flags.
flags = []
# This service handles its own HTTP requests
server = "service1"
# Plugin for the front end
plugin = "service1-plugin"
# Upload the UI
data = [{src = "../ui/dist", dst = "/"}]
# Run the service's init action; "0000" represents <no args> from the Fracpack perspective.
postinstall = [{sender="service1", service="service1", method="init", rawData="0000"}]
```
