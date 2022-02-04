# Contract Lab

Contract Lab (clsdk) is a set of tools and libraries for building, testing, and debugging smart contracts for Mandel. It has the following capabilities:

* Compile contracts for Mandel 3.0, eosio 2.0, and earlier
* Debug contracts using the `debug_plugin`, which comes built in to Contract Lab's `nodeos` executable
* Create deterministic tests using `cltester`, which comes with Contract Lab
* Debug contracts and tests using `cltester`
* Bootstrap test chains using `cltester` and spawn a `nodeos` producer on them
* Fork public chains into test chains

## Documentation

End-user documentation, including how to install the binary packages, is at [https://gofractally.github.io/contract-lab/book/](https://gofractally.github.io/contract-lab/book/).

## Build

Set the `WASI_SDK_PREFIX` environment variable before building (see architecture-specific instructions below). Alternatively, use cmake's `-DWASI_SDK_PREFIX=....` option. Also make sure `nodejs 14`, `npm 6.14`, and `yarn 1.22` are in your path.

```sh
git submodule update --init --recursive
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j $(nproc)
ctest -j $(nproc)
```

The built product lives in `build/clsdk`.

To speed up builds, use `-DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache`

### Ubuntu 20.04

```sh
sudo apt-get update
sudo apt-get install -yq    \
    binaryen                \
    build-essential         \
    cmake                   \
    git                     \
    libboost-all-dev        \
    libcurl4-openssl-dev    \
    libgbm-dev              \
    libgmp-dev              \
    libnss3-dev             \
    libssl-dev              \
    libusb-1.0-0-dev        \
    pkg-config              \
    wget

export WASI_SDK_PREFIX=~/work/wasi-sdk-12.0
export PATH=~/work/node-v14.16.0-linux-x64/bin:$PATH

cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-12/wasi-sdk-12.0-linux.tar.gz
tar xf wasi-sdk-12.0-linux.tar.gz

wget https://nodejs.org/dist/v14.16.0/node-v14.16.0-linux-x64.tar.xz
tar xf node-v14.16.0-linux-x64.tar.xz
npm i -g yarn
```
