# Psibase Registry

Steps to run the app in dev mode:

```sh
# after building psibase at the root of the repo
cd build
./psinode db
open http://localhost:8080

# go through the steps to create a network in dev mode, name the producer as prod and confirm

# back to this directory
cd Registry
cargo psibase install --reinstall

open http://registry.psibase.localhost:8080/
```
