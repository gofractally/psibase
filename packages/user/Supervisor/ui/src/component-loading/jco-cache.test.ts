import { describe, expect, it } from "vitest";

import { generateCacheKey } from "./jco-cache";

describe("generateCacheKey", () => {
    it("hashes wasm without crypto.subtle", () => {
        const subtle = globalThis.crypto?.subtle;
        if (globalThis.crypto) {
            Object.defineProperty(globalThis.crypto, "subtle", {
                value: undefined,
                configurable: true,
            });
        }
        try {
            const a = generateCacheKey(new Uint8Array([1, 2, 3]), ["i"], ["e"]);
            const b = generateCacheKey(new Uint8Array([1, 2, 3]), ["i"], ["e"]);
            const c = generateCacheKey(new Uint8Array([1, 2, 4]), ["i"], ["e"]);
            expect(a).toBe(b);
            expect(a).not.toBe(c);
        } finally {
            if (globalThis.crypto) {
                Object.defineProperty(globalThis.crypto, "subtle", {
                    value: subtle,
                    configurable: true,
                });
            }
        }
    });
});
