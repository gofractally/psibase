runHook preInstall

for prog in psinode psibase psitest; do
  install -Dm755 "bin/$prog" "$out/bin/$prog"
done

mkdir -p $out/share/psibase
install -Dm644 share/psibase/config.in $out/share/psibase/config.in
cp -a share/psibase/packages $out/share/psibase/packages
cp -a share/psibase/wasm $out/share/psibase/wasm

if [ -d share/psibase/licenses ]; then
  cp -a share/psibase/licenses $out/share/psibase/licenses
fi
if [ -d share/man ]; then
  cp -a share/man $out/share/man
fi

runHook postInstall
