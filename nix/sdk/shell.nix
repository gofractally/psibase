# Package-developer `nix develop .#sdk` shell (Rust out-of-tree packages).
# Does not assume a psibase monorepo checkout or local build/ tree.
# Contributor-only inputs (mdbook, cursor-cli, …) are not imported here.
{
  pkgs,
  system,
  fenix,
  wasiSdk,
  nixpkgs-cargo-component,
  nixpkgs-cargo-generate,
  nixpkgs-nodejs,
  # packages.psidk
  psidk,
  # nix/sdk/package-templates (out-of-tree cargo-generate tree)
  packageTemplates,
}:
let
  release = import ../release.nix;

  cargoComponent = (import nixpkgs-cargo-component { inherit system; }).cargo-component;
  cargoToolsPkgs = import nixpkgs-cargo-generate { inherit system; };
  cargoGenerate = cargoToolsPkgs.cargo-generate;
  cargoEdit = cargoToolsPkgs.cargo-edit;
  nodejs20 = (import nixpkgs-nodejs { inherit system; }).nodejs_20;

  rustToolchain = fenix.packages.${system}.fromToolchainFile {
    file = ../rust-toolchain.toml;
    sha256 = "sha256-X/4ZBHO3iW0fOenQ3foEvscgAPJYl2abspaBThDOukI=";
  };

  yarnBerry = pkgs.stdenv.mkDerivation rec {
    pname = "yarn-berry";
    version = "4.9.1";

    src = pkgs.fetchFromGitHub {
      owner = "yarnpkg";
      repo = "berry";
      rev = "@yarnpkg/cli/${version}";
      sha256 = "sha256-znxB827TFLAEfCeHrwBsmRlkZz1LVWsBFhjZANiIW/4=";
    };

    nativeBuildInputs = [ pkgs.makeWrapper ];

    dontBuild = true;
    dontConfigure = true;

    installPhase = ''
      runHook preInstall
      mkdir -p $out/lib/yarn $out/bin
      cp -r . $out/lib/yarn/
      makeWrapper ${nodejs20}/bin/node $out/bin/yarn \
        --add-flags "$out/lib/yarn/packages/yarnpkg-cli/bin/yarn.js"
      runHook postInstall
    '';
  };

  psidkDevnet = pkgs.writeShellApplication {
    name = "psidk-devnet";
    runtimeInputs = [
      psidk
      pkgs.curl
      pkgs.coreutils
      pkgs.gnugrep
    ];
    excludeShellChecks = [ "SC2034" ];
    text = ''
      HOST="''${PSIBASE_DEVNET_HOST:-psibase.localhost}"
      PORT="''${PSIBASE_DEVNET_PORT:-8080}"
      PRODUCER="''${PSIBASE_DEVNET_PRODUCER:-myprod}"
      ADMIN_IP="''${PSIBASE_ADMIN_IP:-''${HOST_IP:-127.0.0.1}}"
      STATE_DIR="''${PSIBASE_DEVNET_DIR:-''${XDG_STATE_HOME:-$HOME/.local/state}/psibase-devnet}"

      usage() {
        cat <<EOF
      Usage: psidk-devnet <command> [options]

      Commands:
        up [port] [producer] [state-dir]   Start fresh chain, boot, print API URL
        down                               Stop the chain started by up
        status                             Show pid / API if running

      Environment:
        PSIBASE_DEVNET_HOST / PORT / PRODUCER / DIR
        PSIBASE_ADMIN_IP / HOST_IP

      API URL uses a hostname (not a bare IP) for virtual hosting.
      EOF
      }

      api_url() { echo "http://''${HOST}:''${PORT}/"; }

      wait_http() {
        local n code
        for n in $(seq 1 60); do
          code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 1 \
            -H "Host: x-admin.''${HOST}" "http://127.0.0.1:''${PORT}/" 2>/dev/null || echo 000)
          if [[ "$code" =~ ^[0-9]+$ ]] && [[ "$code" != "000" ]]; then
            return 0
          fi
          sleep 0.25
        done
        echo "error: psinode did not accept HTTP on port ''${PORT}" >&2
        return 1
      }

      cmd_up() {
        PORT="''${1:-$PORT}"
        PRODUCER="''${2:-$PRODUCER}"
        STATE_DIR="''${3:-$STATE_DIR}"
        mkdir -p "$STATE_DIR"
        local pidfile="$STATE_DIR/psinode.pid"
        local logfile="$STATE_DIR/psinode.log"
        local dbdir="$STATE_DIR/db"
        if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
          echo "error: psinode already running (pid $(cat "$pidfile")). Run: psidk-down" >&2
          exit 1
        fi
        rm -rf "$dbdir"
        mkdir -p "$dbdir"
        echo "Starting psinode (host=''${HOST} port=''${PORT} producer=''${PRODUCER})"
        echo "  state: $STATE_DIR"
        PSIBASE_ADMIN_IP="$ADMIN_IP" \
          psinode "$dbdir" -p "$PRODUCER" -l "$PORT" --host "$HOST" \
          >"$logfile" 2>&1 &
        echo $! >"$pidfile"
        wait_http
        echo "Booting chain…"
        psibase boot -a "$(api_url)" -p "$PRODUCER"
        echo ""
        echo "Devnet ready."
        echo "  API:      $(api_url)"
        echo "  Admin:    http://x-admin.''${HOST}:''${PORT}/"
        echo "  Producer: ''${PRODUCER}"
        echo "  Stop:     psidk-down"
        echo ""
        echo "  cargo-psibase install -a $(api_url)"
      }

      cmd_down() {
        local pidfile="$STATE_DIR/psinode.pid"
        if [[ ! -f "$pidfile" ]]; then
          echo "No pid file at $pidfile (nothing to stop)."
          return 0
        fi
        local pid
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
          kill "$pid" 2>/dev/null || true
          for _ in $(seq 1 20); do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.1
          done
          kill -9 "$pid" 2>/dev/null || true
          echo "Stopped psinode (pid $pid)."
        else
          echo "Stale pid file (process $pid not running)."
        fi
        rm -f "$pidfile"
      }

      cmd_status() {
        local pidfile="$STATE_DIR/psinode.pid"
        if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
          echo "running pid=$(cat "$pidfile") api=$(api_url) state=$STATE_DIR"
        else
          echo "stopped state=$STATE_DIR"
          return 1
        fi
      }

      cmd="''${1:-}"
      shift || true
      case "$cmd" in
        up) cmd_up "$@" ;;
        down) cmd_down "$@" ;;
        status) cmd_status "$@" ;;
        -h|--help|help|"") usage ;;
        *)
          echo "unknown command: $cmd" >&2
          usage >&2
          exit 1
          ;;
      esac
    '';
  };

  # Convenience wrappers matching the plan's psidk-up / psidk-down names.
  psidkUp = pkgs.writeShellScriptBin "psidk-up" ''
    exec ${psidkDevnet}/bin/psidk-devnet up "$@"
  '';
  psidkDown = pkgs.writeShellScriptBin "psidk-down" ''
    exec ${psidkDevnet}/bin/psidk-devnet down "$@"
  '';

  # Scaffold a full app (service + query + plugin + UI) into ./packages via cargo-generate.
  psidkNew = pkgs.writeShellApplication {
    name = "psidk-new";
    runtimeInputs = [
      cargoGenerate
      pkgs.coreutils
      pkgs.findutils
      pkgs.gnugrep
      pkgs.gnused
    ];
    text = ''
      set -euo pipefail
      VERSION="''${PSIBASE_CRATE_VERSION:-${release.psibaseCrateVersion}}"
      TEMPLATES="''${PSIBASE_PACKAGE_TEMPLATES:-}"
      if [[ -z "$TEMPLATES" || ! -d "$TEMPLATES" ]]; then
        echo "error: PSIBASE_PACKAGE_TEMPLATES not set (enter nix develop .#sdk)" >&2
        exit 1
      fi

      # Find workspace root: directory containing packages/Cargo.toml
      find_packages_dir() {
        local d
        d="$(pwd)"
        while [[ "$d" != "/" ]]; do
          if [[ -f "$d/packages/Cargo.toml" ]]; then
            echo "$d/packages"
            return 0
          fi
          if [[ -f "$d/Cargo.toml" ]] && grep -q '^\[workspace\]' "$d/Cargo.toml" 2>/dev/null \
            && [[ "$(basename "$d")" == "packages" ]]; then
            echo "$d"
            return 0
          fi
          d="$(dirname "$d")"
        done
        return 1
      }

      PACKAGES_DIR="$(find_packages_dir)" || {
        echo "error: no packages/Cargo.toml found above $(pwd)" >&2
        echo "  Run from an SDK workspace (flake init -t …#package), or cd into it." >&2
        exit 1
      }

      NAME="''${1:-}"
      if [[ -z "$NAME" ]]; then
        echo "Usage: psidk-new <project-name>" >&2
        echo "  Creates packages/<AppName>/ (service, query-service, plugin, ui)" >&2
        exit 1
      fi
      shift || true

      echo "Generating '$NAME' into $PACKAGES_DIR (psibase $VERSION)…"
      cargo generate \
        --path "$TEMPLATES/sdk-basic-01" \
        --destination "$PACKAGES_DIR" \
        --init \
        -v \
        --allow-commands \
        --name "$NAME" \
        --define "version=$VERSION" \
        --define "description=''${PSIBASE_NEW_DESCRIPTION:-An example application}" \
        "$@"

      # Drop the init placeholder once a real app exists.
      if [[ -d "$PACKAGES_DIR/.workspace-placeholder" ]]; then
        rm -rf "$PACKAGES_DIR/.workspace-placeholder"
        if grep -q '\.workspace-placeholder' "$PACKAGES_DIR/Cargo.toml"; then
          # Portable-ish delete of that members line
          grep -v '\.workspace-placeholder' "$PACKAGES_DIR/Cargo.toml" >"$PACKAGES_DIR/Cargo.toml.tmp"
          mv "$PACKAGES_DIR/Cargo.toml.tmp" "$PACKAGES_DIR/Cargo.toml"
        fi
      fi

      CAMEL="$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')"
      echo ""
      echo "Next:"
      echo "  cd $PACKAGES_DIR/$CAMEL/ui && yarn && yarn build"
      echo "  cd $PACKAGES_DIR/$CAMEL && cargo-psibase package"
    '';
  };

  sdkPackages = with pkgs; [
    psidk
    psidkDevnet
    psidkUp
    psidkDown
    psidkNew
    rustToolchain
    cargoComponent
    cargoGenerate
    cargoEdit
    binaryen
    wabt
    wasm-pack
    wasm-tools
    nodejs20
    yarnBerry
    eslint
    prettier
    python3
    python3Packages.websockets
    python3Packages.requests
    git
    curl
    jq
    unzip
    cacert
    direnv
    mkcert
    softhsm
    vim
    bashInteractive
    bash-completion
  ];
