import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRequest } from "../host-interface";
import { performHttpRequest } from "./http-request";

function jsonRequest(uri: string, extra?: Partial<HttpRequest>): HttpRequest {
    return {
        uri,
        method: "POST",
        headers: [{ key: "Content-Type", value: "application/json" }],
        body: { tag: "json", val: '{"ok":true}' },
        ...extra,
    };
}

describe("performHttpRequest", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("uses fetch instead of XMLHttpRequest", async () => {
        const xhrOpen = vi.fn();
        vi.stubGlobal(
            "XMLHttpRequest",
            class {
                open = xhrOpen;
            },
        );

        const fetchMock = vi.fn(
            async (_input: string, _init?: RequestInit) => ({
                status: 200,
                headers: new Headers({ "content-type": "application/json" }),
                arrayBuffer: async () =>
                    new TextEncoder().encode('{"ok":true}').buffer,
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const raw = await performHttpRequest(
            jsonRequest("https://example.psibase.localhost/push_transaction"),
            "https://example.psibase.localhost/push_transaction",
            false,
        );

        expect(xhrOpen).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.psibase.localhost/push_transaction",
            expect.objectContaining({
                method: "POST",
                credentials: "same-origin",
            }),
        );
        expect(raw.status).toBe(200);
        expect(raw.contentType).toBe("application/json");
        expect(new TextDecoder().decode(raw.body)).toBe('{"ok":true}');
    });

    it("sends credentials when requested", async () => {
        const fetchMock = vi.fn(
            async (_input: string, _init?: RequestInit) => ({
                status: 204,
                headers: new Headers(),
                arrayBuffer: async () => new ArrayBuffer(0),
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await performHttpRequest(
            jsonRequest("https://app.psibase.localhost/common/set-auth-cookie"),
            "https://app.psibase.localhost/common/set-auth-cookie",
            true,
        );

        expect(fetchMock).toHaveBeenCalledWith(
            "https://app.psibase.localhost/common/set-auth-cookie",
            expect.objectContaining({
                credentials: "include",
            }),
        );
    });

    it("copies binary bodies out of the original buffer", async () => {
        const fetchMock = vi.fn(
            async (_input: string, _init?: RequestInit) => ({
                status: 200,
                headers: new Headers({
                    "content-type": "application/octet-stream",
                }),
                arrayBuffer: async () => new Uint8Array([9]).buffer,
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const original = new Uint8Array([1, 2, 3]);
        await performHttpRequest(
            {
                uri: "https://example.psibase.localhost/push_transaction",
                method: "POST",
                headers: [],
                body: { tag: "bytes", val: original },
            },
            "https://example.psibase.localhost/push_transaction",
            false,
        );

        const sent = fetchMock.mock.calls[0]?.[1]?.body as Uint8Array;
        expect(sent).toEqual(new Uint8Array([1, 2, 3]));
        expect(sent).not.toBe(original);
        original[0] = 99;
        expect(sent[0]).toBe(1);
    });
});
