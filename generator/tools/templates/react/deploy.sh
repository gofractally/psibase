#!/bin/bash

read -p 'Account name: ' accname
read -sp 'Private key: ' privkey
echo
echo Deploying __contract__Service to account $accname ...

psibase -s $privkey upload-tree -S $accname $accname / dist/