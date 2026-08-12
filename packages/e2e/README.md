# @psibase/e2e

Playwright end-to-end tests for psibase. The suite runs against Chromium only.

## Prerequisites

Build psibase (or point the environment variables below at an unpacked psidk
tree). Install browser binaries once:

```bash
yarn playwright install chromium
```

### Host entry

psinode resolves peer connections to `x-peers.<domain>`, where the domain comes
from the peer URL. Peer URLs in this suite are on `psibase.test`, so add this
entry to `/etc/hosts`, pointing at the machine's routable IPv4 (not
`127.0.0.1`):

```
<routable-ipv4> x-peers.psibase.test
```

The two domains resolve by separate mechanisms, which is why they differ. The
browser reaches the UI on `psibase.localhost` and gets wildcard resolution for
`*.psibase.localhost` from `--host-resolver-rules` at launch, needing no hosts
entry: the `.localhost` suffix makes the origin a secure context, while the
rule maps it onto the routable address so admin auth is not bypassed via
loopback. psinode takes no resolver flags and goes through the system resolver,
which is entitled to short-circuit `.localhost` to loopback — so peer URLs use
`psibase.test`, where a hosts entry is authoritative.

## Environment variables

Both paths are relative to the repository root unless absolute:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PSINODE_BIN` | `build/psinode` | psinode binary |
| `PSIBASE_BIN` | `build/rust/release/psibase` | psibase CLI binary |

The config fails immediately (naming the variable) when either path is missing.
It also requires `share/psibase/packages` next to the psinode install prefix.

## Running the suite

From this directory:

```bash
yarn test
```

Artifacts (traces, videos, HTML report) are written to `test-results/`.
