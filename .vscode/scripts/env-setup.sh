#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
WORKSPACE_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

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

# Symlink optional agent configuration(s)
CONF_DIR=".cursor"
if [ -L "$WORKSPACE_ROOT/$CONF_DIR" ]; then
    printf '\nSkipping agent config dir symlink: %s already exists (symlink).\n\n' "$WORKSPACE_ROOT/$CONF_DIR"
elif [ -e "$WORKSPACE_ROOT/$CONF_DIR" ]; then
    printf '\nSkipping agent config dir symlink: %s already exists.\n\n' "$WORKSPACE_ROOT/$CONF_DIR"
elif [ ! -d "/root/agent-config/$CONF_DIR" ]; then
    printf '\nSkipping agent config dir symlink: /root/agent-config/%s is not available.\n\n' "$CONF_DIR"
else
    if ln -s "/root/agent-config/$CONF_DIR" "$WORKSPACE_ROOT/$CONF_DIR"; then
        printf '\nSymlinked /root/agent-config/%s to %s\n\n' "$CONF_DIR" "$WORKSPACE_ROOT/$CONF_DIR"
        printf 'Config may take several minutes to load.\n\n'
    else
        printf '\nFailed to symlink /root/agent-config/%s to %s.\n\n' "$CONF_DIR" "$WORKSPACE_ROOT/$CONF_DIR"
    fi
fi
