import {
    durableStorageKey,
    loadDurableJson,
    saveDurableJson,
} from "./chat-durable-store";

const STORAGE_SUFFIX = "psibase.inboundAcceptance.v1";

export type InboundAcceptanceRecord = {
    remote: string;
    spaceUuid: string;
    clientMsgId: string;
    from: string;
    body: string;
    sendTimestamp: number;
    receivedAt: number;
};

export function inboundAcceptanceStorageKey(
    chainId: string,
    account: string,
): string {
    return durableStorageKey(chainId, account, STORAGE_SUFFIX);
}

function recordKey(record: InboundAcceptanceRecord): string {
    return `${record.remote}\0${record.spaceUuid}\0${record.clientMsgId}`;
}

export function loadInboundAcceptanceQueue(
    chainId: string,
    account: string,
): InboundAcceptanceRecord[] {
    return loadDurableJson<InboundAcceptanceRecord>(
        chainId,
        account,
        STORAGE_SUFFIX,
    );
}

export function saveInboundAcceptanceQueue(
    chainId: string,
    account: string,
    records: readonly InboundAcceptanceRecord[],
): void {
    saveDurableJson(chainId, account, STORAGE_SUFFIX, records);
}

export function enqueueInboundAcceptance(
    chainId: string,
    account: string,
    record: InboundAcceptanceRecord,
): void {
    const existing = loadInboundAcceptanceQueue(chainId, account);
    const key = recordKey(record);
    if (existing.some((row) => recordKey(row) === key)) return;
    saveInboundAcceptanceQueue(chainId, account, [...existing, record]);
}

export function dequeueInboundAcceptance(
    chainId: string,
    account: string,
    remote: string,
    spaceUuid: string,
    clientMsgId: string,
): void {
    const key = `${remote}\0${spaceUuid}\0${clientMsgId}`;
    const next = loadInboundAcceptanceQueue(chainId, account).filter(
        (row) => recordKey(row) !== key,
    );
    saveInboundAcceptanceQueue(chainId, account, next);
}

export function clearInboundAcceptanceQueue(
    chainId: string,
    account: string,
): InboundAcceptanceRecord[] {
    const records = loadInboundAcceptanceQueue(chainId, account);
    saveInboundAcceptanceQueue(chainId, account, []);
    return records;
}
