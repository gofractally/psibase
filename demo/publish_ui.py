#!/usr/bin/env python3
"""Build and publish the demo UI through native Sites under exchange's account."""
import subprocess
from bridge import ROOT, CLI, API, PORT, push, action


def main():
    subprocess.run(["node", "build.mjs"], cwd=ROOT / "packages/user/Exchange/ui", check=True)
    subprocess.run([CLI, "upload", "-a", API, "-S", "exchange", "-r",
                    str(ROOT / "packages/user/Exchange/ui/dist"), "/"], check=True)
    # A local-development exception for the separate wallet adapter. It is
    # deliberately not installed as a production package's content policy.
    policy = ("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';"
              "img-src 'self' data:;font-src 'self';"
              f"connect-src 'self' http://127.0.0.1:{PORT};"
              "frame-src 'self';frame-ancestors 'self';base-uri 'none';"
              "form-action 'self';object-src 'none';")
    push([action("exchange", "sites", "setCsp", {"path": "*", "csp": policy})])
    print("Exchange published through native Sites: http://exchange.psibase.localhost:8089/")


if __name__ == "__main__":
    main()
