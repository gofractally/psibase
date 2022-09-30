#!/bin/bash

mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)

read -p 'Account name: ' accname
read -sp 'Private key: ' privkey
echo
echo Deploying __contract__Service to account $accname ...

psibase -s $privkey deploy -p $accname __contract__.wasm