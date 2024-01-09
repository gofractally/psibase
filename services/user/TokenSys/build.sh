root_dir="/root/psibase/services/user/TokenSys"
account_name="r-tok-sys"
rust_name="token_sys"

cd $root_dir
# Wasm component
cd ./plugin
cargo component build --release && cp target/wasm32-wasi/release/$rust_name.wasm ../ui/public/loader/plugin.wasm

# ui app
cd ../ui
rm -rf dist
rm -rf node_modules
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r $account_name ./dist / -S $account_name
