import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64Url } from "@psibase/common-lib";

import { HttpResponse } from "./host-interface";
import { HostDb, sha256Hex } from "./hostdb";

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
        const otherValue = makeValue(4);
        const sessionValue = makeValue(5);
        db.set(0, HEX_KEY, makeValue(1));
        db.set(0, HEX_KEY, makeValue(2));
        db.remove(0, HEX_KEY);
        db.set(0, HEX_KEY, last);
        db.set(0, other, otherValue);
        db.set(1, HEX_KEY, sessionValue);

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
                value: bytesToBase64Url(otherValue),
            },
            {
                duration: "session",
                key: HEX_KEY,
                value: bytesToBase64Url(sessionValue),
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
        const expectedHash = await sha256Hex(stored);

        await db.flush();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.ops).toEqual([
            {
                duration: "persistent",
                key: HEX_KEY,
                value: bytesToBase64Url(written),
                expected: expectedHash,
            },
        ]);
    });
});
