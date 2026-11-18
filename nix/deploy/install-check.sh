runHook preInstallCheck

$out/bin/psibase --version
# psinode --version writes to stderr and exits 1.
psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
echo "psinode --version: $psinodeVersion"
case "$psinodeVersion" in
  "psinode "*) ;;
  *)
    echo "unexpected psinode --version output" >&2
    exit 1
    ;;
esac

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

if [ ! -e "$out/share/psibase/packages/XAdmin.psi" ]; then
  echo "share/psibase/packages/XAdmin.psi missing" >&2
  exit 1
fi

runHook postInstallCheck
