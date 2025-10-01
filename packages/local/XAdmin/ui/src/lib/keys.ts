function arrayBufferToHex(buffer: ArrayBuffer, separator: string = ""): string {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(separator);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
    const length = hex.length / 2;
    const buffer = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
        buffer[i] = parseInt(hex.substr(i * 2, 2), 16);
    }

    return buffer.buffer;
}

export async function hexDERPublicKeyToCryptoKey(
    hexDER: string,
): Promise<CryptoKey> {
    try {
        const derBuffer = hexToArrayBuffer(hexDER);
        const publicKey = await crypto.subtle.importKey(
            "spki", // for public keys
            derBuffer,
            {
                name: "ECDSA",
                namedCurve: "P-256",
            },
            true,
            ["verify"],
        );
        return publicKey;
    } catch (error) {
        console.error("Error importing public key:", error);
        throw error;
    }
}

export async function exportKeyToDER(
    key: CryptoKey,
    keyType: "PUBLIC KEY" | "PRIVATE KEY",
): Promise<string> {
    try {
        const exportFormat = keyType === "PUBLIC KEY" ? "spki" : "pkcs8";
        const exported = await crypto.subtle.exportKey(exportFormat, key);
        return arrayBufferToHex(exported);
    } catch (error) {
        console.error(`Error exporting ${keyType} to DER format:`, error);
        throw error;
    }
}

export async function exportKeyToPEM(
    key: CryptoKey,
    keyType: "PUBLIC KEY" | "PRIVATE KEY",
) {
    try {
        const exportFormat = keyType === "PUBLIC KEY" ? "spki" : "pkcs8";
        const exportedKey = await crypto.subtle.exportKey(exportFormat, key);
        const base64Key = arrayBufferToBase64(exportedKey);
        const pemKey = `-----BEGIN ${keyType}-----\n${base64Key
            .match(/.{1,64}/g)
            ?.join("\n")}\n-----END ${keyType}-----`;
        return pemKey;
    } catch (error) {
        console.error(`Error exporting ${keyType} to PEM format:`, error);
        throw error;
    }
}

export async function calculateKeyFingerprint(hexDER: string): Promise<string> {
    const derBuffer = hexToArrayBuffer(hexDER);
    const hashBuffer = await crypto.subtle.digest("SHA-256", derBuffer);
    return arrayBufferToHex(hashBuffer, ":");
}
