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

```brew install   \
    binaryen   \
    cmake      \
    gdb        \
    git        \
    boost      \
    lightgbm   \ --> mpfi
    nss        \
    openssl    \
    pkg-config \
    wget       \
    zstd
```

// The following assumes a directory `work` that can lives anyway and will hold a few 3rd party deps

cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-12/wasi-sdk-12.0-macos.tar.gz
tar xf wasi-sdk-12.0-linux.tar.gz

export WASI_SDK_PREFIX=~/work/wasi-sdk-12.0
export PATH=~/work/node-v14.16.0-linux-x64/bin:$PATH
export CXXFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include
export CFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include

Run `cmake` with this:
-DOPENSSL_ROOT_DIR=/usr/local/Cellar/openssl@1.1/1.1.1m

Make the dev experience suck less on Mac:
`sudo spctl --master-disable`

Install gnu sed
https://gist.github.com/andre3k1/e3a1a7133fded5de5a9ee99c87c6fa0d

To provide `libcrypto` (if installed from brew), you have to include an `export` command for `dkg-package`
`export PKG_CONFIG_PATH="/usr/local/opt/openssl@1.1/lib/pkgconfig"`
Ref: https://stackoverflow.com/questions/60925326/issue-no-package-libcrypto-found

When running `make` or `ctest`, instead of `$(nproc)`, use `$(sysctl -n hw.logicalcpu)`.
