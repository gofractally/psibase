{
  description = "Psibase package workspace (SDK consumer)";

  inputs = {
    # Pin to a release tag when available, e.g.:
    #   psibase.url = "github:gofractally/psibase/v0.23.0";
    # While developing against a local checkout:
    #   nix flake lock --override-input psibase path:/path/to/psibase
    psibase.url = "github:gofractally/psibase";
  };

  outputs =
    { psibase, ... }:
    {
      # Package-dev shell as default (not the contributor monorepo shell).
      devShells = builtins.mapAttrs (
        system: shells:
        let
          sdk =
            shells.sdk or (throw "psibase: no devShells.${system}.sdk (need x86_64-linux SDK flake)");
        in
        {
          default = sdk;
          inherit sdk;
        }
      ) psibase.devShells;
    };
}
