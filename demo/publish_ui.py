#!/usr/bin/env python3
"""Build and publish the demo UI through native Sites under exchange's account."""
import subprocess
from urllib.parse import urlsplit
from bridge import ROOT, CLI, API, push, action


def main():
    subprocess.run(["node", "build.mjs"], cwd=ROOT / "packages/user/Exchange/ui", check=True)
    subprocess.run([CLI, "upload", "-a", API, "-S", "exchange", "-r",
                    str(ROOT / "packages/user/Exchange/ui/dist"), "/"], check=True)
    # Native Supervisor owns signing and cross-app consent. No wallet server
    # or feed endpoint is granted access by this application's policy.
    supervisor = f"http://supervisor.psibase.localhost:{urlsplit(API).port or 80}"
    policy = ("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';"
              "img-src 'self' data:;font-src 'self';"
              "connect-src 'self';"
              f"frame-src {supervisor};"
              "frame-ancestors 'self';base-uri 'none';"
              "form-action 'self';object-src 'none';")
    push([action("exchange", "sites", "setCsp", {"path": "*", "csp": policy})])
    print(f"Exchange published through native Sites: http://exchange.psibase.localhost:{urlsplit(API).port or 80}/")


if __name__ == "__main__":
    main()
