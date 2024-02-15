#! /bin/bash

root_dir="/root/psibase/services/user/DemoApp1"
account_name="demoapp1"
rust_name="demoapp1"

cd $root_dir

echo "Creating demoapp1 account..."
psibase -a http://psibase.127.0.0.1.sslip.io:8079/ create -i demoapp1

cd ./ui
rm -rf node_modules
rm -rf dist
yarn --mutex network && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r psispace-sys ./dist / -S $account_name
