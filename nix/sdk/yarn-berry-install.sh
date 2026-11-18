runHook preInstall
mkdir -p $out/lib/yarn $out/bin
cp -r . $out/lib/yarn/
makeWrapper @nodejs@/bin/node $out/bin/yarn \
  --add-flags "$out/lib/yarn/packages/yarnpkg-cli/bin/yarn.js"
runHook postInstall
