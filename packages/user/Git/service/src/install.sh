#!/bin/sh
# Installer for git-remote-psibase, served by the `git` service on this chain.
#
#   curl --proto '=https' --tlsv1.2 -fsSL https://git.<root>/install.sh | sh
#   curl --proto '=https' --tlsv1.2 -fsSL https://git.<root>/install.sh | sh -s -- --host
#
# The `git` service generates this file per request; BASE below is the chain
# it was fetched from. Everything else is downloaded from BASE/install/.
set -eu

BASE="${PSIBASE_GIT_INSTALL_URL:-@BASE_URL@}"
ROOT="@ROOT_URL@"
# The copy attached to a GitHub release is the unrendered template.
case "$BASE" in
    @*@) printf 'set PSIBASE_GIT_INSTALL_URL=https://git.<root> or use that chain'"'"'s own install.sh\n' >&2; exit 1 ;;
esac
case "$ROOT" in
    @*@) ROOT="$(printf '%s' "$BASE" | sed 's#://git\.#://#')" ;;
esac
PREFIX=""
HOST=0

say() { printf 'git-remote-psibase installer: %s\n' "$*" >&2; }
die() { say "error: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) [ $# -ge 2 ] || die "--prefix needs a directory"; PREFIX="$2"; shift 2 ;;
        --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
        --host) HOST=1; shift ;;
        -h|--help)
            echo "usage: install.sh [--prefix <dir>] [--host]"
            echo "  --prefix <dir>  install into <dir>/bin (default \$HOME/.local)"
            echo "  --host          also install psibase-git-host (does not start it)"
            exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

if [ -z "$PREFIX" ]; then
    if [ "$(id -u)" = "0" ]; then
        die "refusing to run as root without an explicit --prefix"
    fi
    [ -n "${HOME:-}" ] || die "HOME is not set; pass --prefix <dir>"
    PREFIX="$HOME/.local"
fi
BIN="$PREFIX/bin"

command -v git >/dev/null 2>&1 || die "git is not on PATH; install git first"

case "$(uname -s)" in
    Linux) os=linux ;;
    *) die "unsupported OS $(uname -s); only Linux x86_64 and aarch64 are released" ;;
esac
case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    aarch64|arm64) arch=aarch64 ;;
    *) die "unsupported architecture $(uname -m); only x86_64 and aarch64 are released" ;;
esac

if command -v curl >/dev/null 2>&1; then
    # Sites sends brotli unless told otherwise; ask for the bytes as stored.
    fetch() { curl -fsSL -H 'Accept-Encoding: identity' "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q --header='Accept-Encoding: identity' "$1" -O "$2"; }
else
    die "need curl or wget"
fi
if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    die "need sha256sum or shasum"
fi

mkdir -p "$BIN" 2>/dev/null || true
if [ ! -d "$BIN" ] || [ ! -w "$BIN" ]; then
    die "$BIN is not writable; pass --prefix <dir> with a writable directory (this script does not use sudo)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch "$BASE/install/SHA256SUMS.txt" "$TMP/SHA256SUMS" || die "cannot download $BASE/install/SHA256SUMS.txt"
version="$(fetch "$BASE/install/version.txt" "$TMP/version" && cat "$TMP/version" || echo unknown)"

install_one() {
    name="$1"
    tarball="$name-$os-$arch.tar.gz"
    want="$(awk -v f="$tarball" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS")"
    [ -n "$want" ] || die "$tarball is not published on this chain"
    fetch "$BASE/install/$tarball" "$TMP/$tarball" || die "cannot download $BASE/install/$tarball"
    got="$(sha256 "$TMP/$tarball")"
    [ "$got" = "$want" ] || die "checksum mismatch for $tarball (expected $want, got $got)"
    mkdir -p "$TMP/x-$name"
    tar -xzf "$TMP/$tarball" -C "$TMP/x-$name"
    [ -f "$TMP/x-$name/$name" ] || die "$tarball does not contain $name"
    # Replace atomically so re-running the script updates in place.
    cp "$TMP/x-$name/$name" "$BIN/.$name.new"
    chmod 755 "$BIN/.$name.new"
    mv -f "$BIN/.$name.new" "$BIN/$name"
    say "installed $BIN/$name ($version)"
}

install_one git-remote-psibase
if [ "$HOST" = 1 ]; then
    install_one psibase-git-host
    say "psibase-git-host is installed but not started. Run it with:"
    say "  psibase-git-host --api $ROOT --repo-dir $PREFIX/share/psibase-git/repos"
fi

case ":${PATH:-}:" in
    *":$BIN:"*) say "done; use remotes like psibase::$ROOT/<owner>/<repo>" ;;
    *)
        say "$BIN is not on PATH, so git cannot find git-remote-psibase yet. Add:"
        say "  export PATH=\"$BIN:\$PATH\""
        exit 1 ;;
esac
