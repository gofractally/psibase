{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.psibase;
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
        "--p2p"
        "--peer"
        "https://example.com/"
        "--database-cache-size=2GiB"
      ];
      description = "Extra arguments appended to the psinode command line.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.psibase = { };
    users.users.psibase = {
      isSystemUser = true;
      group = "psibase";
      home = cfg.dataDir;
      createHome = true;
      description = "Psibase node user";
    };

    environment.systemPackages = [ cfg.package ];

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.listen ];

    systemd.services.psibase = {
      description = "Psibase node (psinode)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      serviceConfig = {
        User = "psibase";
        Group = "psibase";
        WorkingDirectory = cfg.dataDir;
        ExecStart = lib.escapeShellArgs (
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
          ++ cfg.extraArgs
        );
        Restart = "on-failure";
        RestartSec = 5;
        # triedent memory-maps large regions; without this the OOM killer or
        # mlock failures are likely.
        LimitMEMLOCK = "infinity";
        LimitCORE = "infinity";
      };
    };
  };
}
