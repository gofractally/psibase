runHook preInstall

# Runtime / package-dev tools. cargo-psibase is optional until the next
# release that ships it (see CMake Client install).
for prog in psinode psibase psitest; do
  install -Dm755 "bin/$prog" "$out/bin/$prog"
done
if [ -f bin/cargo-psibase ]; then
  install -Dm755 bin/cargo-psibase "$out/bin/cargo-psibase"
else
  echo "note: bin/cargo-psibase missing from release tarball; SDK shell uses crates.io"
fi

# Skip bin/psidk-cmake-args — C++ only.

mkdir -p $out/share/psibase
install -Dm644 share/psibase/config.in $out/share/psibase/config.in
cp -a share/psibase/packages $out/share/psibase/packages
cp -a share/psibase/wasm $out/share/psibase/wasm

# Optional helpers used by some psitest / scripting paths.
if [ -d share/psibase/python ]; then
  cp -a share/psibase/python $out/share/psibase/python
fi
if [ -d share/psibase/licenses ]; then
  cp -a share/psibase/licenses $out/share/psibase/licenses
fi
if [ -d share/man ]; then
  cp -a share/man $out/share/man
fi

# Explicitly not installed (Rust-only SDK):
#   share/wasi-sysroot  (~241M; flake wasi-sdk + Rust wasm targets instead)
#   share/psibase/cmake (C++ service build)
#   share/gdb

runHook postInstall
