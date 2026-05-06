
# Building psibase on macOS (Apple Silicon)

These instructions are for building psibase natively on macOS with Apple Silicon (M-series) chips.

## Prerequisites

### 1. Install Homebrew packages

```sh
brew install binaryen pkg-config autoconf libtool node@22 make
```

> **Note:** macOS ships with GNU Make 3.81 which is too old. The `make` formula installs a modern version as `gmake`.

### 2. Install Rust

If you already have Rust installed via Homebrew, uninstall it first. Install via rustup:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Add the required wasm targets:

```sh
rustup target add wasm32-wasip1 wasm32-unknown-unknown
```

Install required cargo tools:

```sh
cargo install cargo-component sccache wasm-pack
```

### 3. Install mdbook and plugins (for documentation)

These exact versions are required:

```sh
cargo install mdbook@0.4.52 mdbook-linkcheck@0.7.7 mdbook-mermaid@0.16.2 mdbook-pagetoc@0.2.2 mdbook-tabs@0.2.3
```

### 4. Install yarn via corepack

```sh
npm install -g corepack
corepack enable
```

Yarn 4.x is managed automatically via corepack when run from the `packages/` directory.

### 5. Set up PATH

Add the following to your `~/.zshrc`:

```sh
export PATH="/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/opt/node@22/bin:$PATH"
```

Then reload your shell:

```sh
source ~/.zshrc
```

## Build

```sh
git submodule update --init --recursive
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=psidk ..
make -j $(sysctl -n hw.ncpu)
make install
```

> **Note:** The WASI SDK and ICU library paths are auto-detected on macOS. No need to set `WASI_SDK_PREFIX` or `ICU_LIBRARY_DIR` manually.

## Run

```sh
mkdir -p /tmp/psinode-data
./psidk/bin/psinode /tmp/psinode-data -l 127.0.0.1:8080 -p prod
```

Then visit `http://x-admin.psibase.localhost:8080` for node setup.

Run `psinode --help` for all options.
