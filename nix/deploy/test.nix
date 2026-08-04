# NixOS VM test for services.psibase (sandbox + unsigned ProdDefault boot).
# Signed/production boot is not covered (0.24 verify-sig; 0.23 expires in harness).
{
  pkgs,
  self,
}:
pkgs.testers.runNixOSTest {
  name = "psibase-node";

  nodes.machine = {...}: {
    imports = [self.nixosModules.psibase];

    services.psibase = {
      enable = true;
      host = "psibase.localhost";
      listen = 8080;
      producer = "prod";
      p2p = true;
      databaseCacheSize = "256MiB";
      softHsm = {
        enable = true;
        pinFile = "/etc/psibase-test-pin";
      };
    };

    environment.etc."psibase-test-pin".text = "1234";
    networking.hosts."127.0.0.1" = ["psibase.localhost"];

    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;
  };

  testScript = ''
    machine.wait_for_unit("psibase-softhsm-init.service")
    machine.wait_for_unit("psibase.service")
    machine.wait_for_open_port(8080)

    machine.succeed("test -n \"$(ls -A /var/lib/psibase/softhsm/tokens)\"")
    machine.fail("journalctl -u psibase-softhsm-init.service | grep -F 1234")

    machine.succeed("test -d /var/lib/psibase/db")
    machine.wait_until_succeeds("test -f /var/lib/psibase/db/config", timeout=60)
    machine.fail("journalctl -u psibase.service | grep -F 'unable to lock memory'")

    machine.succeed(
        "psibase boot -a http://psibase.localhost:8080 -p prod ProdDefault",
        timeout=900,
    )

    machine.wait_until_succeeds(
        "curl -sf -o /dev/null http://psibase.localhost:8080/",
        timeout=120,
    )

    machine.fail(
        "journalctl -u psibase.service | grep -Ei 'operation not permitted|permission denied'"
    )

    machine.succeed("systemctl restart psibase.service")
    machine.wait_for_unit("psibase.service")
    machine.wait_until_succeeds(
        "curl -sf -o /dev/null http://psibase.localhost:8080/",
        timeout=120,
    )

    machine.succeed("systemctl restart psibase-softhsm-init.service")
    machine.succeed("journalctl -u psibase-softhsm-init.service | grep -F 'already present'")
  '';
}
