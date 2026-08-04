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

## SoftHSM / block production

With `softHsm.enable = true` the module writes a SoftHSM config pointing at a persistent token directory, runs a oneshot that initializes the token once from `pinFile`, and starts `psinode` with `--pkcs11-module=…/libsofthsm2.so` and `SOFTHSM2_CONF` set.

`pinFile` normally comes from a secrets manager, so this has to go in a module *function* — `config` is not in scope inside a bare attrset:

```nix
({ config, ... }: {
  services.psibase.softHsm = {
    enable = true;
    pinFile = config.sops.secrets.softhsm_pin.path;
  };
})
```

**After every `psinode` restart, unlock the HSM device in x-admin before the node can sign blocks.** This is the same manual step as the docker deploy. The module does not automate it, and a producing node will silently fail to sign until it is done.

## Package

`nix build .#psibase` repackages the published release tarball and patchelfs it for NixOS. It does **not** build psibase from source.

It is a *runtime* package, not a psidk: `bin/{psinode,psibase,psitest}` plus `share/psibase` (`config.in`, `packages`, `wasm`, `services`, `licenses`) and man pages. The 241M `share/wasi-sysroot` and the CMake/Python dev helpers are dropped, since building services is the dev shell's job — trimmed output is 74M against 314M unpacked.

The layout contract is `$out/{bin,share/psibase}`: both `psinode` and the `psibase` CLI locate their data relative to the resolved executable path. Any derivation producing that layout can be substituted via `services.psibase.package`.

To bump to a new release, update `version` and `srcHash` in `package.nix` together:

```bash
nix store prefetch-file --hash-type sha256 \
  https://github.com/gofractally/psibase/releases/download/vVERSION/psidk-ubuntu-2404.tar.gz
```
