/**
 * Plan C tests: pending-message-store extraction (C1), schema migration
 * framework (C2), and quota recovery (C4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    PENDING_MESSAGE_MAX_ATTEMPTS,
    PENDING_MESSAGE_SCHEMA_VERSION,
    clearPendingMessages,
    expirePendingMessages,
    isQuotaExceededError,
    loadPendingMessages,
    migratePendingMessages,
    nextRetryDelayMs,
    parsePendingMessages,
    pendingStorageKey,
    recordSendAttempt,
    savePendingMessages,
    savePendingMessagesWithQuotaRecovery,
    type PendingChatMessage,
} from "./pending-message-store";

const CHAIN = "chain-test";
const ALICE = "alice";

function makeRow(
    overrides: Partial<PendingChatMessage> = {},
): PendingChatMessage {
    return {
        clientMsgId: overrides.clientMsgId ?? "msg-1",
        conversationId: overrides.conversationId ?? "conv:dm:alice|bob",
        from: overrides.from ?? ALICE,
        body: overrides.body ?? "hello",
        createdAt: overrides.createdAt ?? 1_000,
        recipients: overrides.recipients ?? ["bob"],
        deliveredTo: overrides.deliveredTo ?? [],
        status: overrides.status ?? "pending",
        errorReason: overrides.errorReason,
        attempts: overrides.attempts,
        lastAttemptAt: overrides.lastAttemptAt,
        expireAfter: overrides.expireAfter,
    };
}

class FakeStorage implements Storage {
    private map = new Map<string, string>();
    private failOnSet: ((value: string) => Error | null) | null = null;

    setFailOnSet(fn: ((value: string) => Error | null) | null) {
        this.failOnSet = fn;
    }

    get length(): number {
        return this.map.size;
    }
    clear(): void {
        this.map.clear();
    }
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    key(index: number): string | null {
        return [...this.map.keys()][index] ?? null;
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
    setItem(key: string, value: string): void {
        if (this.failOnSet) {
            const err = this.failOnSet(value);
            if (err) throw err;
        }
        this.map.set(key, value);
    }
}

let originalLocalStorage: Storage;
let fake: FakeStorage;

beforeEach(() => {
    fake = new FakeStorage();
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: fake,
    });
});

afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
    });
});

describe("pendingStorageKey", () => {
    it("scopes the key by chain id and account", () => {
        const a = pendingStorageKey("chainA", "alice");
        const b = pendingStorageKey("chainB", "alice");
        const c = pendingStorageKey("chainA", "bob");
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(a).toContain("alice");
    });
});

describe("parsePendingMessages — v1 legacy form", () => {
    it("accepts a flat array of rows (v1 shape)", () => {
        const v1Raw = JSON.stringify([
            {
                clientMsgId: "m1",
                conversationId: "c1",
                from: ALICE,
                body: "hi",
                createdAt: 100,
                recipients: ["bob"],
                deliveredTo: [],
                status: "pending",
            },
        ]);
        const parsed = parsePendingMessages(v1Raw);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]!.clientMsgId).toBe("m1");
        expect(parsed[0]!.attempts).toBe(0);
    });

    it("returns empty for malformed JSON", () => {
        expect(parsePendingMessages("garbage")).toEqual([]);
        expect(parsePendingMessages(null)).toEqual([]);
    });

    it("filters out invalid rows", () => {
        const raw = JSON.stringify([
            { clientMsgId: 123, conversationId: "c1" },
            {
                clientMsgId: "ok",
                conversationId: "c1",
                from: ALICE,
                body: "x",
                createdAt: 1,
                recipients: ["bob"],
                deliveredTo: [],
                status: "pending",
            },
        ]);
        const parsed = parsePendingMessages(raw);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]!.clientMsgId).toBe("ok");
    });

    it("dedupes recipients/deliveredTo arrays", () => {
        const raw = JSON.stringify([
            {
                clientMsgId: "m",
                conversationId: "c",
                from: ALICE,
                body: "x",
                createdAt: 1,
                recipients: ["bob", "bob", "carol"],
                deliveredTo: ["bob", "bob"],
                status: "pending",
            },
        ]);
        const parsed = parsePendingMessages(raw);
        expect(parsed[0]!.recipients).toEqual(["bob", "carol"]);
        expect(parsed[0]!.deliveredTo).toEqual(["bob"]);
    });
});

describe("parsePendingMessages — v2 versioned envelope", () => {
    it("reads { v: 2, rows: [...] }", () => {
        const v2Raw = JSON.stringify({
            v: 2,
            rows: [
                {
                    clientMsgId: "m2",
                    conversationId: "c1",
                    from: ALICE,
                    body: "v2",
                    createdAt: 200,
                    recipients: ["bob"],
                    deliveredTo: [],
                    status: "pending",
                    attempts: 3,
                    lastAttemptAt: 1_500,
                    expireAfter: 60_000,
                },
            ],
        });
        const parsed = parsePendingMessages(v2Raw);
        expect(parsed[0]!.attempts).toBe(3);
        expect(parsed[0]!.lastAttemptAt).toBe(1_500);
        expect(parsed[0]!.expireAfter).toBe(60_000);
    });

    it("tolerates unknown future versions", () => {
        const futureRaw = JSON.stringify({
            v: 99,
            rows: [
                {
                    clientMsgId: "future",
                    conversationId: "c",
                    from: ALICE,
                    body: "x",
                    createdAt: 1,
                    recipients: ["bob"],
                    deliveredTo: [],
                    status: "pending",
                },
            ],
        });
        const parsed = parsePendingMessages(futureRaw);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]!.clientMsgId).toBe("future");
    });
});

describe("migratePendingMessages", () => {
    it("v1 -> current adds default attempts", () => {
        const v1Row = makeRow({ attempts: undefined });
        const migrated = migratePendingMessages([v1Row], 1);
        expect(migrated[0]!.attempts).toBe(0);
    });

    it("preserves existing v2 fields", () => {
        const v2Row = makeRow({
            attempts: 4,
            lastAttemptAt: 5_000,
            expireAfter: 10_000,
        });
        const migrated = migratePendingMessages([v2Row], 2);
        expect(migrated[0]!.attempts).toBe(4);
        expect(migrated[0]!.lastAttemptAt).toBe(5_000);
        expect(migrated[0]!.expireAfter).toBe(10_000);
    });
});

describe("loadPendingMessages / savePendingMessages round-trip", () => {
    it("writes and reads a v2 envelope", () => {
        const row = makeRow({ attempts: 2, lastAttemptAt: 7_000 });
        const result = savePendingMessages(CHAIN, ALICE, [row]);
        expect(result.ok).toBe(true);
        const reloaded = loadPendingMessages(CHAIN, ALICE);
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0]!.clientMsgId).toBe("msg-1");
        expect(reloaded[0]!.attempts).toBe(2);
    });

    it("omits 'sent' rows from persistence", () => {
        const sent = makeRow({
            clientMsgId: "sent",
            status: "sent" as PendingChatMessage["status"],
        });
        const pending = makeRow({ clientMsgId: "pending" });
        savePendingMessages(CHAIN, ALICE, [sent, pending]);
        const reloaded = loadPendingMessages(CHAIN, ALICE);
        expect(reloaded.map((r) => r.clientMsgId)).toEqual(["pending"]);
    });

    it("loadPendingMessages handles missing keys", () => {
        expect(loadPendingMessages(CHAIN, "nobody")).toEqual([]);
    });

    it("clearPendingMessages removes the entry", () => {
        savePendingMessages(CHAIN, ALICE, [makeRow()]);
        clearPendingMessages(CHAIN, ALICE);
        expect(loadPendingMessages(CHAIN, ALICE)).toEqual([]);
    });

    it("envelope embeds the current schema version", () => {
        savePendingMessages(CHAIN, ALICE, [makeRow()]);
        const raw = fake.getItem(pendingStorageKey(CHAIN, ALICE))!;
        const parsed = JSON.parse(raw) as { v: number };
        expect(parsed.v).toBe(PENDING_MESSAGE_SCHEMA_VERSION);
    });

    it("legacy v1 payload is migrated on load", () => {
        const legacy = [
            {
                clientMsgId: "legacy",
                conversationId: "c",
                from: ALICE,
                body: "x",
                createdAt: 1,
                recipients: ["bob"],
                deliveredTo: [],
                status: "pending",
            },
        ];
        fake.setItem(pendingStorageKey(CHAIN, ALICE), JSON.stringify(legacy));
        const reloaded = loadPendingMessages(CHAIN, ALICE);
        expect(reloaded[0]!.attempts).toBe(0);
    });
});

describe("isQuotaExceededError", () => {
    it("recognizes QuotaExceededError by name", () => {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        expect(isQuotaExceededError(err)).toBe(true);
    });

    it("recognizes legacy code 22", () => {
        expect(isQuotaExceededError({ code: 22 })).toBe(true);
    });

    it("rejects unrelated errors", () => {
        expect(isQuotaExceededError(new TypeError("boom"))).toBe(false);
        expect(isQuotaExceededError(null)).toBe(false);
    });
});

describe("savePendingMessagesWithQuotaRecovery", () => {
    it("returns ok with no promotions on a clean save", () => {
        const result = savePendingMessagesWithQuotaRecovery(CHAIN, ALICE, [
            makeRow(),
        ]);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.promoted).toEqual([]);
    });

    it("reports non-quota errors without promoting", () => {
        const ioErr = new TypeError("disk gone");
        fake.setFailOnSet(() => ioErr);
        const onError = vi.fn();
        const result = savePendingMessagesWithQuotaRecovery(
            CHAIN,
            ALICE,
            [makeRow()],
            { onWriteError: onError },
        );
        expect(result.ok).toBe(false);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "io" }),
        );
    });

    it("promotes oldest pending rows on QuotaExceededError and retries", () => {
        let throwOnce = true;
        fake.setFailOnSet(() => {
            if (!throwOnce) return null;
            throwOnce = false;
            const err = new Error("quota");
            err.name = "QuotaExceededError";
            return err;
        });
        const onError = vi.fn();
        const rows = [
            makeRow({ clientMsgId: "old", createdAt: 100 }),
            makeRow({ clientMsgId: "mid", createdAt: 500 }),
            makeRow({ clientMsgId: "new", createdAt: 900 }),
            makeRow({ clientMsgId: "newest", createdAt: 1_000 }),
        ];
        const result = savePendingMessagesWithQuotaRecovery(
            CHAIN,
            ALICE,
            rows,
            { onWriteError: onError },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.promoted.length).toBeGreaterThan(0);
            expect(result.promoted[0]!.status).toBe("failed");
            expect(result.promoted[0]!.clientMsgId).toBe("old");
            expect(result.promoted[0]!.errorReason).toMatch(/quota/);
        }
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "quota-exceeded" }),
        );
    });

    it("propagates the second failure if quota is still exceeded", () => {
        fake.setFailOnSet(() => {
            const err = new Error("quota");
            err.name = "QuotaExceededError";
            return err;
        });
        const result = savePendingMessagesWithQuotaRecovery(CHAIN, ALICE, [
            makeRow(),
        ]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe("quota-exceeded");
        }
    });
});

describe("expirePendingMessages", () => {
    it("promotes rows past their TTL to failed", () => {
        const row = makeRow({ expireAfter: 50 });
        const out = expirePendingMessages([row], 100);
        expect(out.expired).toHaveLength(1);
        expect(out.rows[0]!.status).toBe("failed");
    });

    it("leaves rows without TTL untouched", () => {
        const row = makeRow();
        const out = expirePendingMessages([row], 999_999);
        expect(out.expired).toEqual([]);
        expect(out.rows[0]!.status).toBe("pending");
    });

    it("ignores already-failed rows", () => {
        const row = makeRow({ status: "failed", expireAfter: 10 });
        const out = expirePendingMessages([row], 100);
        expect(out.expired).toEqual([]);
    });
});

describe("recordSendAttempt + retry policy", () => {
    it("increments attempts and stamps lastAttemptAt", () => {
        const r = recordSendAttempt(makeRow({ attempts: 2 }), 1_000);
        expect(r.attempts).toBe(3);
        expect(r.lastAttemptAt).toBe(1_000);
        expect(r.status).toBe("pending");
    });

    it("promotes to failed once attempts cap is reached", () => {
        const r = recordSendAttempt(
            makeRow({ attempts: PENDING_MESSAGE_MAX_ATTEMPTS - 1 }),
            5_000,
        );
        expect(r.attempts).toBe(PENDING_MESSAGE_MAX_ATTEMPTS);
        expect(r.status).toBe("failed");
        expect(r.errorReason).toMatch(/exceeded/);
    });

    it("nextRetryDelayMs grows exponentially and caps", () => {
        expect(nextRetryDelayMs(0)).toBe(0);
        expect(nextRetryDelayMs(1)).toBe(1_000);
        expect(nextRetryDelayMs(2)).toBe(2_000);
        expect(nextRetryDelayMs(3)).toBe(4_000);
        expect(nextRetryDelayMs(20)).toBe(5 * 60_000);
    });
});
