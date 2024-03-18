#! /bin/bash

root_dir="/root/psibase/services/user/SymbolSys"
account_name="symbol-sys"
rust_name="symbol_sys"

cd $root_dir

# build Plugin
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasi/release/$rust_name.wasm $root_dir/ui/public/symbol-sys.wasm
popd

cd ./ui
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r symbol-sys ./dist / -S symbol-sys
