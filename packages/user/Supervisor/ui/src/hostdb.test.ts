import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpResponse } from "./host-interface";
import { HostDb, KEEPALIVE_BODY_LIMIT } from "./hostdb";

const HEX_KEY = "a".repeat(64);
const PLAINTEXT_KEY = "non-trx:accounts:contacts:alice";

function hexKey(n: number): string {
    return n.toString(16).padStart(64, "0");
}

function makeValue(size: number): Uint8Array {
    return new Uint8Array(size).fill(0xab);
}

function httpNotFound(): HttpResponse {
    return { status: 404, headers: [], body: null };
}

function httpOkBytes(value: Uint8Array): HttpResponse {
    return {
        status: 200,
        headers: [],
        body: { tag: "bytes", val: value },
    };
}

describe("HostDb cache", () => {
    it("get after set hits positive cache without a network request", () => {
        const db = new HostDb();
        const value = makeValue(8);
        const send = vi.fn(() => httpNotFound());

        db.set(0, HEX_KEY, value);
        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toEqual(value);
        expect(send).not.toHaveBeenCalled();
    });
});

describe("HostDb negative cache", () => {
    it("clear resets negative cache so a subsequent get refetches", () => {
        const db = new HostDb();
        const send = vi.fn(() => httpNotFound());

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);

        db.clear();

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("get after clear refetches from the node and returns the stored value", () => {
        const db = new HostDb();
        const value = makeValue(8);
        const send = vi.fn((): HttpResponse => {
            if (send.mock.calls.length === 1) {
                return httpNotFound();
            }
            return httpOkBytes(value);
        });

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        db.clear();

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toEqual(value);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("names the plaintext key when a read misses", () => {
        const db = new HostDb();
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const send = vi.fn(() => httpNotFound());

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(info).toHaveBeenCalledWith(
            `host:db missing key: ${PLAINTEXT_KEY}`,
        );
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                uri: expect.not.stringContaining(PLAINTEXT_KEY),
                method: "GET",
                headers: [
                    { key: "Accept", value: "application/octet-stream" },
                ],
            }),
        );

        info.mockRestore();
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

    it("issues one POST with keepalive for a small queue", async () => {
        const db = new HostDb();
        db.set(0, HEX_KEY, makeValue(8));

        await db.flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.keepalive).toBe(true);
        expect((init.body as string).length).toBeLessThanOrEqual(
            KEEPALIVE_BODY_LIMIT,
        );
    });

    it("issues one POST and omits keepalive over the limit", async () => {
        const db = new HostDb();
        const valueSize = 2000;
        const numOps = 40;
        for (let i = 0; i < numOps; i++) {
            db.set(0, hexKey(i), makeValue(valueSize));
        }

        await db.flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.keepalive).toBeUndefined();
        expect((init.body as string).length).toBeGreaterThan(
            KEEPALIVE_BODY_LIMIT,
        );
    });

    it("flushAndClear clears caches when flush fails", async () => {
        fetchMock.mockRejectedValueOnce(new Error("network error"));
        const db = new HostDb();
        const value = makeValue(8);
        const send = vi.fn(() => httpNotFound());

        db.set(0, HEX_KEY, value);
        await expect(db.flushAndClear()).rejects.toThrow("network error");

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });
});
