/**
 * Client-local durable DM message history.
 * IndexedDB with localStorage fallback; independent of signaling.
 * Keys are scoped by chain id (Host bucket / Supervisor localStorage convention).
 */

import { chainScopedStorageKey } from "./chat-chain-storage";

export const DM_HISTORY_DB_NAME = "psibase.chat.dmHistory.v1";
export const DM_HISTORY_STORE_NAME = "messages";
export const DM_HISTORY_LS_PREFIX = "psibase.chat.dmHistory.v1";

export type DmMessageEnvelope = {
    /** Stable local id — clientMsgId when present, else srv-{serverMsgId}. */
    localId: string;
    ownerAccount: string;
    spaceUuid: string;
    peerAccount: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
};

export type DmMessageHistoryStore = {
    append: (envelope: DmMessageEnvelope) => Promise<void>;
    listBySpace: (spaceUuid: string) => Promise<DmMessageEnvelope[]>;
    listByPeer: (peerAccount: string) => Promise<DmMessageEnvelope[]>;
};

export function localIdForMessage(input: {
    clientMsgId?: string;
    serverMsgId?: number;
    fallbackKey?: string;
}): string {
    if (input.clientMsgId) return input.clientMsgId;
    if (typeof input.serverMsgId === "number") {
        return `srv-${input.serverMsgId}`;
    }
    if (input.fallbackKey) return input.fallbackKey;
    return crypto.randomUUID();
}

function envelopeSortKey(e: DmMessageEnvelope): string {
    const pad = String(e.sendTimestamp).padStart(15, "0");
    return `${pad}:${e.localId}`;
}

/** Dedupe by localId, clientMsgId, or serverMsgId; sort ascending by sendTimestamp. */
export function mergeEnvelopesBySendTimestamp(
    ...lists: readonly (readonly DmMessageEnvelope[])[]
): DmMessageEnvelope[] {
    const byLocalId = new Map<string, DmMessageEnvelope>();
    const byClientMsgId = new Map<string, string>();
    const byServerMsgId = new Map<number, string>();

    const upsert = (envelope: DmMessageEnvelope) => {
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
        const merged: DmMessageEnvelope = prev
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
        `${DM_HISTORY_LS_PREFIX}.${ownerAccount}`,
    );
}

function readLocalStorage(
    chainId: string,
    ownerAccount: string,
): DmMessageEnvelope[] {
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
    rows: DmMessageEnvelope[],
): void {
    globalThis.localStorage.setItem(
        lsKey(chainId, ownerAccount),
        JSON.stringify(rows),
    );
}

function isValidEnvelope(value: unknown): value is DmMessageEnvelope {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
        typeof row.localId === "string" &&
        typeof row.ownerAccount === "string" &&
        typeof row.spaceUuid === "string" &&
        typeof row.peerAccount === "string" &&
        typeof row.from === "string" &&
        typeof row.body === "string" &&
        typeof row.sendTimestamp === "number" &&
        (row.clientMsgId === undefined || typeof row.clientMsgId === "string") &&
        (row.serverMsgId === undefined || typeof row.serverMsgId === "number")
    );
}

class LocalStorageDmHistoryStore implements DmMessageHistoryStore {
    constructor(
        private readonly chainId: string,
        private readonly ownerAccount: string,
    ) {}

    async append(envelope: DmMessageEnvelope): Promise<void> {
        const rows = readLocalStorage(this.chainId, this.ownerAccount);
        const merged = mergeEnvelopesBySendTimestamp(rows, [envelope]);
        writeLocalStorage(this.chainId, this.ownerAccount, merged);
    }

    async listBySpace(spaceUuid: string): Promise<DmMessageEnvelope[]> {
        return mergeEnvelopesBySendTimestamp(
            readLocalStorage(this.chainId, this.ownerAccount).filter(
                (row) => row.spaceUuid === spaceUuid,
            ),
        );
    }

    async listByPeer(peerAccount: string): Promise<DmMessageEnvelope[]> {
        return mergeEnvelopesBySendTimestamp(
            readLocalStorage(this.chainId, this.ownerAccount).filter(
                (row) => row.peerAccount === peerAccount,
            ),
        );
    }
}

class IndexedDbDmHistoryStore implements DmMessageHistoryStore {
    private dbPromise: Promise<IDBDatabase> | null = null;

    constructor(
        private readonly chainId: string,
        private readonly ownerAccount: string,
    ) {}

    private dbName(): string {
        return chainScopedStorageKey(this.chainId, DM_HISTORY_DB_NAME);
    }

