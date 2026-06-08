#!/usr/bin/env bash
set -e

# Psibase Nix Development Environment - Prerequisite Setup
# This script installs cargo tools with versions pinned for Rust 1.86.0 compatibility
# Tools are installed to $CARGO_INSTALL_ROOT (set by flake.nix) to avoid conflicts
# with host-installed versions.

# Check if we're in the nix shell
if [ -z "$IN_NIX_SHELL" ]; then
    echo "ERROR: This script must be run from within the nix develop shell."
    echo "       Run 'nix develop' first, then run this script."
    exit 1
fi

# Ensure CARGO_INSTALL_ROOT is set (should be set by flake.nix shellHook)
if [ -z "$CARGO_INSTALL_ROOT" ]; then
    export CARGO_INSTALL_ROOT="$HOME/.cache/psibase-nix-cargo"
fi
mkdir -p "$CARGO_INSTALL_ROOT/bin"

echo "Installing cargo tools for psibase development..."
echo "(Versions pinned for Rust 1.86.0 compatibility)"
echo "Install directory: $CARGO_INSTALL_ROOT/bin"
echo ""

install_tool() {
    local name=$1
    local required_version=$2
    local binary=${3:-$name}
    local binary_path="$CARGO_INSTALL_ROOT/bin/$binary"
    
    # Check if binary exists in our install directory
    if [ -x "$binary_path" ]; then
        # Check version
        local installed_version
        installed_version=$("$binary_path" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
        
        if [ "$installed_version" = "$required_version" ]; then
            echo "✓ $name@$required_version already installed"
            return 0
        else
            echo "→ $name version mismatch: have $installed_version, need $required_version"
            echo "  Reinstalling..."
        fi
    else
        echo "→ Installing $name@$required_version..."
    fi
    
    cargo install "$name@$required_version" --locked --quiet --force
    echo "✓ $name@$required_version installed"
}

install_tool "cargo-component" "0.15.0" "cargo-component"
install_tool "cargo-generate" "0.23.5" "cargo-generate"
install_tool "cargo-edit" "0.13.0" "cargo-set-version"

echo ""
echo "Setup complete! All cargo tools are installed."
echo ""
echo "You can now build psibase:"
echo "  mkdir -p build && cd build"
echo "  cmake .. -DCMAKE_BUILD_TYPE=Release"
echo "  cmake --build . -j\$(nproc)"
