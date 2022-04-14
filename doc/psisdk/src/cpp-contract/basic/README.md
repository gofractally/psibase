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
cmake `psisdk-cmake-args` ..
make -j $(nproc)
```

## Trying the contract

Even though other contracts may call into our contract's `add` and `multiply` methods,
we haven't provided end users with a way to construct transactions which use them.
That's the topic of the next section, [User Interface](../ui/index.html).

## Homework

There's a potentially-exploitable bug in `add` and `multiply`. What is it? Why is it
more dangerous in C++ than it is in psibase's other contract languages? How can
you avoid it?

## vscode support

The following files configure vscode:
* [.vscode/c_cpp_properties.json](.vscode/c_cpp_properties.json)
* [.vscode/settings.json](.vscode/settings.json)

Code completion and symbol lookup does not work until the project is built (above).