    private openDb(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName(), 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(DM_HISTORY_STORE_NAME)) {
                    const store = db.createObjectStore(DM_HISTORY_STORE_NAME, {
                        keyPath: "localId",
                    });
                    store.createIndex("ownerAccount", "ownerAccount", {
                        unique: false,
                    });
                    store.createIndex("spaceUuid", "spaceUuid", {
                        unique: false,
                    });
                    store.createIndex("peerAccount", "peerAccount", {
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
                    store.createIndex(
                        "ownerPeerSend",
                        ["ownerAccount", "peerAccount", "sendTimestamp"],
                        { unique: false },
                    );
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
        });
        return this.dbPromise;
    }

    private async readAllForOwner(): Promise<DmMessageEnvelope[]> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DM_HISTORY_STORE_NAME, "readonly");
            const store = tx.objectStore(DM_HISTORY_STORE_NAME);
            const index = store.index("ownerAccount");
            const request = index.getAll(this.ownerAccount);
            request.onsuccess = () => {
                const rows = (request.result as unknown[]).filter(isValidEnvelope);
                resolve(mergeEnvelopesBySendTimestamp(rows));
            };
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB read failed"));
        });
    }

    async append(envelope: DmMessageEnvelope): Promise<void> {
        const db = await this.openDb();
        const existing = await this.readAllForOwner();
        const merged = mergeEnvelopesBySendTimestamp(existing, [envelope]);
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
            const tx = db.transaction(DM_HISTORY_STORE_NAME, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () =>
                reject(tx.error ?? new Error("IndexedDB write failed"));
            tx.objectStore(DM_HISTORY_STORE_NAME).put(toWrite);
        });
    }

    async listBySpace(spaceUuid: string): Promise<DmMessageEnvelope[]> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DM_HISTORY_STORE_NAME, "readonly");
            const index = tx
                .objectStore(DM_HISTORY_STORE_NAME)
                .index("ownerSpaceSend");
            const range = IDBKeyRange.bound(
                [this.ownerAccount, spaceUuid, 0],
                [this.ownerAccount, spaceUuid, Number.MAX_SAFE_INTEGER],
            );
            const request = index.getAll(range);
            request.onsuccess = () => {
                const rows = (request.result as unknown[]).filter(isValidEnvelope);
                resolve(mergeEnvelopesBySendTimestamp(rows));
            };
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB listBySpace failed"));
        });
    }

    async listByPeer(peerAccount: string): Promise<DmMessageEnvelope[]> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DM_HISTORY_STORE_NAME, "readonly");
            const index = tx
                .objectStore(DM_HISTORY_STORE_NAME)
                .index("ownerPeerSend");
            const range = IDBKeyRange.bound(
                [this.ownerAccount, peerAccount, 0],
                [this.ownerAccount, peerAccount, Number.MAX_SAFE_INTEGER],
            );
            const request = index.getAll(range);
            request.onsuccess = () => {
                const rows = (request.result as unknown[]).filter(isValidEnvelope);
                resolve(mergeEnvelopesBySendTimestamp(rows));
            };
            request.onerror = () =>
                reject(request.error ?? new Error("IndexedDB listByPeer failed"));
        });
    }
}

const storeCache = new Map<string, DmMessageHistoryStore>();

/** Per-chain, per-account store; prefers IndexedDB when available. */
export function getDmMessageHistoryStore(
    chainId: string,
    ownerAccount: string,
): DmMessageHistoryStore {
    const cacheKey = `${chainId}:${ownerAccount}`;
    const cached = storeCache.get(cacheKey);
    if (cached) return cached;

    const store =
        typeof indexedDB !== "undefined"
            ? new IndexedDbDmHistoryStore(chainId, ownerAccount)
            : new LocalStorageDmHistoryStore(chainId, ownerAccount);
    storeCache.set(cacheKey, store);
    return store;
}

export function dmPeerAccount(
    members: readonly string[],
    selfAccount: string,
): string | null {
    if (members.length !== 2) return null;
    return members.find((member) => member !== selfAccount) ?? null;
}

export function buildDmEnvelope(input: {
    ownerAccount: string;
    spaceUuid: string;
    peerAccount: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
    fallbackKey?: string;
}): DmMessageEnvelope {
    return {
        localId: localIdForMessage(input),
        ownerAccount: input.ownerAccount,
        spaceUuid: input.spaceUuid,
        peerAccount: input.peerAccount,
        from: input.from,
        body: input.body,
        sendTimestamp: input.sendTimestamp,
        clientMsgId: input.clientMsgId,
        serverMsgId: input.serverMsgId,
    };
}

/** Sort key helper for tests and diagnostics. */
export function envelopeSortKeyForTest(e: DmMessageEnvelope): string {
    return envelopeSortKey(e);
}
