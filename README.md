# Contract Lab

## Build

Set the `WASI_SDK_PREFIX` environment variable before building (see architecture-specific instructions below). Alternatively, use cmake's `-DWASI_SDK_PREFIX=....` option. Also make sure `nodejs 14`, `npm 6.14`, and `yarn 1.22` are in your path.

```sh
git submodule update --init --recursive
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j
ctest -j
```

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

### Mac (Monterey 12.1)

```sh
brew install   \
    binaryen   \
    cmake      \
    gdb        \
    git        \
    boost      \
    lightgbm   \
    mpfi       \
    nss        \
    openssl@1.1 \
    pkg-config \
    wget       \
    zstd
```

```sh
export PATH=/usr/local/opt/gnu-sed/libexec/gnubin:$PATH
export OPENSSL_ROOT_DIR=/usr/local/Cellar/openssl@1.1/1.1.1m
export PKG_CONFIG_PATH=/usr/local/opt/openssl@1.1/lib/pkgconfig
export WASI_SDK_PREFIX=~/work/wasi-sdk-12.0
export CXXFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include
export CFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include
```

NOTE: If you have openssl trouble, see if `brew search openssl` lists a version other than 1.1. In particular, if v3 is listed, you'll likely need to `brew uninstall openssl@3`.

```sh
# A directory `work`--that can live anywhere--will hold a few 3rd party deps
cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-12/wasi-sdk-12.0-macos.tar.gz
tar xf wasi-sdk-12.0-macos.tar.gz

cd ~/work
wget https://github.com/gofractally/contract-lab/releases/download/v1.0.0-rc1/clsdk-macos.tar.gz
tar xf clsdk-macos.tar.gz
```

#### Prepping to build

Install gnu sed
https://gist.github.com/andre3k1/e3a1a7133fded5de5a9ee99c87c6fa0d

Make the dev experience suck less on Mac:
`sudo spctl --master-disable`

#### Notes on `cmake` and `ctest` on MacOS

To provide `libcrypto` (if installed from brew), include the following `export` for `dkg-package` (brew will tell you this when you install `dkg-package`) [[ref]](https://stackoverflow.com/questions/60925326/issue-no-package-libcrypto-found)

```
export PKG_CONFIG_PATH="/usr/local/opt/openssl@1.1/lib/pkgconfig"
```

Run `cmake` with this arg:
`-DOPENSSL_ROOT_DIR=/usr/local/Cellar/openssl@1.1/1.1.1m`

When running `make` or `ctest`, instead of linux's `$(nproc)`, use `$(sysctl -n hw.logicalcpu)`.

```
make -j $(sysctl -n hw.logicalcpu)
```
