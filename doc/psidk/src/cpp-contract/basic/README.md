# Basic Contract

Here is a basic contract definition. Place `example.cpp` and `CMakeLists.txt` in an empty folder.

## `example.cpp`

```cpp
{{#include example.cpp}}
```

## `CMakeLists.txt`

```
{{#include CMakeLists.txt}}
```

## Building

This will create `example.wasm`:

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Installing the contract

This, when run on a local test chain, will:

- Create the `example` account, if it doesn't already exist. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public chains. `-i` is a shortcut for `--create-insecure-account`.
- Install the `example.wasm` contract on that contract.

```sh
psibase install -i example example.wasm
```

## Trying the contract

Even though other contracts may call into our contract's `add` and `multiply` methods,
we haven't provided end users with a way to construct transactions which use them.
That's the topic of the next section, [Minimal User Interface](../minimal-ui/index.html).

## Homework

There's a potentially-exploitable bug in `add` and `multiply`. What is it? Why is it
more dangerous in C++ than it is in psibase's other contract languages? How can
you avoid it?

## vscode support

The following files configure vscode:

- [.vscode/c_cpp_properties.json](.vscode/c_cpp_properties.json)
- [.vscode/settings.json](.vscode/settings.json)

Code completion and symbol lookup does not work until the project is built (above).
