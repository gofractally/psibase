# Linux Installation

This installs several dependencies then downloads and extracts both wasi-sdk and psidk. wasi-sdk provides clang and other tools and provides the C and C++ runtime libraries built for WASM. psidk provides libraries and tools for working with psibase. The `apt-get` portions are for `Ubuntu 20.04`; the set of packages you need to install varies with Linux distribution.

For convenience, consider adding the environment variables below to `~/.bashrc` or whatever is appropriate for the shell you use.

If you're using docker, see instructions below and use the `-p8080:8080` option to expose psibase's http port.

```sh
apt-get update
apt-get install -yq cmake wget

export WASI_SDK_PREFIX=~/work/wasi-sdk-14.0
export PSIDK_PREFIX=~/work/psidk
export PATH=$PSIDK_PREFIX/bin:$PATH

mkdir -p ~/work
cd ~/work
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz
tar xf wasi-sdk-14.0-linux.tar.gz

cd ~/work
wget ...../path/to/psidk-linux.tar.gz    # TODO
tar xf psidk-linux.tar.gz
```

# Setup and Boot in docker

1. Before starting, download a recent version of `psidk-linux` from the Artifacts section of a recent build:
   https://github.com/gofractally/psibase/actions/workflows/ubuntu-2004.yml
   and save that file to the same folder as this Dockerfile.

2. Build the docker image:
   `docker build -t psi .`

3. Start the container and the chain
   3.1 Run the container in interactive mode to boot and start the chain
   `docker run --name psi -it -p 8080:8080 psi`
   3.2 In the container, start the chain
   `psinode -p -o psibase.127.0.0.1.sslip.io my_psinode_db`
   3.3 In a separate terminal window, exec into the container and boot the chain
   `docker exec -it psi /bin/bash`
   `psibase boot`

4. Access the contract web interface via the host machine at http://psibase.127.0.0.1.sslip.io:8080
   Specifically, you can create an account at http://account-sys.psibase.127.0.0.1.sslip.io:8080/

```FROM ubuntu:20.04

RUN apt-get update
RUN apt-get install -yq cmake wget
RUN apt-get install unzip

RUN mkdir -p /root/work
WORKDIR /root/work
RUN wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz
RUN tar xf wasi-sdk-14.0-linux.tar.gz
ENV WASI_SDK_PREFIX=~/work/wasi-sdk-14.0

### This step can be replace by the COPY command below (plus the download of the .zip file in the instructions above
# RUN cd /root/work
# wget ...../path/to/psidk-linux.tar.gz    # TODO

### Then rerun this file with the next 3 lines uncommented
COPY ./psidk-linux.zip /root/work/
RUN unzip /root/work/psidk-linux.zip
RUN tar xf psidk-linux.tar.gz
ENV PSIDK_PREFIX=~/work/psidk
ENV PATH=$PSIDK_PREFIX/bin:$PATH
```
