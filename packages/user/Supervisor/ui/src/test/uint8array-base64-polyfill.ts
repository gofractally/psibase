import { Buffer } from "node:buffer";

function polyfillToBase64(
    this: Uint8Array,
    options?: Uint8ArrayToBase64Options,
): string {
    const alphabet = options?.alphabet ?? "base64";
    const encoding = alphabet === "base64url" ? "base64url" : "base64";
    let encoded = Buffer.from(this).toString(encoding);
    if (alphabet === "base64url" && options?.omitPadding) {
        encoded = encoded.replace(/=+$/, "");
    }
    return encoded;
}

function polyfillFromBase64(
    base64: string,
    options?: Uint8ArrayFromBase64Options,
): Uint8Array {
    const alphabet = options?.alphabet ?? "base64";
    const encoding = alphabet === "base64url" ? "base64url" : "base64";
    return new Uint8Array(Buffer.from(base64, encoding));
}

export function installUint8ArrayBase64Polyfill(): void {
    if (typeof Uint8Array.fromBase64 !== "function") {
        Uint8Array.fromBase64 = polyfillFromBase64;
    }
    if (typeof Uint8Array.prototype.toBase64 !== "function") {
        Uint8Array.prototype.toBase64 = polyfillToBase64;
    }
}
