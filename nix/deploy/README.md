# NixOS deploy

Prebuilt `psibase` package and `services.psibase` NixOS module (x86_64-linux).

```nix
# flake.nix (your NixOS host)
{
  inputs.psibase.url = "github:gofractally/psibase"; # or a local path

  outputs = { nixpkgs, psibase, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        psibase.nixosModules.psibase
        {
          services.psibase = {
            enable = true;
            host = "psibase.example.com";
            listen = 8090;
            producer = "prod"; # omit for a non-producing node
            p2p = true;
            databaseCacheSize = "2GiB";
          };
        }
      ];
    };
  };
}
```

```bash
sudo nixos-rebuild switch --flake .#myhost
```

Service runs `psinode` as user `psibase` under `/var/lib/psibase/db`. Boot a new chain once the service is up:

```bash
psibase -a http://HOST:PORT boot -p prod
```

Package: `nix build .#psibase` (release tarball, not from source). Layout is `$out/{bin,share/psibase}`; override with `services.psibase.package` if needed.
