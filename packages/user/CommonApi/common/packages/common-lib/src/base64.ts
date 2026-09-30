function bytesToBinaryString(bytes: Uint8Array): string {
    const chunkSize = 0x8000;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return parts.join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
    return btoa(bytesToBinaryString(bytes));
}

export function base64ToBytes(str: string): Uint8Array {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function normalizeBase64Url(str: string): string {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    return pad ? base64 + "=".repeat(4 - pad) : base64;
}

export function base64UrlToBytes(str: string): Uint8Array {
    return base64ToBytes(normalizeBase64Url(str));
}
