# NixOS VM test for services.psibase.
#
# The point of this test is the sandbox: ProtectSystem=strict, PrivateDevices
# and RestrictAddressFamilies can only fail on a running node, not at eval. It
# boots a producing node with SoftHSM and p2p enabled, then boots an actual
# chain so that WASM execution -- the reason MemoryDenyWriteExecute is not set
# -- is exercised rather than assumed.
#
# Not covered: a boot that supplies a block signing key. That is broken in
# 0.24.0-pre and would make this check permanently red. Reproduce with:
#
#   openssl ecparam -name prime256v1 -genkey -noout -out k.pem
#   openssl ec -in k.pem -pubout -out pub.pem
#   psibase boot -a http://psibase.localhost:8080 -p prod --block-key pub.pem ProdDefault
#   => service 'producers' aborted with message: Unknown service account: verify-sig
#
# Restore this once upstream fixes it -- it is the path x-admin's production
# boot uses, so it matters more than the unsigned boot exercised below.
{
  pkgs,
  self,
}:
pkgs.testers.runNixOSTest {
  name = "psibase-node";

  nodes.machine = {pkgs, ...}: {
    imports = [self.nixosModules.psibase];

    # To generate a block signing key for the signed boot path.
    environment.systemPackages = [pkgs.openssl];

    services.psibase = {
      enable = true;
      host = "psibase.localhost";
      listen = 8080;
      producer = "prod";
      # Exercises RestrictAddressFamilies, including the AF_NETLINK that
      # glibc's getaddrinfo needs to resolve peers.
      p2p = true;
      databaseCacheSize = "256MiB";
      softHsm = {
        enable = true;
        pinFile = "/etc/psibase-test-pin";
      };
    };

    environment.etc."psibase-test-pin".text = "1234";

    # psinode routes on the Host header, so the CLI has to reach it by name.
    networking.hosts."127.0.0.1" = ["psibase.localhost"];

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

    # Boot a real chain. This pushes the default package set through
    # native/admin/push_boot and executes WASM services, so it is the only part
    # of the test that exercises the JIT under the systemd sandbox.
    # ProdDefault rather than the default set: it is what a real deployment
    # installs ("production-ready apps, secure authentication"), so it exercises
    # more of what this module is for. Note this is still an *unsigned* boot --
    # see the note below about the signed path.
    # A *signed* boot with a block signing key -- the path x-admin's production
    # boot uses, and the one 0.24.0-pre breaks (see header). Booting unsigned
    # would not exercise it.
    machine.succeed("openssl ecparam -name prime256v1 -genkey -noout -out /tmp/k.pem")
    machine.succeed("openssl ec -in /tmp/k.pem -pubout -out /tmp/pub.pem")
    machine.succeed(
        "psibase boot -a http://psibase.localhost:8080 -p prod --block-key /tmp/pub.pem ProdDefault",
        timeout=900,
    )

    # A 200 from the root means a WASM service actually ran and served it.
    machine.wait_until_succeeds(
        "curl -sf -o /dev/null http://psibase.localhost:8080/",
        timeout=120,
    )

    # Catch sandbox denials that psinode logs but survives.
    machine.fail(
        "journalctl -u psibase.service | grep -Ei 'operation not permitted|permission denied'"
    )

    # The chain must survive a restart: database persisted under dataDir, and
    # the JIT still works on the second run.
    machine.succeed("systemctl restart psibase.service")
    machine.wait_for_unit("psibase.service")
    machine.wait_until_succeeds(
        "curl -sf -o /dev/null http://psibase.localhost:8080/",
        timeout=120,
    )

    # Re-running init must detect the existing token instead of reinitializing
    # it (this is what the exact-match Label guard is protecting).
    machine.succeed("systemctl restart psibase-softhsm-init.service")
    machine.succeed("journalctl -u psibase-softhsm-init.service | grep -F 'already present'")
  '';
}
