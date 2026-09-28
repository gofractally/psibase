import { siblingUrl } from "@psibase/common-lib";

export const HOSTDB_KEY_COOKIE = "__Host-HOSTDB-KEY";
const HOSTDB_KEY_NAME = "HOSTDB-KEY";
export const HOSTDB_KEY_MAX_AGE = 400 * 24 * 60 * 60;

export function bytesToBase64Url(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export function base64UrlToBytes(str: string): Uint8Array {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function getCookie(name: string): string | undefined {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return trimmed.slice(prefix.length);
        }
    }
    return undefined;
}

function generateClientKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

async function postClientKeyCookie(value: string): Promise<void> {
    const url = siblingUrl(null, "supervisor", "/common/set-cookie");
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: HOSTDB_KEY_NAME,
            value,
            maxAge: HOSTDB_KEY_MAX_AGE,
            httpOnly: false,
        }),
    });
    if (!response.ok) {
        throw new Error(
            `Failed to set HOSTDB-KEY cookie: HTTP ${response.status}`,
        );
    }
}

export async function ensureClientKeyCookie(): Promise<void> {
    const key = getCookie(HOSTDB_KEY_COOKIE) ?? generateClientKey();
    await postClientKeyCookie(key);
}

export function getClientKeyBytes(): Uint8Array {
    const key = getCookie(HOSTDB_KEY_COOKIE);
    if (key === undefined) {
        throw new Error("HOSTDB-KEY cookie is missing");
    }
    return base64UrlToBytes(key);
}
