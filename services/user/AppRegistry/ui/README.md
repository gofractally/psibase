# Psibase AppRegistry

Steps to run the app in dev mode:

```sh
# after building psibase at the root of the repo
cd build
./psinode --http-timeout 10 db
open http://localhost:8080

# go through the steps to create a network in dev mode, name the producer as prod and confirm

# ui development, from this ui folder
yarn dev
open http://appregistry.psibase.127.0.0.1.sslip.io:8081/

# about writing a psibase service (kind of a smart contract in evm world)
open http://docs.psibase.127.0.0.1.sslip.io:8080/development/services/rust-service/index.html
```
