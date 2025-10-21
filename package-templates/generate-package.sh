#!/bin/bash
# Generate psibase package from template and add to workspace
# Usage: ./generate-package.sh <project-name>

set -e

if [ -z "$1" ]; then
    echo "Instantiate new package and add to workspace:"
    echo "Usage: $0 <ProjectName>"
    echo "  Example: $0 MyNewApp"
    exit 1
fi

PROJECT_NAME="$1"

# Find workspace root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_TOML="$PROJECT_ROOT/packages/user/Cargo.toml"

if [ ! -f "$WORKSPACE_TOML" ]; then
    echo "Error: $WORKSPACE_TOML not found."
    echo "Run this script from the psibase root directory."
    exit 1
fi

echo "Generating package: $PROJECT_NAME"
cargo generate -p ./package-templates/ --destination ./packages/user/ --init -v --name "$PROJECT_NAME" --silent basic-01

echo ""
echo "Adding $PROJECT_NAME to workspace..."

# Check if already added
if grep -q "\"$PROJECT_NAME\"" "$WORKSPACE_TOML"; then
    echo "✓ $PROJECT_NAME is already in the workspace"
    exit 0
fi

# Use awk to insert the new members at the bottom of the members list
awk -v project="$PROJECT_NAME" '
/^]$/ && in_members {
    print "    \"" project "\","
    print "    \"" project "/service\","
    print "    \"" project "/plugin\","
    print "    \"" project "/query-service\","
    in_members = 0
}
/^members = \[/ { in_members = 1 }
{ print }
' "$WORKSPACE_TOML" > "$WORKSPACE_TOML.tmp"

mv "$WORKSPACE_TOML.tmp" "$WORKSPACE_TOML"

echo "✓ Added $PROJECT_NAME to $WORKSPACE_TOML"
echo ""
echo "Next steps:"
echo "  1. cd packages/user/$PROJECT_NAME/ui && yarn && yarn build"
echo "  2. cd packages/user/$PROJECT_NAME && cargo-psibase package"
