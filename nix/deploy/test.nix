# NixOS VM test for services.psibase.
#
# The point of this test is the sandbox: ProtectSystem=strict, PrivateDevices
# and RestrictAddressFamilies can only fail on a running node, not at eval. It
# boots a producing node with SoftHSM enabled and asserts that psinode still
# starts, locks memory, initializes its token off-argv, and writes its database
# under dataDir.
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
      # Keep triedent's mappings inside the test VM's memory.
      databaseCacheSize = "256MiB";
      softHsm = {
        enable = true;
        pinFile = "/etc/psibase-test-pin";
      };
    };

    environment.etc."psibase-test-pin".text = "1234";

    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;
  };

  testScript = ''
    machine.wait_for_unit("psibase-softhsm-init.service")
    machine.wait_for_unit("psibase.service")
    machine.wait_for_open_port(8080)

    # Token landed in the persistent token dir rather than a sandbox tmpfs,
    # which also proves the pty-driven (non-argv) PIN handoff worked.
    machine.succeed("test -n \"$(ls -A /var/lib/psibase/softhsm/tokens)\"")

    # The PIN must never reach the journal. getpass() disables echo only once
    # reached, so anything failing earlier makes `script` copy the PIN out of
    # the pty into the log; the init unit discards that output for this reason.
    machine.fail("journalctl -u psibase-softhsm-init.service | grep -F 1234")

    # ProtectSystem=strict still lets triedent create and write the database.
    machine.succeed("test -d /var/lib/psibase/db")
    machine.wait_until_succeeds("test -f /var/lib/psibase/db/config", timeout=60)

    # LimitMEMLOCK survived the sandbox; psinode did not fall back to slow mode.
    machine.fail("journalctl -u psibase.service | grep -F 'unable to lock memory'")

    # Re-running init must detect the existing token instead of reinitializing
    # it (this is what the exact-match Label guard is protecting).
    machine.succeed("systemctl restart psibase-softhsm-init.service")
    machine.succeed("journalctl -u psibase-softhsm-init.service | grep -F 'already present'")

    # A restart of the node itself must come back cleanly.
    machine.succeed("systemctl restart psibase.service")
    machine.wait_for_unit("psibase.service")
    machine.wait_for_open_port(8080)
  '';
}
