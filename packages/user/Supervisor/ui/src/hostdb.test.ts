import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostDb } from "./hostdb";

const HEX_KEY = "a".repeat(64);

function hexKey(n: number): string {
    return n.toString(16).padStart(64, "0");
}

function makeValue(size: number): Uint8Array {
    return new Uint8Array(size).fill(0xab);
}

describe("HostDb negative cache", () => {
    it("returns null after clear without a second network request", () => {
        const db = new HostDb();
        const send = vi.fn(() => ({ status: 404 }));

        expect(db.get(0, HEX_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);

        db.clear();

        expect(db.get(0, HEX_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("set invalidates negative cache so get after clear reads the written value", () => {
        const db = new HostDb();
        const value = makeValue(8);
        const send = vi.fn(() => {
            if (send.mock.calls.length === 1) {
                return { status: 404 };
            }
            return { status: 200, body: { val: value } };
        });

        expect(db.get(0, HEX_KEY, send)).toBeNull();
        db.set(0, HEX_KEY, value);
        db.clear();

        expect(db.get(0, HEX_KEY, send)).toEqual(value);
        expect(send).toHaveBeenCalledTimes(2);
    });
});

describe("HostDb flush", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("splits large queues into multiple batches with keepalive only on the last", async () => {
        const db = new HostDb();
        const valueSize = 2000;
        const numOps = 40;
        for (let i = 0; i < numOps; i++) {
            db.set(0, hexKey(i), makeValue(valueSize));
        }

        await db.flush();

        expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

        const batchCalls = fetchMock.mock.calls.filter(
            (call) =>
                typeof call[0] === "string" &&
                call[0].includes("/kv/batch"),
        );
        expect(batchCalls.length).toBeGreaterThan(1);

        for (let i = 0; i < batchCalls.length; i++) {
            const init = batchCalls[i][1] as RequestInit;
            const isLast = i === batchCalls.length - 1;
            if (isLast) {
                expect(init.keepalive).toBe(true);
            } else {
                expect(init.keepalive).toBeUndefined();
            }
            const body = init.body as string;
            expect(body.length).toBeLessThanOrEqual(64 * 1024);
        }
    });

    it("flushes a single op near the service max value", async () => {
        const db = new HostDb();
        // 100 KB plaintext + 12-byte nonce + 16-byte GCM tag.
        db.set(0, HEX_KEY, makeValue(100 * 1024 + 28));

        await db.flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.keepalive).toBeUndefined();
        expect((init.body as string).length).toBeGreaterThan(64 * 1024);
    });
});
