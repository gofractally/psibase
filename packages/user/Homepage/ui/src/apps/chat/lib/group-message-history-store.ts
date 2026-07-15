/**
 * Client-local durable group message history.
 * IndexedDB with localStorage fallback; independent of signaling.
 * Keyed by space_uuid (not per-DM-peer). No objective message bodies.
 */

import { chainScopedStorageKey } from "./chat-chain-storage";
import { localIdForMessage } from "./dm-message-history-store";

export const GROUP_HISTORY_DB_NAME = "psibase.chat.groupHistory.v1";
export const GROUP_HISTORY_STORE_NAME = "messages";
export const GROUP_HISTORY_LS_PREFIX = "psibase.chat.groupHistory.v1";

export type GroupMessageEnvelope = {
    /** Stable local id — clientMsgId when present, else srv-{serverMsgId} or fallback. */
    localId: string;
    ownerAccount: string;
    spaceUuid: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
};

export type GroupMessageHistoryStore = {
    append: (envelope: GroupMessageEnvelope) => Promise<void>;
    listBySpace: (spaceUuid: string) => Promise<GroupMessageEnvelope[]>;
};

function envelopeSortKey(e: GroupMessageEnvelope): string {
    const pad = String(e.sendTimestamp).padStart(15, "0");
    return `${pad}:${e.localId}`;
}

/** Dedupe by localId, clientMsgId, or serverMsgId; sort ascending by sendTimestamp. */
export function mergeGroupEnvelopesBySendTimestamp(
    ...lists: readonly (readonly GroupMessageEnvelope[])[]
): GroupMessageEnvelope[] {
    const byLocalId = new Map<string, GroupMessageEnvelope>();
    const byClientMsgId = new Map<string, string>();
    const byServerMsgId = new Map<number, string>();

    const upsert = (envelope: GroupMessageEnvelope) => {
        let targetId = envelope.localId;

        if (envelope.clientMsgId) {
            const existing = byClientMsgId.get(envelope.clientMsgId);
            if (existing) targetId = existing;
        }
        if (typeof envelope.serverMsgId === "number") {
            const existing = byServerMsgId.get(envelope.serverMsgId);
            if (existing) targetId = existing;
        }

        const prev = byLocalId.get(targetId);
        const merged: GroupMessageEnvelope = prev
            ? {
                  ...prev,
                  ...envelope,
                  localId: targetId,
                  sendTimestamp: Math.min(prev.sendTimestamp, envelope.sendTimestamp),
                  clientMsgId: envelope.clientMsgId ?? prev.clientMsgId,
                  serverMsgId: envelope.serverMsgId ?? prev.serverMsgId,
              }
            : { ...envelope, localId: targetId };

        byLocalId.set(targetId, merged);
        if (merged.clientMsgId) byClientMsgId.set(merged.clientMsgId, targetId);
        if (typeof merged.serverMsgId === "number") {
            byServerMsgId.set(merged.serverMsgId, targetId);
        }
    };

    for (const list of lists) {
        for (const envelope of list) upsert(envelope);
    }

    return [...byLocalId.values()].sort((a, b) => {
        const ts = a.sendTimestamp - b.sendTimestamp;
        if (ts !== 0) return ts;
        return a.localId.localeCompare(b.localId);
    });
}

function lsKey(chainId: string, ownerAccount: string): string {
    return chainScopedStorageKey(
        chainId,
        `${GROUP_HISTORY_LS_PREFIX}.${ownerAccount}`,
    );
}

function readLocalStorage(
    chainId: string,
    ownerAccount: string,
): GroupMessageEnvelope[] {
    try {
        const raw = globalThis.localStorage.getItem(lsKey(chainId, ownerAccount));
        if (!raw) return [];
        const data = JSON.parse(raw) as unknown;
        if (!Array.isArray(data)) return [];
        return data.filter(isValidEnvelope);
    } catch {
        return [];
    }
}

function writeLocalStorage(
    chainId: string,
    ownerAccount: string,
    rows: GroupMessageEnvelope[],
): void {
    globalThis.localStorage.setItem(
        lsKey(chainId, ownerAccount),
        JSON.stringify(rows),
    );
}

function isValidEnvelope(value: unknown): value is GroupMessageEnvelope {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
        typeof row.localId === "string" &&
        typeof row.ownerAccount === "string" &&
        typeof row.spaceUuid === "string" &&
        typeof row.from === "string" &&
        typeof row.body === "string" &&
        typeof row.sendTimestamp === "number" &&
        (row.clientMsgId === undefined || typeof row.clientMsgId === "string") &&
        (row.serverMsgId === undefined || typeof row.serverMsgId === "number")
    );
}

class LocalStorageGroupHistoryStore implements GroupMessageHistoryStore {
    constructor(
        private readonly chainId: string,
        private readonly ownerAccount: string,
    ) {}

    async append(envelope: GroupMessageEnvelope): Promise<void> {
        const rows = readLocalStorage(this.chainId, this.ownerAccount);
        const merged = mergeGroupEnvelopesBySendTimestamp(rows, [envelope]);
        writeLocalStorage(this.chainId, this.ownerAccount, merged);
    }

