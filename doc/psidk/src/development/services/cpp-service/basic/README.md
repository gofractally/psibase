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

## Trying the service

Even though other services may call into our service's `add` and `multiply` methods,
we haven't provided end users with a way to construct transactions which use them.
That's the topic of the next section, [Minimal User Interface](../minimal-ui/).

## Homework

There's a potentially-exploitable bug in `add` and `multiply`. What is it? Why is it
more dangerous in C++ than it is in psibase's other service languages? How can
you avoid it?

## vscode support

Code completion and symbol lookup in VSCode won't work until you add `.vscode/c_cpp_properties.json` and `.vscode/settings.json` to the root of your project. You can check the corresponding `*.sample` files at the root of the [psibase](https://github.com/gofractally/psibase) repository for an example.
