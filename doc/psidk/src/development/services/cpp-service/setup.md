# SDK installation for C++

To start building apps in C++, you will need to download and extract [wasi-sdk](https://github.com/WebAssembly/wasi-sdk/releases) and [psidk](https://github.com/gofractally/psibase/releases). wasi-sdk provides clang and other tools and provides the C and C++ runtime libraries built for WASM. psidk provides libraries and tools for working with psibase. The set of additional packages you need varies with Linux distribution; see the sections below.

The environment variable `WASI_SDK_PREFIX` must be set to the root of `wasi-sdk`. For convenience, consider adding it to `~/.bashrc` or whatever is appropriate for the shell you use.

For example
```sh
export WASI_SDK_PREFIX=~/work/wasi-sdk-24.0-x86_64-linux
export PATH=~/work/psidk-ubuntu-2404/bin:$PATH
```

If you're using docker, use the `-p8080:8080` option to expose psibase's http port.

## Ubuntu

```sh
apt-get install cmake binaryen
```

## Fedora

```sh
dnf install cmake binaryen
```
