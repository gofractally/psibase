# Shared pin for the published Ubuntu psidk tarball used by:
#   - nix/deploy/package.nix  (packages.psibase — runtime)
#   - nix/sdk/package.nix     (packages.psidk — Rust package-dev SDK)
#
# Held at 0.23: 0.24 production boot fails (verify-sig). See deploy/test.nix.
# Bump version + srcHash together:
#   nix store prefetch-file --hash-type sha256 \
#     https://github.com/gofractally/psibase/releases/download/vVERSION/psidk-ubuntu-2404.tar.gz
{
  version = "0.23.0-pre";
  # crates.io versions (no -pre). Used by devShells.sdk to install cargo-psibase
  # and by the package template for psibase = "…". Keep aligned with `version`.
  cargoPsibaseVersion = "0.23.0";
  psibaseCrateVersion = "0.23.0";
  srcUrl = "https://github.com/gofractally/psibase/releases/download/v0.23.0-pre/psidk-ubuntu-2404.tar.gz";
  srcHash = "sha256-l9bdB9RKz9FQLiBnXaQsHNoveOTMt1r5xRghLTfqKsQ=";
  sourceRoot = "psidk-ubuntu-2404";
}
