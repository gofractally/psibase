# Basic Service (C++)

Here is a basic service definition. Place `example.cpp` and `CMakeLists.txt` in an empty folder.

## `example.cpp`

```cpp
{{#include example.cpp}}
```

## `CMakeLists.txt`

```
{{#include CMakeLists.txt}}
```

## Building

This will create `Example.psi`:

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Deploying the service

This, when run on a local test chain, will:

- Create the `example` account, if it doesn't already exist. The account will be owned by the `root` account.
- Deploy the `example.wasm` service on that service.

```sh
psibase install ./Example.psi
```

## vscode support

Code completion and symbol lookup in VSCode won't work until you add `.vscode/c_cpp_properties.json` and `.vscode/settings.json` to the root of your project. You can check the corresponding `*.sample` files at the root of the [psibase](https://github.com/gofractally/psibase) repository for an example.
