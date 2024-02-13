#! /bin/bash

root_dir="/root/psibase/services/user/CommonSys"
account_name="common-sys"
rust_name="common-sys"

cd $root_dir

cd ./common-lib/packages/wasm-loader
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r $account_name ./dist /common/wasm-loader -S $account_name
