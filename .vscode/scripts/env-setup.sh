#!/bin/bash

# Copy sample VSCode configuration files
for file in /root/psibase/.vscode/*.sample; do
    cp "$file" "${file%.sample}"
    echo "Copied $file to ${file%.sample}"
done

# Install dependencies and configure VSCode SDKs
cd packages
yarn
yarn dlx @yarnpkg/sdks vscode

# Symlink files to workspace root
[ ! -L /root/psibase/.clangd ] && ln -s /root/psibase/.vscode/.clangd /root/psibase/.clangd
[ ! -L /root/psibase/.envrc ] && ln -s /root/psibase/.vscode/.envrc /root/psibase/.envrc