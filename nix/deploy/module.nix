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
  # Driven through `script` (see the init unit). Keeping the label in its own
  # script avoids nesting shell quoting inside `script -c`.
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
          psibase -a http://HOST:PORT boot -p PRODUCER
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
        Raise this when large uploads (e.g. x-admin push_boot over a
        high-latency path) would otherwise be closed before the body finishes.

        Prefer null: psinode then uses `<dataDir>/db/config`, which x-admin can edit at runtime. A value set here overrides that file on every restart.
      '';
    };

    pkcs11Module = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = lib.literalExpression "\"\${pkgs.softhsm}/lib/softhsm/libsofthsm2.so\"";
      description = ''
        Path to a PKCS #11 module (psinode --pkcs11-module). When softHsm.enable
        is true, defaults to SoftHSM's libsofthsm2.so unless overridden.
      '';
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Open the listen port in the firewall.

        Usually false: psinode does not authenticate `/native/admin/`, so
        exposing the port directly publishes an unauthenticated admin API
        (push_boot, PKCS #11 key unlock). Put a reverse proxy in front.
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
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = ''
          File containing the SoftHSM user/SO PIN (single line, no trailing
          comment). Typically a sops-nix secret path. Used only to initialize
          the token once; unlock at runtime is done via x-admin.
        '';
      };

      tokenDir = lib.mkOption {
        type = lib.types.path;
        default = "${cfg.dataDir}/softhsm/tokens";
        defaultText = lib.literalExpression ''"''${config.services.psibase.dataDir}/softhsm/tokens"'';
        description = ''
          Directory for SoftHSM token storage (persistent). Defaults under
          `services.psibase.dataDir` so relocating the node state keeps tokens
          with the chain database unless you set this explicitly.
        '';
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
        if cfg.pkcs11Module != null
        then cfg.pkcs11Module
        else if cfg.softHsm.enable
        then "${softhsmPkg}/lib/softhsm/libsofthsm2.so"
        else null;

      psinodeArgs =
        [
          "${cfg.package}/bin/psinode"
          "${cfg.dataDir}/db"
          "--host"
          cfg.host
          "--listen"
          (toString cfg.listen)
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
        ++ lib.optionals (effectivePkcs11 != null) [
          "--pkcs11-module"
          effectivePkcs11
        ]
        ++ cfg.extraArgs;

      softhsmEnv = lib.optionalAttrs cfg.softHsm.enable {
        SOFTHSM2_CONF = "${softhsmConf}";
      };

      # tokenDir defaults under dataDir, but it is configurable, so list it
      # separately rather than assuming containment.
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
      # dataDir is created by tmpfiles below rather than createHome, so its mode
      # is explicit and it exists before the (sandboxed) unit starts.
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

      # dataDir must exist and be writable before psinode starts, since
      # ProtectSystem=strict makes everything outside ReadWritePaths read-only.
      # <dataDir>/db is deliberately NOT pre-created: triedent creates it (see
      # create_directories in libraries/triedent/src/database.cpp).
      #
      # SoftHSM token dir + conf live outside the store; conf content is fixed
      # in the store, tokens are mutable state under tokenDir.
      systemd.tmpfiles.rules =
        ["d ${cfg.dataDir} 0750 psibase psibase -"]
        ++ lib.optionals cfg.softHsm.enable [
          "d ${cfg.dataDir}/softhsm 0750 psibase psibase -"
          "d ${cfg.softHsm.tokenDir} 0750 psibase psibase -"
        ];

      systemd.services.psibase-softhsm-init = lib.mkIf cfg.softHsm.enable {
        description = "Initialize SoftHSM token for psibase (once)";
        # Ordering is declared once, on the consumer (psibase.service below),
        # whose `requires` also pulls this unit in.
        after = ["local-fs.target"];

        path = [pkgs.coreutils pkgs.gawk pkgs.util-linux softhsmPkg];

        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          # Root so we can read a root-owned sops pin file; token files are
          # created as the psibase user so psinode can use them.
          ExecStart = pkgs.writeShellScript "psibase-softhsm-init" ''
            set -euo pipefail
            export SOFTHSM2_CONF=${lib.escapeShellArg softhsmConf}
            mkdir -p ${lib.escapeShellArg cfg.softHsm.tokenDir}
            chown psibase:psibase ${lib.escapeShellArg cfg.softHsm.tokenDir}

            # SHELL is forced because runuser adopts the target user's login
            # shell, and psibase is a system user with nologin -- which `script`
            # would otherwise use to run the init command.
            as_psibase() {
              runuser -u psibase -- \
                env SOFTHSM2_CONF="$SOFTHSM2_CONF" PATH="$PATH" \
                    SHELL=${pkgs.runtimeShell} "$@"
            }

            # Exact match on the Label field. A substring grep over --show-slots
            # would also match a token labelled e.g.
            # "${cfg.softHsm.tokenLabel}-old", or the label appearing anywhere
            # else in the output.
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

            # softhsm2-util takes PINs either on argv (--pin/--so-pin, which is
            # world-readable through /proc/PID/cmdline for the life of this
            # oneshot) or interactively via getpass(), which insists on a tty
            # that a systemd unit does not have. `script` supplies the tty, so
            # the PIN travels on stdin instead of argv. Prompt order is
            # SO PIN, reenter, user PIN, reenter.
            #
            # Output is discarded rather than logged: getpass() disables echo
            # only once it is actually reached, so anything failing earlier
            # makes `script` copy the raw PIN from the pty straight into the
            # journal. Losing the diagnostic is the cheaper mistake.
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

          # triedent memory-maps and mlocks large regions; without this psinode
          # drops into its degraded "slow" mode (see the isSlow() warning in
          # programs/psinode/main.cpp).
          LimitMEMLOCK = "infinity";

          # Hardening. Deliberately omitted, and why:
          #   MemoryDenyWriteExecute - psinode executes WASM; W^X breaks the JIT.
          #   SystemCallFilter       - not validated against triedent's mmap/mlock
          #                            behaviour; a wrong filter is a start-time
          #                            failure on a production node.
          #   ProcSubset=pid         - hides /proc/meminfo, which cache sizing reads.
          #   PrivateUsers           - incompatible with LimitMEMLOCK above.
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
          # AF_NETLINK is required: glibc's getaddrinfo uses it for AI_ADDRCONFIG
          # when resolving p2p peer hostnames.
          RestrictAddressFamilies = ["AF_INET" "AF_INET6" "AF_UNIX" "AF_NETLINK"];
        };
      };
    }
  );
}
