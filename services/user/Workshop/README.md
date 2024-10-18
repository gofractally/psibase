# Psibase Workshop

Steps to run the app in dev mode:

```sh
# after building psibase at the root of the repo
cd build
./psinode --http-timeout 10 db
open http://localhost:8080

# go through the steps to create a network in dev mode, name the producer as prod and confirm

# ui development
cd ui
yarn build

cd Workshop
cargo psibase install && psibase install --reinstall target/wasm32-wasi/release/packages/workshop.psi

open http://workshop.psibase.127.0.0.1.sslip.io:8080/

# wip: about writing a psibase service
open http://docs.psibase.127.0.0.1.sslip.io:8080/development/services/rust-service/index.html
```
