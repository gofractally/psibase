#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Copy sample VSCode configuration files
for file in "$WORKSPACE_ROOT/.vscode"/*.sample; do
    cp "$file" "${file%.sample}"
    echo "Copied $file to ${file%.sample}"
done

# Symlink files to workspace root
[ ! -L "$WORKSPACE_ROOT/.clangd" ] && ln -s "$SCRIPT_DIR/../.clangd" "$WORKSPACE_ROOT/.clangd"
[ ! -L "$WORKSPACE_ROOT/.envrc" ] && ln -s "$SCRIPT_DIR/../.envrc" "$WORKSPACE_ROOT/.envrc"

# Install dependencies and configure VSCode SDKs
cd "$WORKSPACE_ROOT/packages"
yarn
yarn dlx @yarnpkg/sdks vscode