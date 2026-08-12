import dns from "node:dns/promises";
import { getRoutableIPv4 } from "./routable-address";

// psinode dials "x-peers." + the host of the peer URL, and peer URLs in this
// suite are on psibase.test. Only the browser uses psibase.localhost, and it
// resolves that name from Chromium's own --host-resolver-rules.
export const X_PEERS_HOST = "x-peers.psibase.test";

export async function assertXPeersHostResolves(): Promise<void> {
    const expected = getRoutableIPv4();
    let address: string;
    try {
        ({ address } = await dns.lookup(X_PEERS_HOST, { family: 4 }));
    } catch {
        throw new Error(
            `Required host entry missing: add "${expected} ${X_PEERS_HOST}" to /etc/hosts. ` +
                `See packages/e2e/README.md.`,
        );
    }

    if (address !== expected) {
        throw new Error(
            `${X_PEERS_HOST} resolves to ${address}, but must be ${expected} ` +
                `(this host's routable IPv4, matching Chromium's host-resolver-rules). ` +
                `Update /etc/hosts. See packages/e2e/README.md.`,
        );
    }
}
