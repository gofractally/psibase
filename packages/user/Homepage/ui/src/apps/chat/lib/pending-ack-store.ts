import type { ChatDataMessageAckEnvelope } from "./chat-data-envelope";
import { chainScopedStorageKey } from "./chat-chain-storage";

const PENDING_ACK_STORAGE_SUFFIX = "psibase.pendingAcks.v1";

export type PendingAckRecord = {
    remote: string;
    ack: ChatDataMessageAckEnvelope;
};

export function pendingAckStorageKey(
    chainId: string,
    account: string,
): string {
    return chainScopedStorageKey(chainId, `${PENDING_ACK_STORAGE_SUFFIX}:${account}`);
}

export function loadPendingAcks(
    chainId: string,
    account: string,
): PendingAckRecord[] {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(pendingAckStorageKey(chainId, account));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as PendingAckRecord[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function savePendingAcks(
    chainId: string,
    account: string,
    records: readonly PendingAckRecord[],
): void {
    if (typeof localStorage === "undefined") return;
    const key = pendingAckStorageKey(chainId, account);
    if (records.length === 0) {
        localStorage.removeItem(key);
        return;
    }
    localStorage.setItem(key, JSON.stringify(records));
}
