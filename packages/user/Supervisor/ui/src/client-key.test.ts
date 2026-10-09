import { describe, expect, it } from "vitest";

import { CLIENT_KEY_FROM_BASE64 } from "./client-key-encoding";
import { getClientKeyBytes, loadClientKey } from "./client-key";
import { DeviceStorage } from "./device-storage";

function memoryStorage(initial: Record<string, string> = {}) {
    const entries = new Map(Object.entries(initial));
    const storage: DeviceStorage = {
        get: async (name) => entries.get(name),
        set: async (name, value) => {
            entries.set(name, value);
        },
        delete: async (name) => {
            entries.delete(name);
        },
    };
    return { entries, storage };
}

describe("loadClientKey", () => {
    it("generates and stores a 32-byte key when none exists", async () => {
        const { entries, storage } = memoryStorage();
        await loadClientKey(storage);
        expect(entries.get("HOSTDB-KEY")).toBeTruthy();
        expect(getClientKeyBytes()).toHaveLength(32);
    });

    it("keeps an existing key", async () => {
        const existing = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
        const { entries, storage } = memoryStorage({ "HOSTDB-KEY": existing });
        await loadClientKey(storage);
        expect(entries.get("HOSTDB-KEY")).toBe(existing);
        expect(getClientKeyBytes()).toEqual(
            Uint8Array.fromBase64(existing, CLIENT_KEY_FROM_BASE64),
        );
    });
});
