#!/usr/bin/env python3
"""Build and publish the demo UI through native Sites under exchange's account."""
import subprocess
from bridge import ROOT, CLI, API, push, action


def main():
    subprocess.run(["node", "build.mjs"], cwd=ROOT / "packages/user/Exchange/ui", check=True)
    subprocess.run([CLI, "upload", "-a", API, "-S", "exchange", "-r",
                    str(ROOT / "packages/user/Exchange/ui/dist"), "/"], check=True)
    # Native Supervisor owns signing and cross-app consent. No wallet server
    # or feed endpoint is granted access by this application's policy.
    policy = ("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';"
              "img-src 'self' data:;font-src 'self';"
              "connect-src 'self';"
              "frame-src http://supervisor.psibase.localhost:8089;"
              "frame-ancestors 'self';base-uri 'none';"
              "form-action 'self';object-src 'none';")
    push([action("exchange", "sites", "setCsp", {"path": "*", "csp": policy})])
    print("Exchange published through native Sites: http://exchange.psibase.localhost:8089/")


if __name__ == "__main__":
    main()
