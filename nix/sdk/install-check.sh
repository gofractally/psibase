runHook preInstallCheck

$out/bin/psibase --version
psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
echo "psinode --version: $psinodeVersion"
case "$psinodeVersion" in
  "psinode "*) ;;
  *)
    echo "unexpected psinode --version output" >&2
    exit 1
    ;;
esac

if [ -x "$out/bin/cargo-psibase" ]; then
  $out/bin/cargo-psibase --help >/dev/null
else
  echo "note: cargo-psibase not in this psidk (release packaging gap; see sdk-dx-plan.md)"
fi

for p in \
  bin/psinode bin/psibase bin/psitest \
  share/psibase/config.in \
  share/psibase/packages \
  share/psibase/packages/index.json \
  share/psibase/wasm; do
  if [ ! -e "$out/$p" ]; then
    echo "missing from layout: $p" >&2
    exit 1
  fi
done

# Layout contract: CLI resolves data as dirname(exe)/../share/psibase
# when exe lives in .../bin. Smoke-check relative to the installed binary.
shareFromBin="$(dirname "$out/bin/psibase")/../share/psibase"
if [ ! -d "$shareFromBin/packages" ]; then
  echo "share path relative to bin/psibase does not resolve: $shareFromBin" >&2
  exit 1
fi

if [ -e "$out/share/wasi-sysroot" ]; then
  echo "wasi-sysroot must not be shipped in Rust-only psidk" >&2
  exit 1
fi
if [ -e "$out/share/psibase/cmake" ]; then
  echo "share/psibase/cmake must not be shipped in Rust-only psidk" >&2
  exit 1
fi
if [ -e "$out/bin/psidk-cmake-args" ]; then
  echo "psidk-cmake-args must not be shipped in Rust-only psidk" >&2
  exit 1
fi

if [ ! -e "$out/share/psibase/packages/XAdmin.psi" ]; then
  echo "share/psibase/packages/XAdmin.psi missing" >&2
  exit 1
fi

runHook postInstallCheck
