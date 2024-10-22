# Psibase Registry

Steps to run the app in dev mode:

```sh
# after building psibase at the root of the repo
cd build
./psinode --http-timeout 10 db
open http://localhost:8080

# go through the steps to create a network in dev mode, name the producer as prod and confirm

# back to this directory
cd Registry
cargo psibase install && psibase install --reinstall target/wasm32-wasi/release/packages/registry.psi

open http://registry.psibase.127.0.0.1.sslip.io:8080/
```
