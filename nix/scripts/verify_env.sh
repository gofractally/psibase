#!/usr/bin/env bash
# Verify the Nix development environment has correct versions and paths (Linux).
# Run this before building to catch configuration issues early.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

pass() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }

check_command() {
    local cmd=$1
    local expected_version=$2
    local name=${3:-$cmd}

    if ! command -v "$cmd" &> /dev/null; then
        fail "$name: not found in PATH"
        return 1
    fi

    local version
    version=$("$cmd" --version 2>&1 | head -1)

    if [[ -n "$expected_version" ]] && [[ "$version" != *"$expected_version"* ]]; then
        warn "$name: $version (expected $expected_version)"
        return 1
    else
        pass "$name: $version"
        return 0
    fi
}

check_path() {
    local cmd=$1
    local expected_pattern=$2
    local name=${3:-$cmd}

    local path
    path=$(which "$cmd" 2>/dev/null || echo "not found")

    if [[ "$path" == "not found" ]]; then
        fail "$name: not found"
        return 1
    elif [[ "$path" == *"/usr/lib"* ]] || [[ "$path" == *"/usr/bin"* ]]; then
        if [[ "$expected_pattern" != "system" ]]; then
            fail "$name: using system path $path (should be nix)"
            return 1
        fi
    fi

    if [[ -n "$expected_pattern" ]] && [[ "$expected_pattern" != "system" ]] && [[ "$path" != *"$expected_pattern"* ]]; then
        warn "$name path: $path"
        return 1
    else
        pass "$name path: $path"
        return 0
    fi
}

echo "========================================"
echo "Psibase Nix Environment Verification (Linux)"
echo "========================================"
echo ""

echo "--- Environment ---"
if [[ -n "$IN_NIX_SHELL" ]]; then
    pass "IN_NIX_SHELL=$IN_NIX_SHELL"
else
    fail "Not in a nix shell (IN_NIX_SHELL not set)"
fi

if [[ -n "$NIX_SHELL_DEPTH" ]]; then
    pass "NIX_SHELL_DEPTH=$NIX_SHELL_DEPTH"
fi

echo ""
echo "--- Compilers ---"
if [[ "$CC" == *"clang"* ]] && [[ "$CC" == *"/nix/store/"* ]]; then
    pass "CC=$CC"
else
    fail "CC=$CC (expected nix clang)"
fi
if [[ "$CXX" == *"clang++"* ]] && [[ "$CXX" == *"/nix/store/"* ]]; then
    pass "CXX=$CXX"
else
    fail "CXX=$CXX (expected nix clang++)"
fi
check_command clang "18" "Clang"
check_command clang++ "18" "Clang++"

echo ""
echo "--- Rust ---"
check_command rustc "1.86.0" "Rust"
check_command cargo "1.86.0" "Cargo"
check_path rustc "/nix/store" "rustc"

