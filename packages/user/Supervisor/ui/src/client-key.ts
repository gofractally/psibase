import { base64UrlToBytes, bytesToBase64Url } from "@psibase/common-lib";

import { DeviceStorage } from "./device-storage";

const CLIENT_KEY_NAME = "HOSTDB-KEY";

let clientKey: Uint8Array | undefined;

function generateClientKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

/**
 * Loads the client key from `storage`, generating one only when none exists,
 * and stores it back so backends whose entries expire renew it.
 */
export async function loadClientKey(storage: DeviceStorage): Promise<void> {
    const key = (await storage.get(CLIENT_KEY_NAME)) ?? generateClientKey();
    await storage.set(CLIENT_KEY_NAME, key);
    clientKey = base64UrlToBytes(key);
}

export function getClientKeyBytes(): Uint8Array {
    if (clientKey === undefined) {
        throw new Error("Client key is not loaded");
    }
    return clientKey;
}
