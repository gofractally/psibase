#! /bin/bash

root_dir="/root/psibase/services/user/Tokens"
account_name="tokens"
rust_name="tokens"
proxy_name="r-tokens"

cd $root_dir


# Account Creation
echo "Creating tokens account..."
psibase create -i tokens


# Build plugin and copy to public dir
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasi/release/$rust_name.wasm $root_dir/ui/public/plugin.wasm
popd

# Build UI and deploy
cd ./ui
rm -rf node_modules
rm -rf dist
npm i && npm run build
# psibase upload -r $account_name ./dist / -S $account_name
psibase upload -r $proxy_name ./dist / 


# Build service and deploy
cd /root/psibase/build
make install
psibase deploy tokens Tokens.wasm


