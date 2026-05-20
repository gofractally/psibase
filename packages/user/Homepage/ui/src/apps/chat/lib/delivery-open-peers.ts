/** Peers with at least one successful chat delivery in either direction (§7). */
const STORAGE_PREFIX = "pslack.deliveryOpenPeers.v1";

function storageKey(account: string): string {
    return `${STORAGE_PREFIX}.${account}`;
}

function readPeers(account: string): Set<string> {
    try {
        const raw = globalThis.localStorage.getItem(storageKey(account));
        if (!raw) return new Set();
        const data = JSON.parse(raw) as unknown;
        if (!Array.isArray(data)) return new Set();
        return new Set(data.filter((v): v is string => typeof v === "string"));
    } catch {
        return new Set();
    }
}

function writePeers(account: string, peers: Set<string>): void {
    globalThis.localStorage.setItem(
        storageKey(account),
        JSON.stringify([...peers].sort()),
    );
}

export function isDeliveryOpenPeer(self: string, peer: string): boolean {
    return readPeers(self).has(peer);
}

/** Record successful delivery with `peer`. Returns true when newly opened. */
export function markDeliveryOpenPeer(self: string, peer: string): boolean {
    const peers = readPeers(self);
    if (peers.has(peer)) return false;
    peers.add(peer);
    writePeers(self, peers);
    return true;
}
