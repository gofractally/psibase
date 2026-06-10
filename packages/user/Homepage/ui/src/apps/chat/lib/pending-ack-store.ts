import type { ChatDataMessageAckEnvelope } from "./chat-data-envelope";
import { loadDurableJson, saveDurableJson } from "./chat-durable-store";

const STORAGE_SUFFIX = "psibase.pendingAcks.v1";

export type PendingAckRecord = {
    remote: string;
    ack: ChatDataMessageAckEnvelope;
};

export function pendingAckStorageKey(
    chainId: string,
    account: string,
): string {
    return `${chainId}:${STORAGE_SUFFIX}:${account}`;
}

export function loadPendingAcks(
    chainId: string,
    account: string,
): PendingAckRecord[] {
    return loadDurableJson<PendingAckRecord>(chainId, account, STORAGE_SUFFIX);
}

export function savePendingAcks(
    chainId: string,
    account: string,
    records: readonly PendingAckRecord[],
): void {
    saveDurableJson(chainId, account, STORAGE_SUFFIX, records);
}
