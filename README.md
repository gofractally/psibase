# psibase

This repo contains the sources to

- `psinode`, the psibase node
- `psibase`, the command-line utility for pushing transactions and booting a chain
- psibase services
- `psidk`, the service development kit

## About Page, Documentation, and Demo

The [Demonstration Chain](https://psibase.io/) hosts both the [About Page](https://about.psibase.io/) and the [Documentation](https://doc-sys.psibase.io/).

## Binary Release

If you want to operate a node, build services, or explore psibase's command-line utility, we recommend installing a [Binary Release](https://github.com/gofractally/psibase/releases). We provide a single binary package which should run on most recent Linux distributions. See the [installation instructions](https://doc-sys.psibase.io/linux.html).

## Building this repo from source

See the architecture-specific instructions below.

Set the `WASI_SDK_PREFIX` environment variable before building. Alternatively, use cmake's `-DWASI_SDK_PREFIX=....` option. Also make sure `node 16.17`, `npm 8.19`, `yarn 1.22`, `cargo 1.63`, and `wasm-opt` (or later versions) are in your path.

```sh
git submodule update --init --recursive
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/psidk ..
make -j $(nproc)
ctest -j $(nproc)
make install
```

The built product lives in `/opt/psidk`.

To build documentation, use `-DBUILD_DOC=yes`

### Ubuntu 22.04

Note: building on Ubuntu 18.04 or 20.04 requires much more prep work; see [docker/ubuntu-1804-builder.Dockerfile](docker/ubuntu-1804-builder.Dockerfile) or [docker/ubuntu-2004-builder.Dockerfile](docker/ubuntu-2004-builder.Dockerfile) for details.

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
    wget

export WASI_SDK_PREFIX=~/work/wasi-sdk-17.0
export PATH=~/work/node-v16.17.0-linux-x64/bin:~/.cargo/bin:$PATH

cd ~/work
wget https://boostorg.jfrog.io/artifactory/main/release/1.78.0/source/boost_1_78_0.tar.gz
tar xf boost_1_78_0.tar.gz
cd boost_1_78_0
./bootstrap.sh
sudo ./b2 --prefix=/usr/local --build-dir=build variant=release --with-chrono --with-date_time \
     --with-filesystem --with-iostreams --with-log --with-program_options --with-system --with-test install

cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-17/wasi-sdk-17.0-linux.tar.gz
tar xf wasi-sdk-17.0-linux.tar.gz

cd ~/work
wget https://nodejs.org/dist/v16.17.0/node-v16.17.0-linux-x64.tar.xz
tar xf node-v16.17.0-linux-x64.tar.xz
npm i -g npm yarn

cd ~/work
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasi
cargo install mdbook mdbook-linkcheck mdbook-mermaid
```

### Windows

psibase doesn't build or run on Windows natively, but some of our developers have very strong success with Ubuntu on WSL2. Docker and VMs are also good options. Use Ubuntu 22.04 if possible (above); it needs minimal prep work compared to the older releases.

### MacOS

Use either an Ubuntu 22.04 VM or a Docker Ubuntu 22.04 container. If your machine is ARM, you must use Rosetta; eos-vm JITs Intel machine code.

Some people have been able to build this directly on MacOS without using Docker or Ubuntu VMs. We struggled to reproduce these successes on other MacOS machines. For now, we don't have the people to answer questions relating to Mac. The error messages are nonsensical. The workarounds unreproducible. Apple mangled several tools and libraries such as libtool and openssl. Brew tries to replace them, but MacOS fights back hard. In some cases Brew is too careful about this and requires magic incantations to use the replacements; these incantations change with Brew's frequent version bumps. Building and running appear to require disabling several MacOS security features. Apple keeps changing the magic incantations to do this. Our existing developers need a multi-year break from even thinking of Mac.
