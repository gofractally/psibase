import {
    CLIENT_KEY_FROM_BASE64,
    CLIENT_KEY_TO_BASE64,
} from "./client-key-encoding";
import { DeviceStorage } from "./device-storage";

const CLIENT_KEY_NAME = "HOSTDB-KEY";

let clientKey: Uint8Array | undefined;

function generateClientKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytes.toBase64(CLIENT_KEY_TO_BASE64);
}

/**
 * Loads the client key from `storage`, generating one only when none exists,
 * and stores it back so backends whose entries expire renew it.
 */
export async function loadClientKey(storage: DeviceStorage): Promise<void> {
    const key = (await storage.get(CLIENT_KEY_NAME)) ?? generateClientKey();
    await storage.set(CLIENT_KEY_NAME, key);
    clientKey = Uint8Array.fromBase64(key, CLIENT_KEY_FROM_BASE64);
}

export function getClientKeyBytes(): Uint8Array {
    if (clientKey === undefined) {
        throw new Error("Client key is not loaded");
    }
    return clientKey;
}
