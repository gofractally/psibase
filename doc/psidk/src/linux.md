# Linux Installation

This installs several dependencies then downloads and extracts both wasi-sdk and psidk. wasi-sdk provides clang and other tools and provides the C and C++ runtime libraries built for WASM. psidk provides libraries and tools for working with psibase. The `apt-get` portions are for `Ubuntu 20.04`; the set of packages you need to install varies with Linux distribution.

For convenience, consider adding the environment variables below to `~/.bashrc` or whatever is appropriate for the shell you use.

If you're using docker, use the `-p8080:8080` option to expose psibase's http port.

```sh
apt-get update
apt-get install -yq cmake wget

export WASI_SDK_PREFIX=~/work/wasi-sdk-14.0
export PSIDK_PREFIX=~/work/psidk
export PATH=$PSIDK_PREFIX/bin:$PATH

mkdir -p ~/work
cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz
tar xf wasi-sdk-14.0-linux.tar.gz

cd ~/work
wget ...../path/to/psidk-linux.tar.gz    # TODO
tar xf psidk-linux.tar.gz
```
