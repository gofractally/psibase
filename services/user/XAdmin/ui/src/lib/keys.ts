function arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function generateP256Key(): Promise<CryptoKeyPair> {
    try {
        return crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256",
            },
            true, // Extractable for exporting
            ["sign", "verify"]
        );
    } catch (error) {
        console.error("Error generating key pair:", error);
        throw error;
    }
}

export async function exportKeyToDER(
    key: CryptoKey,
    keyType: "PUBLIC KEY" | "PRIVATE KEY"
): Promise<string> {
    try {
        const exportFormat = keyType === "PUBLIC KEY" ? "spki" : "pkcs8";
        const exported = await crypto.subtle.exportKey(exportFormat, key);
        return arrayBufferToHex(exported);
    } catch (error) {
        console.error(`Error exporting ${keyType}:`, error);
        throw error;
    }
}
