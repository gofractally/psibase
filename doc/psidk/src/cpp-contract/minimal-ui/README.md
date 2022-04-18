# Minimal User Interface

psidk can provide a minimal UI to your contracts. This UI can help get you started developing your own contracts, but isn't suitable for end users.

Here is the contract definition. Place `example.cpp` and `CMakeLists.txt` in an empty folder.

## `example.cpp`

```cpp
{{#include example.cpp}}
```

## CMakeLists.txt

[CMakeLists.txt](CMakeLists.txt) is the same as the one in [Basic Contract](../basic/index.html).

## Building

This will create `example.wasm`:

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Installing the contract

The `--register-ui` option registers the contract with the `proxy-sys` contract. This allows the contract to:

- Optionally serve files via HTTP
- Optionally respond to RPC requests
- Optionally respond to GraphQL requests

`proxy-sys` calls into the contract's `serveSys` action. See [Calling Other Contracts](../calling/index.html) to see how contracts do this.

```sh
psibase install --register-ui example example.wasm
```

## Trying the contract

If you're running a test chain locally, then it will typically be at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/). If this is the case, then prefix the domain with the contract name: [http://example.psibase.127.0.0.1.sslip.io:8080/](http://example.psibase.127.0.0.1.sslip.io:8080/).

## Sys suffix

There are 2 common suffixes used by psibase contracts:

- Trusted system contracts have account names which end with `-sys`. Only chain operators may create accounts with this suffix.
- psibase standard action names end with `Sys` or `_Sys` (case insensitive); `serveSys` is one of these actions. You should avoid this suffix when defining your own actions if they're not implementing one of the [existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your contract may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.
