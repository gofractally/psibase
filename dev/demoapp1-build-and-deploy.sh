#! /bin/bash

root_dir="/root/psibase/dev/DemoApp1"
account_name="demoapp1"
rust_name="demoapp1"

cd $root_dir


# Account Creation
echo "Creating demoapp1 account..."
psibase create -a dev -i $account_name

pushd ./service
# Build service and deploy
cargo psibase deploy -a dev -p -i $account_name
popd

# Build plugin and copy to public dir
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasip1/release/$rust_name.wasm $root_dir/ui/public/plugin.wasm
popd

# Build UI and deploy
cd ./ui
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase upload -a dev -r ./dist / -S $account_name


