#! /bin/bash

root_dir="/root/psibase/services/user/CommonApi"
account_name="common-api"
rust_name="common-api"

cd $root_dir

cd ./common/packages/wasm-loader
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r $account_name ./dist /common/wasm-loader -S $account_name
