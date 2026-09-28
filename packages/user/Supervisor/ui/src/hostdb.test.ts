import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostDb } from "./hostdb";

const HEX_KEY = "a".repeat(64);

function hexKey(n: number): string {
    return n.toString(16).padStart(64, "0");
}

function makeValue(size: number): Uint8Array {
    return new Uint8Array(size).fill(0xab);
}

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
