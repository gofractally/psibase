root_dir="/root/psibase/services/system/AccountSys"
account_name="r-account-sys"
rust_name="account_sys"

cd $root_dir
# Wasm component
cd ./plugin
cargo component build --release && cp target/wasm32-wasi/release/$rust_name.wasm ../ui/public/loader/plugin.wasm

# Account-Sys
cd ../ui
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r $account_name ./dist / -S $account_name