    async listBySpace(spaceUuid: string): Promise<GroupMessageEnvelope[]> {
        return mergeGroupEnvelopesBySendTimestamp(
            readLocalStorage(this.chainId, this.ownerAccount).filter(
                (row) => row.spaceUuid === spaceUuid,
            ),
        );
    }
}

class IndexedDbGroupHistoryStore implements GroupMessageHistoryStore {
    private dbPromise: Promise<IDBDatabase> | null = null;

    constructor(
        private readonly chainId: string,
        private readonly ownerAccount: string,
    ) {}

    private dbName(): string {
        return chainScopedStorageKey(this.chainId, GROUP_HISTORY_DB_NAME);
    }

    private openDb(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName(), 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(GROUP_HISTORY_STORE_NAME)) {
                    const store = db.createObjectStore(GROUP_HISTORY_STORE_NAME, {
                        keyPath: "localId",
                    });
                    store.createIndex("ownerAccount", "ownerAccount", {
                        unique: false,
                    });
                    store.createIndex("spaceUuid", "spaceUuid", {
                        unique: false,
                    });
                    store.createIndex("sendTimestamp", "sendTimestamp", {
                        unique: false,
                    });
                    store.createIndex(
                        "ownerSpaceSend",
                        ["ownerAccount", "spaceUuid", "sendTimestamp"],
                        { unique: false },
                    );
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
        });
        return this.dbPromise;
    }

    private async readAllForOwner(): Promise<GroupMessageEnvelope[]> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GROUP_HISTORY_STORE_NAME, "readonly");
            const store = tx.objectStore(GROUP_HISTORY_STORE_NAME);
            const index = store.index("ownerAccount");
            const request = index.getAll(this.ownerAccount);
            request.onsuccess = () => {
                const rows = (request.result as unknown[]).filter(isValidEnvelope);
                resolve(mergeGroupEnvelopesBySendTimestamp(rows));
            };
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB read failed"));
        });
    }

    async append(envelope: GroupMessageEnvelope): Promise<void> {
        const db = await this.openDb();
        const existing = await this.readAllForOwner();
        const merged = mergeGroupEnvelopesBySendTimestamp(existing, [envelope]);
        const target = merged.find(
            (row) =>
                row.localId === envelope.localId ||
                (envelope.clientMsgId &&
                    row.clientMsgId === envelope.clientMsgId) ||
                (typeof envelope.serverMsgId === "number" &&
                    row.serverMsgId === envelope.serverMsgId),
        );
        const toWrite = target ?? envelope;

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(GROUP_HISTORY_STORE_NAME, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () =>
                reject(tx.error ?? new Error("IndexedDB write failed"));
            tx.objectStore(GROUP_HISTORY_STORE_NAME).put(toWrite);
        });
    }

    async listBySpace(spaceUuid: string): Promise<GroupMessageEnvelope[]> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GROUP_HISTORY_STORE_NAME, "readonly");
            const index = tx
                .objectStore(GROUP_HISTORY_STORE_NAME)
                .index("ownerSpaceSend");
            const range = IDBKeyRange.bound(
                [this.ownerAccount, spaceUuid, 0],
                [this.ownerAccount, spaceUuid, Number.MAX_SAFE_INTEGER],
            );
            const request = index.getAll(range);
            request.onsuccess = () => {
                const rows = (request.result as unknown[]).filter(isValidEnvelope);
                resolve(mergeGroupEnvelopesBySendTimestamp(rows));
            };
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB listBySpace failed"));
        });
    }
}

const storeCache = new Map<string, GroupMessageHistoryStore>();

/** Per-chain, per-account group store; prefers IndexedDB when available. */
export function getGroupMessageHistoryStore(
    chainId: string,
    ownerAccount: string,
): GroupMessageHistoryStore {
    const cacheKey = `${chainId}:${ownerAccount}`;
    const cached = storeCache.get(cacheKey);
    if (cached) return cached;

    const store =
        typeof indexedDB !== "undefined"
            ? new IndexedDbGroupHistoryStore(chainId, ownerAccount)
            : new LocalStorageGroupHistoryStore(chainId, ownerAccount);
    storeCache.set(cacheKey, store);
    return store;
}

export function buildGroupEnvelope(input: {
    ownerAccount: string;
    spaceUuid: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
    fallbackKey?: string;
}): GroupMessageEnvelope {
    return {
        localId: localIdForMessage(input),
        ownerAccount: input.ownerAccount,
        spaceUuid: input.spaceUuid,
        from: input.from,
        body: input.body,
        sendTimestamp: input.sendTimestamp,
        clientMsgId: input.clientMsgId,
        serverMsgId: input.serverMsgId,
    };
}

/** Sort key helper for tests and diagnostics. */
export function groupEnvelopeSortKeyForTest(e: GroupMessageEnvelope): string {
    return envelopeSortKey(e);
}
