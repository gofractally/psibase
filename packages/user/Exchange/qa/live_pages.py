#!/usr/bin/env python3
"""Read-only pagination/authority smoke checks against the local demo."""
from pathlib import Path
import json
import subprocess
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[4]
BUILD = ROOT / "build-exchange-pagination"
RESULT = {"public": {}, "private": {}, "denials": {}, "cors": {}}


def call(path, auth=None, method="GET", origin=None):
    headers = {"Host": "exchange.psibase.localhost:8089"}
    if auth:
        headers["Authorization"] = auth
    if origin:
        headers["Origin"] = origin
    request = urllib.request.Request("http://127.0.0.1:8089" + path,
                                     headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, dict(response.headers), json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), json.loads(error.read() or b"null")


def pages(path, field, auth=None, limit=2):
    after, rows, seen, requests = None, [], set(), 0
    while True:
        status, headers, page = call(path + f"&limit={limit}" +
            ("&after=" + str(after) if after else ""), auth)
        assert status == 200, (path, status, page)
        if auth:
            assert headers.get("Cache-Control") == "no-store"
        assert len(page[field]) <= limit
        rows.extend(page[field])
        requests += 1
        after = page.get("next_after")
        if after is None:
            break
        assert after not in seen
        seen.add(after)
        assert requests < 300
    return rows, requests


def main():
    markets, requests = pages("/markets?", "markets", limit=1)
    assert len(markets) > 1
    RESULT["public"]["markets"] = {"rows": len(markets), "requests": requests}
    last = markets[-1]["id"]
    status, _, point = call("/market?market=" + str(last))
    assert status == 200 and str(point["market"]["id"]) == str(last)
    for side in ["true", "false"]:
        rows, requests = pages("/book?market=1&bid=" + side, "levels")
        assert all(set(row) == {"market", "bid", "price", "outgoing", "active"} for row in rows)
        RESULT["public"]["book_" + side] = {"rows": len(rows), "requests": requests}
    login = subprocess.run([str(BUILD / "bin/psibase"), "login", "-a",
                            "http://psibase.localhost:8089/", "alice"],
                           text=True, capture_output=True, check=True)
    auth = login.stdout.strip()
    assert auth.lower().startswith("bearer ")
    auth = "Bearer " + auth.split(" ", 1)[1]
    # Do not persist or print credentials or private balance values.
    rows, requests = pages("/assets?", "balances", auth)
    RESULT["private"]["assets"] = {"rows": len(rows), "requests": requests}
    for kind in ["orders", "loans", "lenders", "liquidity"]:
        rows, requests = pages("/positions?kind=" + kind, "rows", auth)
        assert all(row["owner"] == "alice" for row in rows)
        RESULT["private"][kind] = {"rows": len(rows), "requests": requests}
    status, _, scope = call("/snapshot?market=" + str(last), auth)
    assert status == 200 and scope["owner"] == "alice"
    assert scope["balance_scope"] == "selected-market-points"
    assert scope["asset_page_included"] is False and len(scope["balances"]) == 2
    for path in ["/positions?kind=orders", "/assets", "/asset?token=1", "/funding?tokens=1"]:
        assert call(path)[0] == 403
        sep = "&" if "?" in path else "?"
        assert call(path + sep + "owner=bob", auth)[0] == 403
        RESULT["denials"][path] = 403
    origin = "http://supervisor.psibase.localhost:8089"
    for method in ["OPTIONS", "GET"]:
        status, headers, _ = call("/positions?kind=orders", auth if method == "GET" else None,
                                  method, origin=origin)
        assert status == (200 if method == "GET" else 204)
        assert headers.get("Access-Control-Allow-Origin") == origin
        assert headers.get("Access-Control-Allow-Credentials") == "true"
        RESULT["cors"][method] = status
    assert call("/positions?kind=orders&limit=201", auth)[0] == 400
    assert call("/positions?kind=orders&limit=1&limit=2", auth)[0] == 400
    (BUILD / "live-pages.json").write_text(json.dumps(RESULT, indent=2) + "\n")
    print(json.dumps(RESULT, indent=2))


if __name__ == "__main__":
    main()
