#! /bin/bash

root_dir="/root/psibase/services/user/SupervisorSys"

cd $root_dir/ui
rm -rf dist
rm -rf node_modules
yarn && yarn build
psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload -r sites ./dist / -S supervisor-sys