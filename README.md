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
cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_RUST=yes ..
make -j $(nproc)
ctest -j $(nproc)
```

The built product lives in `build/clsdk`.

To speed up builds, use `-DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache`

### Ubuntu 22.04

```sh
sudo apt-get update
sudo apt-get install -yq    \
    autoconf                \
    binaryen                \
    build-essential         \
    ccache                  \
    clang                   \
    cmake                   \
    curl                    \
    git                     \
    libclang-dev            \
    libssl-dev              \
    libtool                 \
    llvm-dev                \
    pkg-config              \
    python-is-python3       \
    wget                    \

export WASI_SDK_PREFIX=~/work/wasi-sdk-14.0
export PATH=~/work/node-v14.16.0-linux-x64/bin:$PATH

cd ~/work
wget https://boostorg.jfrog.io/artifactory/main/release/1.78.0/source/boost_1_78_0.tar.gz
tar xf boost_1_78_0.tar.gz
cd boost_1_78_0
./bootstrap.sh
sudo ./b2 --prefix=/usr/local --build-dir=build variant=release --with-chrono --with-date_time --with-filesystem --with-iostreams --with-program_options --with-system --with-test install

cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz
tar xf wasi-sdk-14.0-linux.tar.gz

cd ~/work
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
cargo install mdbook mdbook-linkcheck
```

### Mac (Monterey 12.1)

```sh
brew install   \
    binaryen   \
    cmake      \
    autoconf   \
    automake   \
    zlib       \
    gdb        \
    git        \
    boost      \
    lightgbm   \
    mpfi       \
    nss        \
    openssl@1.1 \
    pkg-config \
    wget       \
    zstd       \
    coreutils
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

Copy elf.h from the following gist to /usr/local/include/elf.h
https://gist.github.com/mlafeldt/3885346

Make the dev experience suck less on Mac:
`sudo spctl --master-disable`

Debugging support is untested on MacOS.

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
