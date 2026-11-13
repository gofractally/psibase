import { DeviceStorage } from "./device-storage";

const CLIENT_KEY_NAME = "HOSTDB-KEY";
const CLIENT_KEY_LOCK = "hostdb-client-key";

const CLIENT_KEY_BASE64URL = { alphabet: "base64url" } as const;

let clientKey: Uint8Array | undefined;

/**
 * Loads the client key from `storage`, generating one only when none exists,
 * and writes it back so backends whose entries expire renew it. A failed
 * renewal does not fail this call. A new key is stored before this call
 * resolves.
 */
export async function loadClientKey(storage: DeviceStorage): Promise<void> {
    await navigator.locks.request(CLIENT_KEY_LOCK, async () => {
        const stored = await storage.get(CLIENT_KEY_NAME);
        if (stored !== undefined) {
            clientKey = Uint8Array.fromBase64(stored, CLIENT_KEY_BASE64URL);
            await storage.set(CLIENT_KEY_NAME, stored).catch((err) => {
                console.error("Failed to renew client key:", err);
            });
            return;
        }

        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        clientKey = bytes;
        const key = bytes.toBase64({
            ...CLIENT_KEY_BASE64URL,
            omitPadding: true,
        });
        await storage.set(CLIENT_KEY_NAME, key);
    });
}

export function getClientKeyBytes(): Uint8Array {
    if (clientKey === undefined) {
        throw new Error("Client key is not loaded");
    }
    return clientKey;
}
