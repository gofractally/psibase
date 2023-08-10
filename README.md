# psibase

This repo contains an implementation of the Psibase protocol. Included in this repo are implementations of the following:

- `psinode`, the psibase node
- `psibase`, the command-line utility for pushing transactions and booting a chain
- psibase system applications 
- psibase example user applications
- `psidk`, the service development kit

## Demo deployment

A demonstration deployment is currently hosted at [psibase.io](https://psibase.io) to showcase what psibase infrastructure could look like for end users. The applications available on this demo are sample applications and are not intended to be used for a production deployment.

## Technical documentation

Documentation is hosted on the [doc-sys applet](https://doc-sys.psibase.io/) of our demo deployment.

## Running psibase

If you want to operate a node, build services, or explore psibase's command-line utility, we recommend one of the following methods:
1. Installing a binary release, the latest of which can be found in our [Rolling Release](https://github.com/gofractally/psibase/releases). We provide binary packages for both Ubuntu 20.04 and Ubuntu 22.04.
2. Installing our psinode [Docker Image](https://github.com/gofractally/psinode-docker-image/pkgs/container/psinode). Our docker image can be used to run psibase on any operating system that supports Docker. Currently we do not build an image for the arm architecture, and therefore the latest [Apple Silicon](https://support.apple.com/en-us/HT211814) based devices are not supported. 


## Building this repo from source

We only officially support developing natively on Ubuntu 20.04 and Ubuntu 22.04, although any Linux distribution may work. If you use a distribution other than Ubuntu 20.04 or 22.04, ensure the versions of the dependencies you install are at least as high as they are in Ubuntu.

Some of our developers have very strong success with Ubuntu on WSL2, and also with Docker.

### Environment setup

> Note: If you would prefer to use a containerized development environment (for example to isolate the dependencies, or to develop on operating systems other than Ubuntu 20.04 and Ubuntu 22.04 such as Windows or Mac), see the [Psibase Contributor](https://github.com/gofractally/psibase-contributor) repository.

Here is a script for Ubuntu 22.04:
 ~TODO~

Add the paths to the following packages (or later versions) into your PATH environment variable:
 * `node 16.17`
 * `npm 8.19`
 * `yarn 1.22`
 * `cargo 1.63`
 * `wasm-opt`

Also set the `WASI_SDK_PREFIX` environment variable before building to the root of your llvm installation (Alternatively, use cmake's `-DWASI_SDK_PREFIX=....` option when building). 

> You may reference either the [Ubuntu 20.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2004-builder.Dockerfile) or the [Ubuntu 22.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2204-builder.Dockerfile) for an example on how an environment could be set up.

### Running a build

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

The documentation for Psibase is part of this repository. To build & view it through a deployed Psibase instance, see the instructions in the [Documentation section](https://doc-sys.psibase.io/documentation.html) of our demo deployment docs.

### MacOS

Although some people have had success building natively on MacOS, we struggled to reproduce this success. Therefore for now, we do not officially support building natively on a MacOS.

If you have a Mac (including the new Apple Silicon M1 or M2 based Macs), you may use either an Ubuntu 22.04 VM or a Docker Ubuntu 22.04 container. We do not host an ARM variants of our [docker images](https://github.com/orgs/gofractally/packages?repo_name=image-builders) on our GitHub container registry. Therefore if you would like to use either the `psibase-builder-ubuntu-2204` or `psibase-contributor` on your Mac, you should pull the [image-builders](https://github.com/gofractally/image-builders) repo and build the images yourself.  

If your machine is ARM, you must use Rosetta; eos-vm JITs Intel machine code.

## Support

Some contributors to this repo hang out in [this telegram channel](https://t.me/psibase_developers). That's probably the best place to ask questions and get support.
