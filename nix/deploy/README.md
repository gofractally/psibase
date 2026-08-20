# Deploying psibase with Nix

Two separate things live here:

- **`packages.psibase`** — the psibase binaries as a Nix package.
- **`nixosModules.psibase`** — a `services.psibase` module that runs `psinode` as
  a hardened systemd service. **NixOS only**, by construction.

Both are x86_64-linux only.

## NixOS module

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
psibase boot -a http://HOST:PORT -p prod
```

`-a`/`--api` is a subcommand argument, not a global one. It defaults to
`http://psibase.localhost:8080/` and also reads `PSINODE_URL`, so it can be
omitted when those match.

### Not handled by this module

TLS and reverse proxy are yours. psinode listens on `127.0.0.1` by default. If a
remote proxy connects directly to psinode, expose it explicitly:

```nix
services.psibase = {
  listenAddress = "0.0.0.0";
  openFirewall = true;
};
```

[x-admin](../../doc/src/default-apps/x-admin.md#authentication) authenticates
`/native/admin/`: local clients are authorized by default, and
[HTTP Basic auth](../../doc/src/default-apps/x-basic.md) is the simplest way to
allow remote access.

Only if you must integrate an external auth system, have a trusted local proxy
pass the authenticated user (easy to get wrong — the header is trusted as-is):

```nix
services.psibase.environment.PSIBASE_USERNAME_FIELD = "X-Auth-User";
```

### SoftHSM / block production

With `softHsm.enable = true` the module writes a SoftHSM config pointing at a persistent token directory, runs a oneshot that initializes the token once from `pinFile`, and starts `psinode` with `--pkcs11-module=…/libsofthsm2.so` and `SOFTHSM2_CONF` set.

`pinFile` must be a runtime path string (e.g. sops), not a Nix path literal.
Use a module function so `config` is in scope:

```nix
({ config, ... }: {
  services.psibase.softHsm = {
    enable = true;
    pinFile = config.sops.secrets.softhsm_pin.path;
  };
})
```

**After every `psinode` restart, unlock the HSM in x-admin** before the node can sign blocks.

## Package

`nix build .#psibase` repackages the published release tarball and patchelfs it for the Nix store. It does **not** build psibase from source.

It is a *runtime* package, not a psidk: `bin/{psinode,psibase,psitest}` plus `share/psibase` (`config.in`, `packages`, `wasm`, `licenses`) and man pages. The 241M `share/wasi-sysroot` and the CMake/Python dev helpers are dropped, since building services is the dev shell's job — trimmed output is ~75M against ~300M unpacked.

The layout contract is `$out/{bin,share/psibase}`: both `psinode` and the `psibase` CLI locate their data relative to the resolved executable path. Any derivation producing that layout can be substituted via `services.psibase.package`.

To bump to a new release, update `version` and `srcHash` in `package.nix` together:

```bash
nix store prefetch-file --hash-type sha256 \
  https://github.com/gofractally/psibase/releases/download/vVERSION/psidk-ubuntu-2404.tar.gz
```

## Tests

```bash
nix build .#checks.x86_64-linux.module-eval    # module + its assertions (seconds)
nix build .#checks.x86_64-linux.overlay-eval   # overlay resolves against nixpkgs
nix build .#checks.x86_64-linux.vm             # boots a node with SoftHSM (minutes)
nix flake check                                # all of the above
```

`vm` boots SoftHSM + an unsigned `ProdDefault` chain under the systemd sandbox.
Not covered: signed/production boot, HSM unlock/signing, real p2p peers.
