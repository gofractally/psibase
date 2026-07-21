{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.psibase;
  softhsmPkg = cfg.softHsm.package;
  softhsmConf = pkgs.writeText "softhsm2.conf" ''
    directories.tokendir = ${cfg.softHsm.tokenDir}
    objectstore.backend = file
    log.level = INFO
  '';
in
{
  options.services.psibase = {
    enable = lib.mkEnableOption "psibase node (psinode)";

    package = lib.mkOption {
      type = lib.types.package;
      defaultText = lib.literalExpression "inputs.psibase.packages.\${system}.psibase";
      description = ''
        Package providing `psinode`, `psibase`, and `share/psibase` data.
        Importing `inputs.psibase.nixosModules.psibase` sets this to the
        flake package by default; set it explicitly if you import
        `nix/module.nix` directly.
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
      description = "Open the listen port in the firewall.";
    };

    extraArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "--peer"
        "https://example.com/"
      ];
      description = "Extra arguments appended to the psinode command line.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
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
        default = "/var/lib/psibase/softhsm/tokens";
        description = "Directory for SoftHSM token storage (persistent).";
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
        if cfg.pkcs11Module != null then
          cfg.pkcs11Module
        else if cfg.softHsm.enable then
          "${softhsmPkg}/lib/softhsm/libsofthsm2.so"
        else
          null;

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
        ++ lib.optionals cfg.p2p [ "--p2p" ]
        ++ lib.optionals (cfg.databaseCacheSize != null) [
          "--database-cache-size"
          cfg.databaseCacheSize
        ]
        ++ lib.optionals (effectivePkcs11 != null) [
          "--pkcs11-module"
          effectivePkcs11
        ]
        ++ cfg.extraArgs;

      softhsmEnv = lib.optionalAttrs cfg.softHsm.enable {
        SOFTHSM2_CONF = "${softhsmConf}";
      };
    in
    {
      assertions = [
        {
          assertion = !cfg.softHsm.enable || cfg.softHsm.pinFile != null;
          message = "services.psibase.softHsm.pinFile must be set when softHsm.enable is true";
        }
      ];

      users.groups.psibase = { };
      users.users.psibase = {
        isSystemUser = true;
        group = "psibase";
        home = cfg.dataDir;
        createHome = true;
        description = "Psibase node user";
      };

      environment.systemPackages =
        [ cfg.package ]
        ++ lib.optionals cfg.softHsm.enable [
          softhsmPkg
        ];

      networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.listen ];

      # SoftHSM token dir + conf live outside the store; conf content is fixed
      # in the store, tokens are mutable state under tokenDir.
      systemd.tmpfiles.rules = lib.optionals cfg.softHsm.enable [
        "d ${cfg.dataDir}/softhsm 0750 psibase psibase -"
        "d ${cfg.softHsm.tokenDir} 0750 psibase psibase -"
      ];

      systemd.services.psibase-softhsm-init = lib.mkIf cfg.softHsm.enable {
        description = "Initialize SoftHSM token for psibase (once)";
        wantedBy = [ "multi-user.target" ];
        before = [ "psibase.service" ];
        requiredBy = [ "psibase.service" ];
        after = [ "local-fs.target" ];

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

            run_util() {
              ${pkgs.util-linux}/bin/runuser -u psibase -- \
                env SOFTHSM2_CONF="$SOFTHSM2_CONF" \
                ${softhsmPkg}/bin/softhsm2-util "$@"
            }

            if run_util --show-slots 2>/dev/null \
              | grep -F -q ${lib.escapeShellArg cfg.softHsm.tokenLabel}; then
              echo "SoftHSM token '${cfg.softHsm.tokenLabel}' already present"
              exit 0
            fi

            pin=$(tr -d '\n' < ${lib.escapeShellArg cfg.softHsm.pinFile})
            if [ -z "$pin" ]; then
              echo "SoftHSM PIN file is empty: ${cfg.softHsm.pinFile}" >&2
              exit 1
            fi

            run_util \
              --init-token \
              --free \
              --label ${lib.escapeShellArg cfg.softHsm.tokenLabel} \
              --pin "$pin" \
              --so-pin "$pin"

            echo "Initialized SoftHSM token '${cfg.softHsm.tokenLabel}'"
          '';
        };
      };

      systemd.services.psibase = {
        description = "Psibase node (psinode)";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ] ++ lib.optionals cfg.softHsm.enable [ "psibase-softhsm-init.service" ];
        wants = [ "network-online.target" ];
        requires = lib.optionals cfg.softHsm.enable [ "psibase-softhsm-init.service" ];

        environment = cfg.environment // softhsmEnv;

        serviceConfig = {
          User = "psibase";
          Group = "psibase";
          WorkingDirectory = cfg.dataDir;
          ExecStart = lib.escapeShellArgs psinodeArgs;
          Restart = "on-failure";
          RestartSec = 5;
          # triedent memory-maps large regions; without this the OOM killer or
          # mlock failures are likely.
          LimitMEMLOCK = "infinity";
          LimitCORE = "infinity";
        };
      };
    }
  );
}
