import { DeviceStorage } from "./device-storage";

const CLIENT_KEY_NAME = "HOSTDB-KEY";

const CLIENT_KEY_BASE64URL = { alphabet: "base64url" } as const;

let clientKey: Uint8Array | undefined;

/**
 * Loads the client key from `storage`, generating one only when none exists,
 * and stores it back so backends whose entries expire renew it.
 */
export async function loadClientKey(storage: DeviceStorage): Promise<void> {
    const stored = await storage.get(CLIENT_KEY_NAME);
    let key: string;
    if (stored !== undefined) {
        key = stored;
        clientKey = Uint8Array.fromBase64(key, CLIENT_KEY_BASE64URL);
    } else {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        clientKey = bytes;
        key = bytes.toBase64({
            ...CLIENT_KEY_BASE64URL,
            omitPadding: true,
        });
    }
    await storage.set(CLIENT_KEY_NAME, key);
}

export function getClientKeyBytes(): Uint8Array {
    if (clientKey === undefined) {
        throw new Error("Client key is not loaded");
    }
    return clientKey;
}
