#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
BOOTSTRAP_MARKER="$WORKSPACE_ROOT/nix/.workspace-bootstrapped"

if [ -f "$BOOTSTRAP_MARKER" ]; then
    echo "Workspace already bootstrapped; skipping. Remove $BOOTSTRAP_MARKER to rerun."
    exit 0
fi

# Copy sample VSCode configuration files
for file in "$WORKSPACE_ROOT/.vscode"/*.sample; do
    cp "$file" "${file%.sample}"
    echo "Copied $file to ${file%.sample}"
done

# Symlink files to workspace root
[ ! -L "$WORKSPACE_ROOT/.clangd" ] && ln -sr "$WORKSPACE_ROOT/.vscode/.clangd" "$WORKSPACE_ROOT/.clangd"
[ ! -L "$WORKSPACE_ROOT/.envrc" ] && ln -sr "$WORKSPACE_ROOT/.vscode/.envrc" "$WORKSPACE_ROOT/.envrc"

# Install dependencies and configure VSCode SDKs
cd "$WORKSPACE_ROOT/packages"
yarn
yarn dlx @yarnpkg/sdks vscode

mkdir -p "$(dirname "$BOOTSTRAP_MARKER")"
touch "$BOOTSTRAP_MARKER"