in
pkgs.mkShell {
  name = "psibase-sdk";

  packages = sdkPackages;

  WASI_SDK_PREFIX = "${wasiSdk}";
  WASI_SDK_AR = "${wasiSdk}/bin/ar";
  WASI_SDK_RANLIB = "${wasiSdk}/bin/ranlib";

  RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
  HOST_IP = "127.0.0.1";

  # Explicit data root for tools that honor the env override; binaries also
  # resolve via $out/bin → ../share/psibase from the store path.
  PSIBASE_DATADIR = "${psidk}/share/psibase";

  shellHook = ''
    export NIX_SHELL_DEPTH=$(("''${NIX_SHELL_DEPTH:-0}" + 1))
    export IN_NIX_SHELL=1
    export SHELL="${pkgs.bashInteractive}/bin/bash"

    # psidk tools first — never monorepo build/ paths.
    export PATH="${psidk}/bin:$PATH:${wasiSdk}/bin"
    # crates.io cargo-psibase (when not in the release tarball) lands here.
    export PATH="$PATH:$HOME/.cargo/bin"

    export PSIBASE_DATADIR="${psidk}/share/psibase"
    export PSIBASE_PACKAGE_TEMPLATES="${packageTemplates}"
    export PSIBASE_CRATE_VERSION="${release.psibaseCrateVersion}"
    # Keep schema gen on the SDK train (contributor build/ psitest is often newer).
    export CARGO_PSIBASE_PSITEST="${psidk}/bin/psitest"

    export CARGO_COMPONENT_CACHE_DIR="''${CARGO_COMPONENT_CACHE_DIR:-$HOME/.cache/cargo-component}"
    export WASM_PACK_CACHE="''${WASM_PACK_CACHE:-$HOME/.cache/wasm-pack}"
    # Keep cargo-component temp + build tree on the same filesystem.
    export TMPDIR="$HOME/.cache/psibase-nix/tmp"
    mkdir -p "$TMPDIR"

    alias ll="ls -alF"
    parse_git_branch() {
      git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
    }
    export PS1="📦 \[\033[01;32m\]psibase-sdk\[\033[00m\]:\[\033[01;34m\]\w\[\033[32m\]\$(parse_git_branch)\[\033[00m\]\$ "

    if [ -n "$BASH_VERSION" ]; then
      if shopt -s progcomp 2>/dev/null && [[ -r ${pkgs.bash-completion}/share/bash-completion/bash_completion ]]; then
        source ${pkgs.bash-completion}/share/bash-completion/bash_completion
      fi
      if command -v direnv &> /dev/null; then
        eval "$(direnv hook bash)"
      fi
    fi

    # Prefer tarball cargo-psibase when the Release ships it; otherwise install
    # the crates.io build matching nix/release.nix cargoPsibaseVersion.
    _psibase_sdk_ensure_cargo_psibase() {
      local want="${release.cargoPsibaseVersion}"
      local have=""
      if [ -x "${psidk}/bin/cargo-psibase" ]; then
        return 0
      fi
      if command -v cargo-psibase >/dev/null 2>&1; then
        have="$(cargo-psibase --version 2>/dev/null | awk '{print $2}')"
        if [ "$have" = "$want" ]; then
          return 0
        fi
      fi
      echo "Installing cargo-psibase $want from crates.io (matches SDK pin)…"
      cargo install cargo-psibase --version "$want" --locked --force
    }
    _psibase_sdk_ensure_cargo_psibase

    if [ "$NIX_SHELL_DEPTH" -eq 1 ]; then
      echo ""
      echo "Psibase Package SDK (nix develop .#sdk)"
      echo "  Rust:     $(rustc --version)"
      echo "  Node:     $(node --version)"
      echo "  Yarn:     $(yarn --version)"
      echo "  WASI SDK: ${wasiSdk}"
      echo "  psibase:  $(psibase --version 2>/dev/null | head -1)"
      echo "  cargo-psibase: $(command -v cargo-psibase) ($(cargo-psibase --version 2>/dev/null || echo '?'))"
      echo "  PSIBASE_DATADIR=$PSIBASE_DATADIR"
      echo ""
      echo "  Local chain:  psidk-up   /   psidk-down   (or psidk-devnet up|down|status)"
      echo "  New app:      psidk-new <name>   (cargo-generate → packages/<App>)"
      echo "  Workspace:    nix flake init -t …#package   (see nix/sdk/README.md)"
      echo "  Docs:         nix/sdk/README.md"
      echo ""
    fi
  '';
}
