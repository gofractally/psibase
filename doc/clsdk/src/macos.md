# MacOS Installation (Monterey 12.1)

This installs several dependencies then downloads and extracts both wasi-sdk and Contract Lab. wasi-sdk provides clang and other tools and provides the C and C++ runtime libraries built for WASM. Contract Lab provides libraries and tools for working with eosio.

For convenience, consider adding the environment variables below to `~/.zshrc` or whatever is appropriate for the shell you use.

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

export WASI_SDK_PREFIX=~/work/wasi-sdk-12.0
export CLSDK_PREFIX=~/work/clsdk
export PATH=~/work/node-v14.16.0-linux-x64/bin:$PATH
export CXXFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include
export CFLAGS=-I/usr/local/Cellar/openssl@1.1/1.1.1m/include

// A directory `work`--that can live anyway--will hold a few 3rd party deps
cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-12/wasi-sdk-12.0-macos.tar.gz
tar xf wasi-sdk-12.0-linux.tar.gz

cd ~/work
wget https://github.com/gofractally/contract-lab/releases/download/v1.0.0-rc1/clsdk-macos-20-04.tar.gz
tar xf clsdk-ubuntu-20-04.tar.gz
