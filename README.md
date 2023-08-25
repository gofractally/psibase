<div align="center">
  <img src="https://about.psibase.io/assets/logo-psibase-green.0714b8ee.svg" />
</div>
<h1 align="center">
  psibase
</h1>

## What is psibase

Psibase an infrastructure protocol that can be used for full-stack Web3 application development and deployment. It aims to improve data integrity, user privacy and security, application efficiency and composability, and user and developer experience wherever it is deployed.

Notable features:
* Custom blockchain backend with simple node configuration graphical UI
* Custom high-performance underlying database technology: Triedent
* Flexible GraphQL data query support
* Innovative validator selection mechanism
* Decentralized user-interfaces
* C++ & Rust support for writing web services
* Nodes serve state over GraphQL 

Check out our [docs](https://doc-sys.psibase.io/) to learn more.

This repo contains an open source software implementation of the Psibase protocol. Included in this repo are implementations of the following:

- `psinode`, the psibase node
- `psibase`, the command-line utility for pushing transactions and booting a chain
- psibase system applications 
- psibase example user applications
- `psidk`, the service development kit

-------

<p align="center">
    &bull;
    <a href="#demo-deployment-%EF%B8%8F">Demo 🖥️</a> &bull;
    <a href="#technical-docs-">Technical docs 📓</a> &bull;
    <a href="#running-psibase-">Running psibase 🚀</a> &bull;
    <a href="#build-from-source-%EF%B8%8F">Build from source 🛠️</a> &bull;
    <a href="#contribute-">Contribute 🧬</a> &bull;
    <a href="#support-">Support 📱</a> &bull;
</p>

-------

## Demo deployment 🖥️

A demonstration deployment is currently hosted at [psibase.io](https://psibase.io) to showcase what psibase infrastructure could look like for end users. The applications available on this demo are sample applications and are not intended to be used for a production deployment.

## Technical docs 📓

Documentation is hosted on the [doc-sys applet](https://doc-sys.psibase.io/) of our demo deployment.

## Running psibase 🚀

If you want to operate a node, build services, or explore psibase's command-line utility, we recommend one of the following methods:
1. Installing a binary release, the latest of which can be found on our [Releases](https://github.com/gofractally/psibase/releases) page. We provide binary packages for both Ubuntu 20.04 and Ubuntu 22.04.
2. Installing our psinode [Docker Image](https://github.com/gofractally/psinode-docker-image/pkgs/container/psinode). Our docker image can be used to run psibase on any operating system that supports Docker. Currently we do not automatically build an image for the arm architecture. However, we have successfully manually built and run Psibase on the latest [Apple Silicon](https://support.apple.com/en-us/HT211814) based devices. 


## Build from source 🛠️

We only officially support developing natively on Ubuntu 20.04 and Ubuntu 22.04, although any Linux distribution may work. If you use a distribution other than Ubuntu 20.04 or 22.04, ensure the versions of the dependencies you install are at least as high as they are in Ubuntu.

Some of our developers have very strong success with Ubuntu on WSL2, and also with Docker.

### Environment setup

> 📦 We maintain containerized development environments to simplify the development process. Developing within a container means the environment will automatically be set up for you. See the [Psibase Contributor](https://github.com/gofractally/psibase-contributor) repository for instructions on how to build from source within a container.

The following is a list of dependencies you are required to install:

| Package                    | Minimum Version | Description                                                                                                                         |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| autoconf                   | 2.69            | A tool for producing configure scripts for building, installing, and packaging software                                             |
| binaryen                   | 113             | A compiler and toolchain infrastructure library for WebAssembly                                                                     |
| boost                      | 1.78            | A collection of C++ libraries                                                                                                       |
| clang + llvm               | 16              | The LLVM compiler and toolchain for C/C++ and the libraries to interface with it                                                    |
| cmake                      | 3.16.3          | A build system generator that creates makefiles used for compilation                                                                |
| g++                        | 11              | A GNU compiler for C++                                                                                                              |
| libssl-dev                 | 1.1.1           | Development package for OpenSSL, enabling various cryptography and secure network communication                                     |
| libtool                    | 2.4.6           | Script that simplifies the process of creating and using shared libraries                                                           |
| make                       | 4.3             | Reads makefiles generated by cmake to build executables from source code                                                            |
| node                       | 16.17.0         | A JavaScript runtime                                                                                                                |
| pkg-config                 | 0.29.1          | A helper tool used during compilation to provide correct compiler flags, and to locate and manage library dependencies              |
| Rust toolchain             | 1.63            | Develop programs in Rust.<br>Use `cargo` to install `mdbook`, `mdbook-linkcheck`, `mdbook-mermaid`, and `sccache`                   |
| Wasi SDK                   | 20.0            | A development toolchain for building WebAssembly programs that target the WebAssembly System Interface (WASI)                       |
| zstd                       | 1.4.4           | Command-line utility that implements the Zstandard file compression algorithm                                                       |

Other notes:
* Add the paths to `node`, `npm`, `yarn`, `cargo`, and `wasm-opt` into your PATH environment variable.
* Set the `WASI_SDK_PREFIX` environment variable before building to the root of your llvm installation (e.g. `/usr/lib/llvm-16`). Alternatively, set this variable during the build using the CMake flag `-DWASI_SDK_PREFIX=....`.
* Add the wasm32-wasi target to rust.

> 🔍 You may reference either the [Ubuntu 20.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2004-builder.Dockerfile) or the [Ubuntu 22.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2204-builder.Dockerfile) for an example on how an environment could be set up.

### Build

After your environment is set up, then you should be able to use the following build instructions:

```sh
git submodule update --init --recursive
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/psidk ..
make -j $(nproc)
ctest -j $(nproc)
make install
```

The built product lives in `/opt/psidk/`.

The documentation for Psibase is part of this repository. To build & view it through the doc-sys applet of a deployed Psibase instance, see the instructions in [our docs](https://doc-sys.psibase.io/documentation.html).

## Contribute 🧬

If you're interested in developing next-generation web application development & deployment infrastructure, welcome aboard! Come hang out in the community [telegram channel](https://t.me/psibase_developers) to learn how best to contribute.

Alternatively, fork the project and do whatever you want with it!

### MacOS 🍏

If you have a Mac (including Apple Silicon), you may use an Ubuntu 22.04 VM or Docker Ubuntu 22.04 container. We do not host ARM variants of our [docker images](https://github.com/orgs/gofractally/packages?repo_name=image-builders) on our GitHub container registry. Therefore if you would like to use either the `psibase-builder-ubuntu-2204` or `psibase-contributor` on your ARM-based Mac, you should pull the [image-builders](https://github.com/gofractally/image-builders) repo and build the images yourself.

## Support 📱

Some contributors to this repo hang out in [this telegram channel](https://t.me/psibase_developers). That's probably the best place to ask questions and get support.
