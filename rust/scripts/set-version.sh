#!/bin/bash

# Run with 
#   `./scripts/set-version.sh x.y.z`
# Can also dry-run with:
#   `./scripts/set-version.sh "x.y.z --dry-run"`

cargo set-version $1 --workspace