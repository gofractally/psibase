# ƒractally Toolbox

Frontend apps and components by and for ƒractally.

This is a working name and is subject to change.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

**Table of contents**

-   [Setup](#setup)
-   [Running ƒractally webapp locally](#running-%C6%92ractally-webapp-locally)
    -   [dev](#dev)
    -   [bundle and start (prod)](#bundle-and-start-prod)
-   [Running toolbox webapp locally](#running-toolbox-webapp-locally)
    -   [dev](#dev-1)
    -   [bundle and start (prod)](#bundle-and-start-prod-1)
-   [Running Storybook component library](#running-storybook-component-library)
-   [Misc. commands](#misc-commands)
-   [Repo structure](#repo-structure)
    -   [Apps](#apps)
    -   [Publishable packages](#publishable-packages)
-   [Talking to the chain](#talking-to-the-chain)
    -   [Set up and boot a local chain in Docker](#set-up-and-boot-a-local-chain-in-docker)
    -   [Dockerfile](#dockerfile)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Setup

This repo uses [pnpm](https://pnpm.io/)

```sh
# Install pnpm with your preferred method: https://pnpm.io/installation.
npm i -g pnpm

# Install all dependencies.
pnpm i

# Build packages so they're properly linked.
pnpm build
```

## Running ƒractally webapp locally

### dev

Note on HTTPS: if you don't need https, you can dev locally with the simple instructions immediately following. If, however, you need https (e.g., for WebRTC), jump to the Setting Up Secure Local Dev section and enable https local dev first.

From within the `apps/fractally` directory:

```sh
# this will spin up the required apps to run
cd apps/fractally
pnpm dev

# then just go to the local website
open http://localhost:3000
```

### bundle and start (prod)

```sh
# Build
pnpm build:fractally

# Start (runs `vite preview`)
pnpm start
```

## Running toolbox webapp locally

### dev

```sh
# this will spin up the required apps to run
cd apps/toolbox
pnpm dev

# then just go to the local website
open http://localhost:3000
```

### bundle and start (prod)

```sh
# Build
pnpm build:toolbox

# Start (runs `vite preview`)
pnpm start
```

## Running Storybook component library

```sh
cd packages/components
pnpm storybook
```

## Misc. commands

```sh
# to generate this file table of contents (TOC)
pnpm doctoc
```

## Repo structure

### Apps

Contains all the Fractally applications such as the core server, nextjs web app and electron app.

### Publishable packages

The [`packages`](packages) folder contains examples of packages you would usually end up publishing to `npm`. Therefore, the configs and build process are tailored to producing publishable artifacts that will depend on other packages from the monorepo.

# Talking to the chain

## Set up and boot a local chain in Docker

The docker setup below will allow you to spin up a psibase chain locally and use the contract-sourced web interface to create an account.
To see the JS code that actually packs a transaction, see this file directly in github:
https://github.com/gofractally/psibase/blob/main/contracts/user/common_sys/common/rpc.mjs

1. Save the Dockerfile contents below to a folder.

2. Download a recent version of `psidk-linux` from the Artifacts section of a recent build:
   https://github.com/gofractally/psibase/actions/workflows/ubuntu-2004.yml
   and save that file to the same folder as the Dockerfile.

3. Build the docker image:
   `docker build -t psi .`

4. Start the container and the chain:

    1. Run the container in interactive mode to boot and start the chain: `docker run --name psi -it -p 8080:8080 psi`
    2. In the container, start the chain: `psinode -p -o psibase.127.0.0.1.sslip.io my_psinode_db`
    3. In a separate terminal window, exec into the container and boot the chain:

        1. `docker exec -it psi /bin/bash`
        2. `psibase boot`

5. Access the contract web interface via the host machine at http://psibase.127.0.0.1.sslip.io:8080. Specifically, you can create an account at http://account-sys.psibase.127.0.0.1.sslip.io:8080/

## Dockerfile

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

## Setting Up Secure Local Dev

The system requires https for numerous reasons, e.g., WebRTC. Following are the instructions for setting up ssl certs so you can dev locally with https.
Notes:

-   These instructions assume you're developing locally with the Psidekick docker extension that runs psibase.
-   These instructions will need to be repeated each time the Psidekick docker extension is updated, as it completely wipes its footprint from your system and then updates.

-   The repo is configured for http by default (to avoid CI/CD issues), start by setting the `VITE_SECURE_LOCAL_DEV` .env flag to `true`.
-   Install `mkcert` locally
    -   on MacOS: `brew install mkcert nss`
    -   on Linux:
        -   `apt-get update; apt install libnss3-tools -y`
        -   `wget [https://github.com/FiloSottile/mkcert/releases/download/v1.4.3/mkcert-v1.4.3-linux-amd64](https://github.com/FiloSottile/mkcert/releases/download/v1.4.3/mkcert-v1.4.3-linux-amd64)`
        -   `sudo cp mkcert-v1.4.3-linux-amd64 /usr/local/bin/mkcert`
        -   `sudo chmod +x /usr/local/bin/mkcert`
    -   Some references to help
        -   [https://web.dev/how-to-use-local-https/](https://web.dev/how-to-use-local-https/)
        -   [https://dev.to/rhymes/really-easy-way-to-use-https-on-localhost-341m](https://dev.to/rhymes/really-easy-way-to-use-https-on-localhost-341m)
        -   [https://kifarunix.com/create-locally-trusted-ssl-certificates-with-mkcert-on-ubuntu-20-04/](https://kifarunix.com/create-locally-trusted-ssl-certificates-with-mkcert-on-ubuntu-20-04/)
-   Install `mkcert` as the local Certificate Authority
    -   `mkcert -install`
-   Generate the cert and key, which will be deposited in the current directory. Drop them where vite expects them, i.e. at the root of the `apps/fractally` folder (where the vite.config.ts is).
    -   `mkcert psibase.127.0.0.1.sslip.io '*.psibase.127.0.0.1.sslip.io'`
    -   Use the default names, which should match the .pem file names below. Vite is expecting these names in this specific location.
-   Copy the .pem files into the psidekick container
    -   `docker container ls` — to get the container id
    -   `docker cp <path to .pem file> <container id>:/` — copy the .pem files into the container
-   Configure the psinode to use the pem cert and key
    -   Get a commandline in the container: `docker exec -it <container id> /bin/bash`
    -   `vi /etc/supervisor/conf.d/supervisord.conf` — to modify how psinode is started
        -   In the `[program:psinode]` section, replace `command=psinode...` add the following to the end of that command `--tls-cert /psibase.127.0.0.1.sslip.io+1.pem --tls-key /psibase.127.0.0.1.sslip.io+1-key.pem` and modify/add the `-l` param as follows `-l https://0.0.0.0:8080 -l http://0.0.0.0:8079` (note http vs https and differing port numbers) so it looks like the example below. NOTE: the 8079 port is not exposed to the host; it is just what we’ll use to boot the chain. Whereas we’ll use the existing 8080 forwarded port to enable https access.
            -   Example: `command=psinode -o psibase.127.0.0.1.sslip.io psinode_db -l https://0.0.0.0:8080 -l http://0.0.0.0:8079 --producer firstproducer --tls-cert /psibase.127.0.0.1.sslip.io+1.pem --tls-key /psibase.127.0.0.1.sslip.io+1-key.pem`
        -   In the `[program:psibase]` section, add the following immediately after `command=psibase`: `-a http://psibase.127.0.0.1.sslip.io:8079/` so it looks something like below. This tells `psibase` to talk to `psinode` via the http url (since it can’t talk to `psinode` via the https url, due to psinode’s inability to verify the identity of the psibase process). This is only needed for the boot process.
            -   Example: `command=psibase -a http://psibase.127.0.0.1.sslip.io:8079/ boot -p firstproducer --no-doc`
        -   Save and close
-   Restart psinode (still in the container)
    -   Load the updated conf file and restart psinode: `supervisorctl reread; supervisorctl restart psi:psinode`
    -   Confirm the chain is producing blocks by running `psinode-logs`.
-   Finally, verify you can access the chain via `[https://psibase.127.0.0.1.sslip.io:8080](https://psibase.127.0.0.1.sslip.io:8080)` (if it appears to not work, try an incognito window; sometimes a cached page can make it look like the configuration didn’t work. And if that doesn’t work, try a host system reboot; that’s worked at least once. :)

Ok, so now the chain will serve you over https, but for frontend dev, you’ll also need the proxy to server https, which is already configured in the vite config.

## Imports order

For JS imports, each type of import is separated by an **empty line**.

-   Libraries
-   Absolute
-   Relative
-   Code

E.g.

```ts
import { useParams } from "react-router-dom";

import Logo from "assets/logo.svg";

import { Text } from "@toolbox/components/ui";
import { useNavDrawer, useUser } from "hooks";

import NavLinkItem from "./nav-link-item";

const isReadingMoreEqualAnimals = true;
```
