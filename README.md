<div align="center">
  <img src="./doc/src/_img/logo-psibase-green.svg" />
  <h1>psibase</h1>
  <p>
    &bull;
    <a href="#overview">Overview</a> &bull;
    <a href="#demo-deployment-%EF%B8%8F">Demo 🖥️</a> &bull;
    <a href="#technical-docs-">Docs 📓</a> &bull;
    <a href="#build-from-source-%EF%B8%8F">Build 🛠️</a> &bull;
    <a href="#running-psibase-infrastructure-">Run 🚀</a> &bull;
    <a href="#contribute-">Contribute 🧬</a> &bull;
    <a href="#support-">Support 📱</a> &bull;
  </p>
</div>

---

## Overview

Psibase is a powerful protocol that enables communities to come together to easily self-host web applications. This repository is an open source implementation of that protocol.
Any psinode deployment comes with some default applications, some of which are mandatory and critical for the infrastructure to function properly, and others are optional sample user applications.

Primary packages included in this repository:

| Package   | Description                                                                   |
| --------- | ----------------------------------------------------------------------------- |
| `psinode` | The psibase infrastructure node                                               |
| `psibase` | Command-line utility for interacting with psinode. Used primarily by scripts. |
| `psidk`   | The SDK used for developing web services                                      |

## Demo deployment 🖥️

A demonstration deployment is currently hosted at [psibase.io](https://psibase.io) to showcase what psibase infrastructure could look like for end users. The applications available on this demo are sample applications and are not intended to be used for a production deployment.

## Technical docs 📓

Documentation is hosted on the [docs app](https://docs.psibase.io/) of our demo deployment.

## Build from source 🛠️

We only officially support developing natively on Ubuntu 22.04 and Ubuntu 24.04, although any Linux distribution may work. If you use a distribution other than Ubuntu 22.04 or 24.04, ensure the versions of the dependencies you install are at least as high as they are in Ubuntu.

Some of our developers have very strong success with Ubuntu on WSL2, and also with Docker.

### Environment setup

> 📦 We maintain containerized development environments to simplify the development process. Developing within a container means the environment will automatically be set up for you. See the [Psibase Contributor](https://github.com/gofractally/psibase-contributor) repository for instructions on how to build from source within a container.

The following is a list of dependencies you are required to install:

| Package        | Minimum Version | Description                                                                                                                                                      |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| autoconf       | 2.69            | A tool for producing configure scripts for building, installing, and packaging software                                                                          |
| binaryen       | 113             | A compiler and toolchain infrastructure library for WebAssembly                                                                                                  |
| boost          | 1.78            | A collection of C++ libraries                                                                                                                                    |
| clang + llvm   | 16              | The LLVM compiler and toolchain for C/C++ and the libraries to interface with it                                                                                 |
| cmake          | 3.22.1          | A build system generator that creates makefiles used for compilation                                                                                             |
| g++            | 11              | A GNU compiler for C++                                                                                                                                           |
| libssl-dev     | 1.1.1           | Development package for OpenSSL, enabling various cryptography and secure network communication                                                                  |
| libtool        | 2.4.6           | Script that simplifies the process of creating and using shared libraries                                                                                        |
| make           | 4.3             | Reads makefiles generated by cmake to build executables from source code                                                                                         |
| node           | 16.17.0         | A JavaScript runtime                                                                                                                                             |
| pkg-config     | 0.29.1          | A helper tool used during compilation to provide correct compiler flags, and to locate and manage library dependencies                                           |
| Rust toolchain | 1.86            | Develop programs in Rust. Use `cargo` to install `cargo-component`, `mdbook`, `mdbook-linkcheck`, `mdbook-mermaid`, `mdbook-pagetoc`, `sccache`, and `wasm-pack` |
| Wasi SDK       | 24.0            | A development toolchain for building WebAssembly programs that target the WebAssembly System Interface (WASI)                                                    |
| yarn           | 4.9.1           | Javascript package manager                                                                                                                                       |
| zstd           | 1.4.4           | Command-line utility that implements the Zstandard file compression algorithm                                                                                    |

Other notes:

- Add the paths to `node`, `npm`, `yarn`, `cargo`, and `wasm-opt` into your PATH environment variable.
- Set the `WASI_SDK_PREFIX` environment variable before building to the root of your llvm installation (e.g. `/usr/lib/llvm-16`). Alternatively, set this variable during the build using the CMake flag `-DWASI_SDK_PREFIX=....`.
- Add the following targets to rust: `wasm32-wasip1`, `wasm32-unknown-unknown`

> 🔍 You can reference either the [Ubuntu 22.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2204-builder.Dockerfile) or the [Ubuntu 24.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2404-builder.Dockerfile) for an example on how an environment could be set up.

### Build

After your environment is set up, then you should be able to use the following build instructions:

```sh
git submodule update --init --recursive
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=psidk ..
make -j $(nproc)
ctest -j $(nproc)
make install
```

The built product lives in `CMAKE_INSTALL_PREFIX` (`$CMAKE_BINARY_DIR/psidk` in the above example).

#### Build flags

The following are some of the common/useful build flags you can use to configure CMake that modify the build. Open the build directory and run `cmake -LH` to view a list of all options.

| Flag                          | Example Values    | Description                                                                                          |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| BUILD_DEBUG_WASM              | `yes`,`no`        | Build debug wasms (Needed for using the debugger)                                                    |
| CMAKE_BUILD_TYPE              | `Debug`,`Release` | Determines level of optimization for the native programs                                             |
| CMAKE_EXPORT_COMPILE_COMMANDS | `yes`,`no`        | Tell CMake to generate compile_commands.json, used by various tools (e.g. clang format intellisense) |
| CMAKE_INSTALL_PREFIX          | `psidk`           | Binary install location.                                                                             |

## Running psibase infrastructure 🚀

> 🔍 We currently do not provide an ARM binary or docker image. If your device uses an ARM chip, you should build psinode (or its [docker image](https://github.com/gofractally/image-builders)) yourself.

To run psinode, you can either build from source as described above, or you can install prebuilt binaries through one of the following two methods:

1. Installing a binary release, the latest of which can be found on our [Releases](https://github.com/gofractally/psibase/releases) page. We provide binary packages for both Ubuntu 22.04 and Ubuntu 24.04.
2. Installing our psinode [Docker Image](https://github.com/orgs/gofractally/packages/container/package/psinode).

To execute psinode from the docker image, you can use the following docker command (make sure to specify the `VERSION` you want to run):

```
docker run --rm -p 8080:8080 -p 3000:3000 -p 9090:9090 ghcr.io/gofractally/psinode:VERSION
```

Run psinode with `--help` to learn about the various options, or consult our technical [docs](https://docs.psibase.io/).

## Contribute 🧬

If you're interested in developing next-generation web application development & deployment infrastructure, welcome aboard! Come hang out in the community [telegram channel](https://t.me/psibase_developers) to learn how best to contribute.

Alternatively, fork the project and do whatever you want with it!

### MacOS 🍏

If you have a Mac (including Apple Silicon), you can use an Ubuntu 22.04 VM or Docker container. We do not host ARM variants of our [docker images](https://github.com/orgs/gofractally/packages?repo_name=image-builders) on our GitHub container registry. Therefore if you would like to use either the `psibase-builder-ubuntu-2204` or `psibase-contributor` on your Apple Silicon Mac, you should pull the [image-builders](https://github.com/gofractally/image-builders) repo and build the images yourself.

## Support 📱

Some contributors to this repo hang out in [this telegram channel](https://t.me/psibase_developers). That's probably the best place to ask questions and get support.
