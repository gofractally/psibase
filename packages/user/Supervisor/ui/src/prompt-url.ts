import {
    promptDetailsFromSearch,
    promptSecretsFromHash,
} from "@psibase/common-lib";

function base64ToBytes(str: string): Uint8Array {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

export function packedContextToBase64(
    packed: unknown,
): string | null {
    if (!packed) return null;
    if (typeof packed === "string") return packed;
    if (packed instanceof Uint8Array) return bytesToBase64(packed);
    if (Array.isArray(packed)) return bytesToBase64(new Uint8Array(packed));
    return null;
}

export type PromptDetailsJs = {
    promptApp: string;
    promptName: string;
    activeApp: string;
    created: string;
    packedContext: Uint8Array | null;
};

export function promptDetailsFromTopUrl(): PromptDetailsJs | null {
    try {
        const loc = window.top?.location ?? window.location;
        const parsed = promptDetailsFromSearch(loc.search);
        if (!parsed) return null;
        const secrets = promptSecretsFromHash(loc.hash);
        return {
            promptApp: parsed.promptApp,
            promptName: parsed.promptName,
            activeApp: parsed.activeApp,
            created: parsed.created || "",
            packedContext: secrets.packedContext
                ? base64ToBytes(secrets.packedContext)
                : null,
        };
    } catch {
        return null;
    }
}
