#!/usr/bin/env bash

# Run with 
#   `./scripts/publish.sh`
# Can also dry-run with:
#   `./scripts/publish.sh --dry-run`

###### 
#   ~ Dependencies ~
#
#                               ,---> fracpack -->--,
#   cargo-psibase --> psibase --|                   |                         ,--> psibase-macros-derive --> psibase-macros-lib
#                               |--->---------------'--> psibase-macros -->--|
#                               |                                            |
#                               '--->-----------------------------------------'--> psibase-names
#
#   psibase_plugin  --> psibase
#   psibase_service --> psibase
######

# Dependencies above imply the following publish order:
dirs=(psibase_names psibase_macros/psibase-macros-lib psibase_macros/psibase-macros-derive psibase_macros fracpack psibase psibase_service psibase_plugin cargo-psibase)

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
    if ! out=$(cargo publish $1 2>&1); then
        printf '%s\n' "$out" >&2
        if [[ "$1" != "--dry-run" ]] && ! printf '%s\n' "$out" | grep -q 'already exists on crates.io index'; then
            exit 1
        fi
    else
        printf '%s\n' "$out" >&2
    fi
    cd - > /dev/null
done
