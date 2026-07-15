import {
    loadDurableJson,
    saveDurableJson,
} from "./chat-durable-store";

const STORAGE_SUFFIX = "psibase.historySyncPush.v1";

export type HistorySyncPushKind = "dm" | "group";

export type HistorySyncPushRecord = {
    peerAccount: string;
    spaceUuid: string;
    kind: HistorySyncPushKind;
    enqueuedAt: number;
};

function recordKey(record: HistorySyncPushRecord): string {
    return `${record.peerAccount}\0${record.spaceUuid}\0${record.kind}`;
}

export function loadHistorySyncPushQueue(
    chainId: string,
    account: string,
): HistorySyncPushRecord[] {
    return loadDurableJson<HistorySyncPushRecord>(
        chainId,
        account,
        STORAGE_SUFFIX,
    );
}

export function saveHistorySyncPushQueue(
    chainId: string,
    account: string,
    records: readonly HistorySyncPushRecord[],
): void {
    saveDurableJson(chainId, account, STORAGE_SUFFIX, records);
}

export function enqueueHistorySyncPush(
    chainId: string,
    account: string,
    record: HistorySyncPushRecord,
): void {
    const existing = loadHistorySyncPushQueue(chainId, account);
    const key = recordKey(record);
    if (existing.some((row) => recordKey(row) === key)) return;
    saveHistorySyncPushQueue(chainId, account, [...existing, record]);
}

export function dequeueHistorySyncPush(
    chainId: string,
    account: string,
    peerAccount: string,
    spaceUuid: string,
    kind: HistorySyncPushKind,
): void {
    const key = `${peerAccount}\0${spaceUuid}\0${kind}`;
    const next = loadHistorySyncPushQueue(chainId, account).filter(
        (row) => recordKey(row) !== key,
    );
    saveHistorySyncPushQueue(chainId, account, next);
}

export function historySyncPushForPeer(
    chainId: string,
    account: string,
    peerAccount: string,
): HistorySyncPushRecord[] {
    return loadHistorySyncPushQueue(chainId, account).filter(
        (row) => row.peerAccount === peerAccount,
    );
}
