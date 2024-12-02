#!/bin/bash

# Run with 
#   `./scripts/publish.sh`
# Can also dry-run with:
#   `./scripts/publish.sh --dry-run`

###### 
#   ~ Dependencies ~
#
#                               ,---> fracpack -->--,                         ,--> psibase-macros-lib
#   cargo-psibase --> psibase --|                   |                         |--> psibase-macros-derive
#                               |--->---------------'--> psibase-macros -->--,
#                               |                                             |
#                               '--->-----------------------------------------'--> psibase-names
######

# Dependencies above imply the following publish order:
dirs=(psibase_names psibase_macros/psibase-macros-derive psibase_macros/psibase-macros-lib psibase_macros fracpack psibase cargo-psibase)

cd "$(dirname "$0")/../"

# Ensure each crate builds
for dir in "${dirs[@]}"; do
    cd "$dir" || exit
    echo "Building $dir..."
    cargo build || exit
    cd - > /dev/null
done

# Now publish each crate
for dir in "${dirs[@]}"; do
    cd "$dir"
    echo "Publishing $dir..."
    cargo publish $1
    cd - > /dev/null
done
