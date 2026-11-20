{
  description = "Psibase package workspace (SDK consumer)";

  inputs = {
    # Package SDK shell lives in psibase-dev-tools. Pin to a release tag when
    # available. For local bring-up:
    #   nix flake lock --override-input psibase-dev-tools path:/path/to/psibase-dev-tools
    psibase-dev-tools.url = "github:gofractally/psibase-dev-tools";
  };

  outputs =
    { psibase-dev-tools, ... }:
    {
      # Package-dev shell as default (not the contributor monorepo shell).
      devShells = builtins.mapAttrs (
        system: shells:
        let
          sdk =
            shells.default or shells.sdk
              or (throw "psibase-dev-tools: no Package SDK shell for ${system} (need x86_64-linux)");
        in
        {
          default = sdk;
          inherit sdk;
        }
      ) psibase-dev-tools.devShells;
    };
}