echo ""
echo "--- Cargo Tools ---"
install_root="${CARGO_INSTALL_ROOT:-$HOME/.cache/psibase-nix-cargo}"
cargo_bin="$install_root/bin"
for tool_info in "cargo-component:0.15.0" "cargo-generate:0.23.5" "cargo-set-version:0.13.0"; do
    tool="${tool_info%%:*}"
    required_version="${tool_info##*:}"
    binary="$cargo_bin/$tool"

    if [[ ! -x "$binary" ]]; then
        fail "$tool: not found in $cargo_bin (run ./nix/scripts/setup_prereqs.sh)"
    else
        if [[ "$tool" == "cargo-set-version" ]]; then
            installed_version=$(CARGO_INSTALL_ROOT="$install_root" cargo install --list 2>/dev/null | grep -E '^\s*cargo-edit\s+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
        else
            installed_version=$("$binary" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
        fi
        if [[ "$installed_version" == "$required_version" ]]; then
            pass "$tool: $installed_version (correct version)"
        else
            fail "$tool: $installed_version (expected $required_version — run ./nix/scripts/setup_prereqs.sh)"
        fi
    fi
done

echo ""
echo "--- Node.js ---"
check_command node "v20" "Node.js"
check_path node "/nix/store" "node"
check_command yarn "4.9.1" "Yarn"

echo ""
echo "--- WASI SDK ---"
if [[ -n "$WASI_SDK_PREFIX" ]]; then
    if [[ "$WASI_SDK_PREFIX" == *"/nix/store/"* ]]; then
        pass "WASI_SDK_PREFIX=$WASI_SDK_PREFIX"
    else
        warn "WASI_SDK_PREFIX=$WASI_SDK_PREFIX (outside /nix/store)"
    fi
else
    fail "WASI_SDK_PREFIX not set"
fi

for var in WASI_SDK_AR WASI_SDK_RANLIB; do
    eval "val=\$$var"
    if [[ -z "$val" ]]; then
        fail "$var not set"
    elif [[ ! -f "$val" || ! -x "$val" ]]; then
        fail "$var=$val (not executable or missing)"
    else
        pass "$var set and executable"
    fi
done

# Optional: check builtins archive for corrupt members (Linux prebuilt SDK is usually fine)
if [[ -n "$WASI_SDK_PREFIX" ]] && [[ -d "$WASI_SDK_PREFIX/lib/clang" ]]; then
    builtins_a=""
    for f in "$WASI_SDK_PREFIX"/lib/clang/*/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a; do
        [[ -f "$f" ]] && builtins_a="$f" && break
    done
    if [[ -n "$builtins_a" ]] && [[ -x "$WASI_SDK_PREFIX/bin/llvm-ar" ]]; then
        members=$("$WASI_SDK_PREFIX/bin/llvm-ar" t "$builtins_a" 2>/dev/null)
        single=$(echo "$members" | grep -xE '/[[:space:]]*' | wc -l | tr -d ' ')
        double=$(echo "$members" | grep -xE '//[[:space:]]*' | wc -l | tr -d ' ')
        if [[ "$single" -ge 1 ]]; then
            fail "libclang_rt.builtins.a contains corrupt member '/' — try re-entering nix shell and clean build"
        elif [[ "$double" -gt 1 ]]; then
            fail "libclang_rt.builtins.a contains multiple '//' members — try re-entering nix shell and clean build"
        else
            pass "libclang_rt.builtins.a OK"
        fi
    fi
fi

echo ""
echo "--- Critical Library Paths ---"
if [[ -n "$ICU_ROOT" ]]; then
    if [[ "$ICU_ROOT" == *"/nix/store/"* ]]; then
        pass "ICU_ROOT=$ICU_ROOT"
    else
        fail "ICU_ROOT=$ICU_ROOT (should be in /nix/store)"
    fi
else
    warn "ICU_ROOT not set"
fi

echo ""
if [[ -n "$LIBRARY_PATH" ]]; then
    first_lib_path="${LIBRARY_PATH%%:*}"
    if [[ "$first_lib_path" == *"/nix/store/"*"icu"* ]]; then
        pass "LIBRARY_PATH starts with nix ICU: $first_lib_path"
    elif [[ "$first_lib_path" == "/usr/lib"* ]]; then
        fail "LIBRARY_PATH starts with /usr/lib (will find wrong ICU)"
    else
        pass "LIBRARY_PATH first entry: $first_lib_path"
    fi
else
    warn "LIBRARY_PATH not set"
fi

echo ""
echo "ICU library resolution (Linux .so):"
for lib in libicui18n.so libicuuc.so libicudata.so; do
    found=0
    for dir in ${LIBRARY_PATH//:/ }; do
        if [[ -f "$dir/$lib" ]]; then
            if [[ "$dir" == *"/nix/store/"* ]]; then
                pass "$lib -> $dir/$lib"
            else
                fail "$lib -> $dir/$lib (NOT in nix store!)"
            fi
            found=1
            break
        fi
    done
    if [[ $found -eq 0 ]]; then
        if [[ -f "/usr/lib/$lib" ]]; then
            target=$(readlink -f "/usr/lib/$lib" 2>/dev/null || echo "/usr/lib/$lib")
            fail "$lib -> /usr/lib -> $target (BAD: use nix shell)"
        else
            warn "$lib: not found in LIBRARY_PATH"
        fi
    fi
done

echo ""
echo "--- Boost ---"
if pkg-config --exists boost 2>/dev/null; then
    boost_ver=$(pkg-config --modversion boost 2>/dev/null || echo "unknown")
    pass "Boost (via pkg-config): $boost_ver"
else
    warn "Boost: could not determine path"
fi

echo ""
echo "--- FHS Compatibility ---"
if [[ -f "/usr/lib/libicui18n.so" ]]; then
    target=$(readlink -f "/usr/lib/libicui18n.so" 2>/dev/null)
    warn "FHS compat: /usr/lib/libicui18n.so -> $target"
    echo "     Use -DICU_ROOT=\$ICU_ROOT and avoid /usr/lib in cmake search."
else
    pass "No FHS compat ICU in /usr/lib"
fi

echo ""
echo "--- Recommended cmake command ---"
echo "rm -rf build && mkdir build && cd build"
echo "cmake .. -DCMAKE_BUILD_TYPE=Release"
echo "cmake --build . -j\$(nproc)"
echo ""

echo "========================================"
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}FAILED: $ERRORS error(s), $WARNINGS warning(s)${NC}"
    echo ""
    echo "Fix the errors above before building. Common fixes:"
    echo "  exit && nix develop"
    echo "  rm -rf build && mkdir build"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}PASSED with $WARNINGS warning(s)${NC}"
    exit 0
else
    echo -e "${GREEN}PASSED: All checks OK${NC}"
    exit 0
fi
