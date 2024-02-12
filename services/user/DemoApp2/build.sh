root_dir="/root/psibase/services/user/DemoApp2"
account_name="demoapp2"
rust_name="demoapp2"

cd $root_dir

# build Plugin
cd ./plugin
cargo component build --release && cp target/wasm32-wasi/release/$rust_name.wasm ../ui/public/loader/plugin.wasm

echo "Creating demoapp2 account..."
psibase -a http://psibase.127.0.0.1.sslip.io:8079/ create -i demoapp2

cd ../ui
rm -rf dist
rm -rf node_modules
yarn && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r psispace-sys ./dist / -S $account_name
