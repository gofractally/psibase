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

We only support developing natively on Ubuntu 20.04 and Ubuntu 22.04. Some of our developers have very strong success with Ubuntu on WSL2, and also with Docker.

To build this repo from source, your environment first needs to be set up. To set up your environment, 

```TODO - LIST DEPENDENCIES, RATHER THAN LINKING TO THE DOCKERFILES.```

You may also reference either the [Ubuntu 20.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2004-builder.Dockerfile) or the [Ubuntu 22.04 dockerfile](https://github.com/gofractally/image-builders/blob/main/docker/ubuntu-2204-builder.Dockerfile) for an example on how an environment could be set up.

Alternatively, if you would prefer to use a containerized development environment (for example to isolate the dependencies, or to develop on operating systems other than Ubuntu 20.04 and Ubuntu 22.04 such as Windows or Mac), see the [Psibase Contributor repository](https://github.com/gofractally/psibase-contributor).

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

To build documentation, add the `-DBUILD_DOC=yes` flag to the `cmake` command. Further instructions on building and hosting documentation can be found in the [documentation section](https://doc-sys.psibase.io/documentation.html) of our demo deployment docs.

### MacOS

Use either an Ubuntu 22.04 VM or a Docker Ubuntu 22.04 container. If your machine is ARM, you must use Rosetta; eos-vm JITs Intel machine code.

Some people have been able to build this directly on MacOS without using Docker or Ubuntu VMs. We struggled to reproduce these successes on other MacOS machines. For now, we don't have the people to answer questions relating to Mac. The error messages are nonsensical. The workarounds unreproducible. Apple mangled several tools and libraries such as libtool and openssl. Brew tries to replace them, but MacOS fights back hard. In some cases Brew is too careful about this and requires magic incantations to use the replacements; these incantations change with Brew's frequent version bumps. Building and running appear to require disabling several MacOS security features. Apple keeps changing the magic incantations to do this. Our existing developers need a multi-year break from even thinking of Mac.

## Support

Some contributors to this repo hang out in [this telegram channel](https://t.me/psibase_developers). That's probably the best place to ask questions and get support.
