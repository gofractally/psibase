#! /bin/bash

root_dir="/root/psibase/dev/DemoApp2"
account_name="demoapp2"
rust_name="demoapp2"

cd $root_dir

echo "Creating demoapp2 account..."
psibase -a http://psibase.127.0.0.1.sslip.io:8079/ create -i demoapp2

# build Plugin
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasip1/release/$rust_name.wasm $root_dir/ui/public/plugin.wasm
popd

cd ./ui
rm -rf dist
rm -rf node_modules
yarn && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r sites ./dist / -S $account_name
