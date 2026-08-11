{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.psibase;
  softhsmPkg = cfg.softHsm.package;
  softhsmConf = pkgs.writeText "softhsm2.conf" ''
    directories.tokendir = ${cfg.softHsm.tokenDir}
    objectstore.backend = file
    log.level = INFO
  '';
  softhsmInitToken = pkgs.writeShellScript "psibase-softhsm-init-token" ''
    exec softhsm2-util --init-token --free --label ${lib.escapeShellArg cfg.softHsm.tokenLabel}
  '';
in {
  options.services.psibase = {
    enable = lib.mkEnableOption "psibase node (psinode)";

    package = lib.mkOption {
      type = lib.types.package;
      defaultText = lib.literalExpression "inputs.psibase.packages.\${system}.psibase";
      description = ''
        Package providing `psinode`, `psibase`, and `share/psibase` data.
        Importing `inputs.psibase.nixosModules.psibase` sets this to the
        flake package by default; set it explicitly if you import
        `nix/deploy/module.nix` directly.
      '';
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/psibase";
      description = "Directory for the chain database and node state.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "psibase.localhost";
      description = "Hostname for the service HTTP interface (psinode --host).";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      example = "0.0.0.0";
      description = ''
        IP address on which psinode listens. The loopback default keeps the
        unauthenticated admin API behind a local reverse proxy. Set this to
        `0.0.0.0` only when remote access is intentional.
      '';
    };

    listen = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "HTTP listen port (psinode --listen).";
    };

    producer = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "prod";
      description = ''
        Block producer name (psinode --producer). Null means a non-producing node.
        After the service is up, boot a new chain once with:
          psibase boot -a http://HOST:PORT -p PRODUCER
        If using SoftHSM for block signing, unlock the token via x-admin after start.
      '';
    };

    p2p = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Enable p2p (psinode --p2p). Peers connect via the HTTP interface at
        x-peers.<host>/p2p (typically through your reverse proxy).
      '';
    };

    databaseCacheSize = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "2GiB";
      description = "psinode --database-cache-size (e.g. \"2GiB\"). Null uses psinode default.";
    };

    httpTimeout = lib.mkOption {
      type = lib.types.nullOr lib.types.ints.unsigned;
      default = null;
      example = 120;
      description = ''
        Idle HTTP connection timeout in seconds (psinode --http-timeout).
        Null uses `<dataDir>/db/config` (editable via x-admin). A value set
        here overrides that file on every restart.
      '';
    };

    pkcs11Modules = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [];
      example = lib.literalExpression "[\"\${pkgs.softhsm}/lib/softhsm/libsofthsm2.so\"]";
      description = ''
        Paths to PKCS #11 modules (psinode --pkcs11-module, repeatable). When
        softHsm.enable is true, defaults to SoftHSM's libsofthsm2.so unless
        overridden.
      '';
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Open the listen port in the firewall. Usually false: put a reverse
        proxy in front. To accept remote connections directly, also set
        `listenAddress` to `0.0.0.0`.
      '';
    };

    extraArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      example = [
        "--peer"
        "https://example.com/"
      ];
      description = "Extra arguments appended to the psinode command line.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      example = {
        PSIBASE_USERNAME_FIELD = "X-Auth-User";
      };
      description = "Environment variables for the psinode service.";
    };

    softHsm = {
      enable = lib.mkEnableOption "SoftHSM2 token for psinode PKCS #11 block signing";

      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.softhsm;
        defaultText = lib.literalExpression "pkgs.softhsm";
        description = "SoftHSM2 package.";
      };

      pinFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "/run/secrets/softhsm_pin";
        description = ''
          Absolute runtime path to the SoftHSM PIN file (single line).
          Typically `config.sops.secrets.<name>.path`. Do not use a Nix path
          literal (`./pin.txt`); that copies the secret into the store.
          Used only to initialize the token; unlock at runtime via x-admin.
        '';
      };

      tokenDir = lib.mkOption {
        type = lib.types.path;
        default = "${cfg.dataDir}/softhsm/tokens";
        defaultText = lib.literalExpression ''"''${config.services.psibase.dataDir}/softhsm/tokens"'';
        description = "Directory for SoftHSM token storage.";
      };

      tokenLabel = lib.mkOption {
        type = lib.types.str;
        default = "psibase";
        description = "Label for the SoftHSM token (softhsm2-util --label).";
      };
    };
  };

  config = lib.mkIf cfg.enable (
    let
      effectivePkcs11 =
        if cfg.pkcs11Modules != []
        then cfg.pkcs11Modules
        else lib.optional cfg.softHsm.enable "${softhsmPkg}/lib/softhsm/libsofthsm2.so";

      listenEndpoint = let
        address =
          if lib.hasInfix ":" cfg.listenAddress && !lib.hasPrefix "[" cfg.listenAddress
          then "[${cfg.listenAddress}]"
          else cfg.listenAddress;
      in "${address}:${toString cfg.listen}";

      psinodeArgs =
        [
          "${cfg.package}/bin/psinode"
          "${cfg.dataDir}/db"
          "--host"
          cfg.host
          "--listen"
          listenEndpoint
        ]
        ++ lib.optionals (cfg.producer != null) [
          "--producer"
          cfg.producer
        ]
        ++ lib.optionals cfg.p2p ["--p2p"]
        ++ lib.optionals (cfg.databaseCacheSize != null) [
          "--database-cache-size"
          cfg.databaseCacheSize
        ]
        ++ lib.optionals (cfg.httpTimeout != null) [
          "--http-timeout"
          (toString cfg.httpTimeout)
        ]
        ++ lib.concatMap (module: ["--pkcs11-module" module]) effectivePkcs11
        ++ cfg.extraArgs;

      softhsmEnv = lib.optionalAttrs cfg.softHsm.enable {
        SOFTHSM2_CONF = "${softhsmConf}";
      };

      readWritePaths = lib.unique (
        [cfg.dataDir]
        ++ lib.optional cfg.softHsm.enable cfg.softHsm.tokenDir
      );
    in {
      assertions = [
        {
          assertion = !cfg.softHsm.enable || cfg.softHsm.pinFile != null;
          message = "services.psibase.softHsm.pinFile must be set when softHsm.enable is true";
        }
      ];

      users.groups.psibase = {};
      users.users.psibase = {
        isSystemUser = true;
        group = "psibase";
        home = cfg.dataDir;
        description = "Psibase node user";
      };

      environment.systemPackages =
        [cfg.package]
        ++ lib.optionals cfg.softHsm.enable [
          softhsmPkg
        ];

      networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [cfg.listen];

      # <dataDir>/db is created by triedent, not tmpfiles.
      systemd.tmpfiles.rules =
        ["d ${cfg.dataDir} 0750 psibase psibase -"]
        ++ lib.optionals cfg.softHsm.enable [
          "d ${cfg.dataDir}/softhsm 0750 psibase psibase -"
          "d ${cfg.softHsm.tokenDir} 0750 psibase psibase -"
        ];

      systemd.services.psibase-softhsm-init = lib.mkIf cfg.softHsm.enable {
        description = "Initialize SoftHSM token for psibase (once)";
        after = ["local-fs.target"];

        path = [pkgs.coreutils pkgs.gawk pkgs.util-linux softhsmPkg];

        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          # Root: read root-owned sops pin; create tokens as psibase.
          ExecStart = pkgs.writeShellScript "psibase-softhsm-init" ''
            set -euo pipefail
            export SOFTHSM2_CONF=${lib.escapeShellArg softhsmConf}
            mkdir -p ${lib.escapeShellArg cfg.softHsm.tokenDir}
            chown psibase:psibase ${lib.escapeShellArg cfg.softHsm.tokenDir}

            # psibase is nologin; script needs a real shell.
            as_psibase() {
              runuser -u psibase -- \
                env SOFTHSM2_CONF="$SOFTHSM2_CONF" PATH="$PATH" \
                    SHELL=${pkgs.runtimeShell} "$@"
            }

            if as_psibase softhsm2-util --show-slots 2>/dev/null \
              | awk -v want=${lib.escapeShellArg cfg.softHsm.tokenLabel} '
                  /^[[:space:]]*Label:/ {
                    sub(/^[[:space:]]*Label:[[:space:]]*/, "")
                    sub(/[[:space:]]+$/, "")
                    if ($0 == want) found = 1
                  }
                  END { exit !found }
                '; then
              echo "SoftHSM token '${cfg.softHsm.tokenLabel}' already present"
              exit 0
            fi

            pin=$(tr -d '\n' < ${lib.escapeShellArg cfg.softHsm.pinFile})
            if [ -z "$pin" ]; then
              echo "SoftHSM PIN file is empty: ${cfg.softHsm.pinFile}" >&2
              exit 1
            fi

            # PIN via stdin+pty (not argv). Discard output: failures can leak PIN.
            if ! printf '%s\n%s\n%s\n%s\n' "$pin" "$pin" "$pin" "$pin" \
              | as_psibase timeout 60 script -qec ${softhsmInitToken} /dev/null \
                  >/dev/null 2>&1; then
              echo "softhsm2-util --init-token failed; output suppressed because" >&2
              echo "it can contain the PIN. Re-run by hand to diagnose." >&2
              exit 1
            fi

            echo "Initialized SoftHSM token '${cfg.softHsm.tokenLabel}'"
          '';
        };
      };

      systemd.services.psibase = {
        description = "Psibase node (psinode)";
        wantedBy = ["multi-user.target"];
        after = ["network-online.target"] ++ lib.optionals cfg.softHsm.enable ["psibase-softhsm-init.service"];
        wants = ["network-online.target"];
        requires = lib.optionals cfg.softHsm.enable ["psibase-softhsm-init.service"];

        environment = cfg.environment // softhsmEnv;

        serviceConfig = {
          User = "psibase";
          Group = "psibase";
          WorkingDirectory = cfg.dataDir;
          ExecStart = lib.escapeShellArgs psinodeArgs;
          Restart = "on-failure";
          RestartSec = 5;

          LimitMEMLOCK = "infinity";

          ProtectSystem = "strict";
          ProtectHome = true;
          ReadWritePaths = readWritePaths;
          PrivateTmp = true;
          PrivateDevices = true;
          ProtectProc = "invisible";
          NoNewPrivileges = true;
          ProtectClock = true;
          ProtectHostname = true;
          ProtectKernelLogs = true;
          ProtectKernelModules = true;
          ProtectKernelTunables = true;
          ProtectControlGroups = true;
          RestrictNamespaces = true;
          RestrictRealtime = true;
          RestrictSUIDSGID = true;
          LockPersonality = true;
          # AF_NETLINK: getaddrinfo (AI_ADDRCONFIG) for peer hostnames.
          RestrictAddressFamilies = ["AF_INET" "AF_INET6" "AF_UNIX" "AF_NETLINK"];
        };
      };
    }
  );
}
