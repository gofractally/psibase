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

## Toolchain

Using the WASM toolchain with CMake requires setting `CMAKE_TOOLCHAIN_FILE`. The `psidk-cmake-args` programs prints appropriate arguments to its `stdout`.

```sh
cmake . `psidk-cmake-args`
```
