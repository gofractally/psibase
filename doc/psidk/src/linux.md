# Linux Installation

This downloads and extracts both `wasi-sdk` and `psidk`. wasi-sdk provides clang and other tools and provides the C and C++ runtime libraries built for WASM. psidk provides libraries and tools for working with psibase. The set of additional packages you need varies with Linux distribution; see the sections below.

For convenience, consider adding the environment variables below to `~/.bashrc` or whatever is appropriate for the shell you use.

If you're using docker, use the `-p8080:8080` option to expose psibase's http port.

```sh
export WASI_SDK_PREFIX=~/work/wasi-sdk-14.0
export PSIDK_PREFIX=~/work/psidk
export PATH=$PSIDK_PREFIX/bin:$PATH

mkdir -p ~/work
cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz
tar xf wasi-sdk-14.0-linux.tar.gz

cd ~/work
wget https://github.com/gofractally/psibase/releases/download/pre-0.1.0/psidk-linux.tar.gz
tar xf psidk-linux.tar.gz
```

## Ubuntu 20.04 and 22.04

Run these as root:

```sh
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -yq cmake wget binaryen
```

## Ubuntu 18.04

Run these as root:

```sh
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -yq apt-transport-https ca-certificates gnupg software-properties-common wget
wget -O - https://apt.kitware.com/keys/kitware-archive-latest.asc 2>/dev/null | apt-key add -
apt-add-repository 'deb https://apt.kitware.com/ubuntu/ bionic main'
DEBIAN_FRONTEND=noninteractive apt-get install -yq cmake

cd /usr/local
wget https://github.com/WebAssembly/binaryen/releases/download/version_109/binaryen-version_109-x86_64-linux.tar.gz
tar xf binaryen-version_109-x86_64-linux.tar.gz --strip-components=1
```

## Fedora 36

Run this as root:

```sh
dnf -y install cmake wget binaryen
```
