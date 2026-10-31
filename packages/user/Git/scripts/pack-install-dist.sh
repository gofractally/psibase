#!/bin/sh
# Pack git-remote-psibase release tarballs into packages/user/Git/install-dist,
# which the git package uploads to Sites under git.<root>/install/.
#
#   pack-install-dist.sh <version> <arch>=<binary> [<arch>=<binary> ...]
#   e.g. pack-install-dist.sh v0.29.0 \
#          x86_64=rust/target/x86_64-unknown-linux-musl/dist/git-remote-psibase \
#          aarch64=rust/target/aarch64-unknown-linux-musl/dist/git-remote-psibase
#
# Writes git-remote-psibase-linux-<arch>.tar.gz, SHA256SUMS.txt and version.txt.
# Fails if any tarball exceeds MAX_TARBALL_BYTES (default 7 MiB: Sites stores
# each file as one row and the default maxValueSize is 8 MiB), or if all of
# them together exceed MAX_TOTAL_BYTES (default 4.25 MiB, measured package limit).
set -eu

[ $# -ge 2 ] || { echo "usage: $0 <version> <arch>=<binary>..." >&2; exit 2; }
VERSION="$1"; shift
OUT="$(cd "$(dirname "$0")/.." && pwd)/install-dist"
MAX="${MAX_TARBALL_BYTES:-7340032}"
# All tarballs together ship in one package; see "Installing the client" in
# git-on-psibase.md for the measured limit this keeps under.
MAX_TOTAL="${MAX_TOTAL_BYTES:-4456448}"

rm -rf "$OUT"
mkdir -p "$OUT"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for spec in "$@"; do
    arch="${spec%%=*}"; bin="${spec#*=}"
    case "$arch" in x86_64|aarch64) ;; *) echo "unsupported arch $arch" >&2; exit 2 ;; esac
    [ -f "$bin" ] || { echo "missing binary $bin" >&2; exit 1; }
    if command -v readelf >/dev/null 2>&1 && readelf -l "$bin" 2>/dev/null | grep -q "Requesting program interpreter"; then
        echo "$bin is dynamically linked; build a static (musl) binary" >&2; exit 1
    fi
    tarball="git-remote-psibase-linux-$arch.tar.gz"
    rm -rf "$STAGE/$arch"; mkdir -p "$STAGE/$arch"
    cp "$bin" "$STAGE/$arch/git-remote-psibase"
    chmod 755 "$STAGE/$arch/git-remote-psibase"
    # Reproducible: fixed owner, mode and mtime.
    tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 \
        -C "$STAGE/$arch" -cf - git-remote-psibase | gzip -9n > "$OUT/$tarball"
    size=$(wc -c < "$OUT/$tarball")
    echo "$tarball: $size bytes"
    if [ "$size" -gt "$MAX" ]; then
        echo "error: $tarball is $size bytes, over the $MAX byte limit" >&2; exit 1
    fi
done

# Sites needs a file extension for the MIME type; the git service redirects
# /install/SHA256SUMS and /install/version to these.
total=$(cat "$OUT"/*.tar.gz | wc -c)
echo "total: $total bytes"
if [ "$total" -gt "$MAX_TOTAL" ]; then
    echo "error: tarballs total $total bytes, over the $MAX_TOTAL byte package limit" >&2; exit 1
fi
printf '%s\n' "$VERSION" > "$OUT/version.txt"
(cd "$OUT" && sha256sum *.tar.gz > SHA256SUMS.txt)
cat "$OUT/SHA256SUMS.txt"
