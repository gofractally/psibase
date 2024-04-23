#! /bin/bash

root_dir="/root/psibase/services/user/Tokens2"
account_name="tokens2"
rust_name="tokens2"

cd $root_dir


# Account Creation
echo "Creating tokens2 account..."
psibase create -i tokens2


# Build plugin and copy to public dir
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasi/release/$rust_name.wasm $root_dir/ui/public/plugin.wasm
popd

# Build UI and deploy
cd ./ui
rm -rf node_modules
rm -rf dist
npm i && npm run build
psibase upload -r $account_name ./dist / -S $account_name

cd ../service
# Build service and deploy
cargo psibase deploy -p -i $account_name

