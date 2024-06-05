#! /bin/bash

root_dir="/root/psibase/dev/DemoApp1"
account_name="demoapp1"
rust_name="demoapp1"

cd $root_dir


# Account Creation
echo "Creating demoapp1 account..."
psibase create -i demoapp1


# Build plugin and copy to public dir
pushd ./plugin
cargo component build --release && mkdir -p $root_dir/ui/public && cp target/wasm32-wasi/release/$rust_name.wasm $root_dir/ui/public/plugin.wasm
popd

# Build UI and deploy
cd ./ui
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase upload -r $account_name ./dist / -S $account_name

cd ../service
# Build service and deploy
/root/psibase/rust/target/release/cargo-psibase deploy -p -i $account_name


# let (_, doc) = Document::from_pem(&pub_pem)
#             .map_err(|e| CryptoError.err(&(e.to_string() + ": " + &pub_pem)))?;
