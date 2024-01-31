root_dir="/root/psibase/services/user/TokenSys"
account_name="r-tok-sys"
rust_name="token_sys"

cd $root_dir
# Wasm component
cd ./wasm
cargo component build --release && cp target/wasm32-wasi/release/$rust_name.wasm ../ui/public/loader/functions.wasm

# Account-Sys
cd ../ui
npm run build && psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r $account_name ./dist / -S $account_name
