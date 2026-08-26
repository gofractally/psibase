# Resolve psinode. Incremental cmake (`build/psinode`, then installed
# `build/psidk/bin`) first; leftover `result/` from `nix build` last.
# Source after PROJECT_ROOT is set. Exports PSINODE.

if [ -z "${PROJECT_ROOT:-}" ]; then
    echo "resolve-runtime.sh: PROJECT_ROOT is not set" >&2
    return 1 2>/dev/null || exit 1
fi

if [ -x "$PROJECT_ROOT/build/psinode" ]; then
    PSINODE="$PROJECT_ROOT/build/psinode"
elif [ -x "$PROJECT_ROOT/build/psidk/bin/psinode" ]; then
    PSINODE="$PROJECT_ROOT/build/psidk/bin/psinode"
elif [ -x "$PROJECT_ROOT/result/bin/psinode" ]; then
    PSINODE="$PROJECT_ROOT/result/bin/psinode"
elif command -v psinode >/dev/null 2>&1; then
    PSINODE="$(command -v psinode)"
else
    echo "psinode not found. Build the Nix package:" >&2
    echo "  nix build" >&2
    echo "Or, for an incremental cmake tree inside nix develop:" >&2
    echo "  .editor-shared/scripts/build.sh" >&2
    return 1 2>/dev/null || exit 1
fi
export PSINODE
echo "Using $PSINODE" >&2
