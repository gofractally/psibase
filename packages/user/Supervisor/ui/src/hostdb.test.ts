import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64Url } from "@psibase/common-lib";

import { HttpResponse } from "./host-interface";
import { HostDb, KEEPALIVE_BODY_LIMIT, sha256Hex } from "./hostdb";

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

describe("HostDb absent keys", () => {
    it("get after 404 hits read cache without a network request", () => {
        const db = new HostDb();
        const send = vi.fn(() => httpNotFound());

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("clear drops cached absence so a subsequent get refetches", () => {
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
        vi.useRealTimers();
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

    it("retries a rejected POST with increasing delay and then succeeds", async () => {
        vi.useFakeTimers();
        fetchMock
            .mockRejectedValueOnce(new Error("network error"))
            .mockRejectedValueOnce(new Error("network error"))
            .mockResolvedValueOnce({ ok: true });
        const db = new HostDb();
        db.set(0, HEX_KEY, makeValue(8));

        const flush = db.flush();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(199);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1);
        await flush;

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const body = fetchMock.mock.calls[0][1].body;
        expect(
            fetchMock.mock.calls
                .slice(1)
                .every(([, init]) => init.body === body),
        ).toBe(true);
    });

    it("does not retry a non-OK HTTP response", async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue({ ok: false, status: 409 });
        const db = new HostDb();
        db.set(0, HEX_KEY, makeValue(8));

        const assertion = expect(db.flush()).rejects.toThrow("HTTP 409");
        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("flushAndClear clears caches when flush fails", async () => {
        vi.useFakeTimers();
        fetchMock.mockRejectedValue(new Error("network error"));
        const db = new HostDb();
        const value = makeValue(8);
        const send = vi.fn(() => httpNotFound());

        db.set(0, HEX_KEY, value);
        const assertion = expect(db.flushAndClear()).rejects.toThrow(
            "network error",
        );
        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("sends one batch op when the same key is written more than once", async () => {
        const db = new HostDb();
        const other = hexKey(2);
        const last = makeValue(3);
        db.set(0, HEX_KEY, makeValue(1));
        db.set(0, HEX_KEY, makeValue(2));
        db.remove(0, HEX_KEY);
        db.set(0, HEX_KEY, last);
        db.set(0, other, makeValue(4));
        db.set(1, HEX_KEY, makeValue(5));

        await db.flush();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.ops).toEqual([
            {
                duration: "persistent",
                key: HEX_KEY,
                value: bytesToBase64Url(last),
            },
            {
                duration: "persistent",
                key: other,
                value: bytesToBase64Url(makeValue(4)),
            },
            {
                duration: "session",
                key: HEX_KEY,
                value: bytesToBase64Url(makeValue(5)),
            },
        ]);
    });

    it("sends the SHA-256 of the GET ciphertext with the put", async () => {
        const db = new HostDb();
        const stored = makeValue(8);
        const written = makeValue(4);
        const send = vi.fn(() => httpOkBytes(stored));

        db.get(0, HEX_KEY, PLAINTEXT_KEY, send);
        db.set(0, HEX_KEY, makeValue(1));
        db.set(0, HEX_KEY, written);

        await db.flush();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.ops).toEqual([
            {
                duration: "persistent",
                key: HEX_KEY,
                value: bytesToBase64Url(written),
                expected: await sha256Hex(stored),
            },
        ]);
        expect(await sha256Hex(new Uint8Array())).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
    });

    it("sends null expected when the read missed", async () => {
        const db = new HostDb();
        const written = makeValue(4);
        const send = vi.fn(() => httpNotFound());

        expect(db.get(0, HEX_KEY, PLAINTEXT_KEY, send)).toBeNull();
        db.set(0, HEX_KEY, written);

        await db.flush();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.ops).toEqual([
            {
                duration: "persistent",
                key: HEX_KEY,
                value: bytesToBase64Url(written),
                expected: null,
            },
        ]);
    });
});
