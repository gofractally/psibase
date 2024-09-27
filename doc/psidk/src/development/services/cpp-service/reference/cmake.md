# CMake Support

```
find_package(psibase)
```

## Targets

The `psibase` package provides the following imported library targets

- `Psibase::service`
- `Psibase::test`

Target variants:
- `Psibase::service-simple-malloc`
- `Psibase::service-full-malloc`

`service-simple-malloc` will not free memory until the transaction finishes. `service-full-malloc` uses the default malloc implementation. The `Psibase::service` target is an alias for `Psibase::service-simple-malloc`.

## Packages

The `psibase_package` command builds an [app package](../../../../specifications/data-formats/package.md).

```cmake
psibase_package(NAME <name> VERSION <version> [DESCRIPTION <text>]
                [OUTPUT <filename>] [ACCOUNTS <name>...] [DEPENDS <targets>...]
                [PACKAGE_DEPENDS <package>...] [POSTINSTALL <filename>]
                [SERVICE <name> [TARGET <target> | WASM <filename>]
                 [FLAGS <flags...>] [SERVER <name>] [DATA <path> <dest>]
                 [DATA GLOB <path>... <dest>] [INIT]]...)
```

### NAME

The name of the package

### VERSION

The package version. Must conform to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

### DESCRIPTION

The package description

### OUTPUT

The package file to be created. [Default: &lt;NAME&gt;.psi]

### ACCOUNTS

Additional non-service accounts to create

### DEPENDS

Other CMake targets that the package depends on. This is a build-time dependency. For dependencies that affect package installation, use `PACKAGE_DEPENDS`, instead.

### PACKAGE_DEPENDS

Other packages that this package depends on. This dependency is recorded in the package and is processed by the package manager. For build-time dependencies use `DEPENDS` instead. The dependency may include a [version expression](../../../../specifications/data-formats/package.md#semantic-version-matching) wrapped in parenthesis, e.g. `foo(^2.1.3)`. If a version is not provided, any version will match.

### POSTINSTALL

This is a json file that contains an array of Actions that will be executed after the service is deployed.

### SERVICE

The name of a service account. Other options that follow are associated with this service.

#### TARGET

The name of an executable target that builds the wasm to be deployed on this account. If the wasm file is built by an external project or other custom target use `WASM` and `DEPENDS` instead.

#### WASM

A .wasm file that will be deployed on this service. If the .wasm file is a product of `add_executable`, use `TARGET` instead.

#### FLAGS

Flags that will be applied to the account.

#### SERVER

Another account that will serve content for this account.

#### DATA &lt;path&gt; &lt;dest&gt;

Adds web content that will be installed to the service's subdomain. If path is a directory it will be added recursively.

```
DATA index.html /index.html
DATA dist /
```

#### DATA GLOB &lt;path&gt;... &lt;dir&gt;

Adds web content that will be installed to the service's namespace within the the `sites` app, accessible from the service's subdomain. Globs in the source paths will be processed and all matching files will be copied into the destination directory.

```
DATA GLOB dist/*.html /
```

#### INIT

This service has an `init` action that should be called with no arguments in the package's postinstall script.

## Toolchain

Using the WASM toolchain with CMake requires setting `CMAKE_TOOLCHAIN_FILE`. The `psidk-cmake-args` programs prints appropriate arguments to its `stdout`.

```sh
cmake . `psidk-cmake-args`
```
