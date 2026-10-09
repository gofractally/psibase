import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeviceStorage, isWebKit } from "./device-storage";

const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1";
const CHROME_DESKTOP =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const EDGE_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.67";
const CHROMIUM_DESKTOP =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/124.0.0.0 Safari/537.36";
const FIREFOX_DESKTOP =
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";

describe("isWebKit", () => {
    it("is true for Safari and iOS browsers", () => {
        expect(isWebKit(SAFARI_MAC)).toBe(true);
        expect(isWebKit(CHROME_IOS)).toBe(true);
    });

    it("is false for Chromium-based browsers and Firefox", () => {
        expect(isWebKit(CHROME_DESKTOP)).toBe(false);
        expect(isWebKit(EDGE_DESKTOP)).toBe(false);
        expect(isWebKit(CHROMIUM_DESKTOP)).toBe(false);
        expect(isWebKit(FIREFOX_DESKTOP)).toBe(false);
    });
});

describe("WebKit device storage", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function webKitStorage() {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI_MAC);
        return createDeviceStorage();
    }

    function postedBodies(): unknown[] {
        return vi
            .mocked(fetch)
            .mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    }

    it("reads the __Host- cookie", async () => {
        vi.spyOn(document, "cookie", "get").mockReturnValue(
            "other=1; __Host-HOSTDB-KEY=abc_-123",
        );
        const storage = webKitStorage();
        expect(await storage.get("HOSTDB-KEY")).toBe("abc_-123");
        expect(await storage.get("MISSING")).toBeUndefined();
    });

    it("sets and deletes through the server", async () => {
        vi.mocked(fetch).mockClear();
        const storage = webKitStorage();
        await storage.set("HOSTDB-KEY", "abc");
        await storage.delete("HOSTDB-KEY");
        expect(postedBodies()).toEqual([
            {
                name: "HOSTDB-KEY",
                value: "abc",
                maxAge: 400 * 24 * 60 * 60,
                httpOnly: false,
            },
            { name: "HOSTDB-KEY", value: "", maxAge: 0, httpOnly: false },
        ]);
    });

    it("rejects when the server refuses the cookie", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 403,
        } as Response);
        await expect(webKitStorage().set("HOSTDB-KEY", "abc")).rejects.toThrow(
            "HTTP 403",
        );
    });
});
