import { chainScopedStorageKey } from "./chat-chain-storage";
import type { DmMessageEnvelope } from "./dm-message-history-store";
import type { GroupMessageEnvelope } from "./group-message-history-store";

/** Peers with at least one successful chat delivery in either direction (§7). */
const STORAGE_PREFIX = "pslack.deliveryOpenPeers.v1";

function storageKey(chainId: string, account: string): string {
    return chainScopedStorageKey(chainId, `${STORAGE_PREFIX}.${account}`);
}

function readPeers(chainId: string, account: string): Set<string> {
    try {
        const raw = globalThis.localStorage.getItem(storageKey(chainId, account));
        if (!raw) return new Set();
        const data = JSON.parse(raw) as unknown;
        if (!Array.isArray(data)) return new Set();
        return new Set(data.filter((v): v is string => typeof v === "string"));
    } catch {
        return new Set();
    }
}

function writePeers(chainId: string, account: string, peers: Set<string>): void {
    globalThis.localStorage.setItem(
        storageKey(chainId, account),
        JSON.stringify([...peers].sort()),
    );
}

export function isDeliveryOpenPeer(
    chainId: string,
    self: string,
    peer: string,
): boolean {
    return readPeers(chainId, self).has(peer);
}

/** Record successful delivery with `peer`. Returns true when newly opened. */
export function markDeliveryOpenPeer(
    chainId: string,
    self: string,
    peer: string,
): boolean {
    const peers = readPeers(chainId, self);
    if (peers.has(peer)) return false;
    peers.add(peer);
    writePeers(chainId, self, peers);
    return true;
}

export type InferDeliveryOpenPeersOptions = {
    /** clientMsgIds still in the pending queue (not yet confirmed delivered). */
    pendingClientMsgIds?: ReadonlySet<string>;
};

/**
 * Infer delivery-open peers from durable DM history (M3 T-020).
 * Inbound from peer, or outbound confirmed (serverMsgId or no longer pending).
 */
export function inferDeliveryOpenPeersFromHistory(
    ownerAccount: string,
    envelopes: readonly DmMessageEnvelope[],
    options?: InferDeliveryOpenPeersOptions,
): string[] {
    const pending = options?.pendingClientMsgIds ?? new Set<string>();
    const open = new Set<string>();

    for (const envelope of envelopes) {
        if (envelope.ownerAccount !== ownerAccount) continue;
        const peer = envelope.peerAccount;
        if (envelope.from === peer) {
            open.add(peer);
            continue;
        }
        if (envelope.from !== ownerAccount) continue;

        const confirmed =
            typeof envelope.serverMsgId === "number" ||
            !envelope.clientMsgId ||
            !pending.has(envelope.clientMsgId);
        if (confirmed) open.add(peer);
    }

    return [...open].sort();
}

/**
 * Merge inferred peers into delivery-open localStorage on Chat load.
 * Returns how many peers were newly opened.
 */
export function seedDeliveryOpenPeersFromHistory(
    chainId: string,
    ownerAccount: string,
    envelopes: readonly DmMessageEnvelope[],
    options?: InferDeliveryOpenPeersOptions,
): number {
    const inferred = inferDeliveryOpenPeersFromHistory(
        ownerAccount,
        envelopes,
        options,
    );
    let added = 0;
    for (const peer of inferred) {
        if (markDeliveryOpenPeer(chainId, ownerAccount, peer)) added++;
    }
    return added;
}

export type GroupSpaceMembers = {
    spaceUuid: string;
    members: readonly string[];
};

/** Peers already marked delivered on in-flight pending rows (per-peer group flush). */
export function inferDeliveryOpenPeersFromPendingDelivered(
    pendingRows: readonly { deliveredTo: readonly string[] }[],
): string[] {
    const open = new Set<string>();
    for (const row of pendingRows) {
        for (const peer of row.deliveredTo) {
            open.add(peer);
        }
    }
    return [...open].sort();
}

/**
 * Infer delivery-open peers from durable group history (M4 T-028, extends T-020).
 * Inbound from a member, or outbound confirmed (not still pending).
 */
export function inferDeliveryOpenPeersFromGroupHistory(
    ownerAccount: string,
    envelopes: readonly GroupMessageEnvelope[],
    spaces: readonly GroupSpaceMembers[],
    options?: InferDeliveryOpenPeersOptions,
): string[] {
    const pending = options?.pendingClientMsgIds ?? new Set<string>();
    const membersBySpace = new Map(
        spaces.map((space) => [space.spaceUuid, space.members]),
    );
    const open = new Set<string>();

    for (const envelope of envelopes) {
        if (envelope.ownerAccount !== ownerAccount) continue;
        const members = membersBySpace.get(envelope.spaceUuid);
        if (!members) continue;

        if (envelope.from !== ownerAccount) {
            open.add(envelope.from);
            continue;
        }

        const confirmed =
            typeof envelope.serverMsgId === "number" ||
            !envelope.clientMsgId ||
            !pending.has(envelope.clientMsgId);
        if (confirmed) {
            for (const member of members) {
                if (member !== ownerAccount) open.add(member);
            }
        }
    }

    return [...open].sort();
}

/**
 * Merge inferred group peers into delivery-open localStorage on Chat load.
 */
export function seedDeliveryOpenPeersFromGroupHistory(
    chainId: string,
    ownerAccount: string,
    envelopes: readonly GroupMessageEnvelope[],
    spaces: readonly GroupSpaceMembers[],
    options?: InferDeliveryOpenPeersOptions & {
        pendingDeliveredTo?: readonly { deliveredTo: readonly string[] }[];
    },
): number {
    const inferred = new Set([
        ...inferDeliveryOpenPeersFromGroupHistory(
            ownerAccount,
            envelopes,
            spaces,
            options,
        ),
        ...(options?.pendingDeliveredTo
            ? inferDeliveryOpenPeersFromPendingDelivered(
                  options.pendingDeliveredTo,
              )
            : []),
    ]);
    let added = 0;
    for (const peer of inferred) {
        if (markDeliveryOpenPeer(chainId, ownerAccount, peer)) added++;
    }
    return added;
}
