// The passkey, and what is derived from it for the length of one action.
//
// Only this page, on the supervisor origin, may use the passkey. Its secret,
// the root derived from it and every owner key exist in memory while one
// action is carried out and are wiped afterwards; none of them is stored.
import {
    guestSecret,
    hexToBytes,
    prfInput,
    publicKeyHex,
    rootFrom,
} from "./account-keys";

export class Unsupported extends Error {}
export class Cancelled extends Error {}

export interface PrfResult {
    credentialId: Uint8Array;
    secret: Uint8Array;
}

type PrfExtensionResults = {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const prfExtension = () => ({ prf: { eval: { first: prfInput() } } });

const asCancelled = (e: unknown): never => {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
        throw new Cancelled();
    }
    throw e;
};

export const toB64Url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

export const fromB64Url = (text: string): Uint8Array => {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Uses a passkey this visitor already has. */
export const readPasskey = async (
    credentialId?: Uint8Array,
    immediate = false,
): Promise<PrfResult> => {
    const credential = (await navigator.credentials
        .get({
            // "immediate": show the chooser only if this device already has
            // a passkey for this site; otherwise fail at once, with no dialog.
            ...(immediate ? { uiMode: "immediate" } : {}),
            publicKey: {
                challenge: randomBytes(32),
                userVerification: "required",
                allowCredentials: credentialId
                    ? [{ type: "public-key", id: credentialId }]
                    : [],
                extensions: prfExtension(),
            } as PublicKeyCredentialRequestOptions,
        } as CredentialRequestOptions)
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();
    const ext = credential.getClientExtensionResults() as PrfExtensionResults;
    const first = ext.prf?.results?.first;
    if (!first) {
        throw new Unsupported(
            "That passkey can't produce the secret this network derives your keys from.",
        );
    }
    return {
        credentialId: new Uint8Array(credential.rawId),
        secret: new Uint8Array(first),
    };
};

/** Creates a new passkey, then reads its secret. */
export const createPasskey = async (
    rootName: string,
    onSecondTouch: () => void,
): Promise<PrfResult> => {
    const label = `Guest · ${new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    })}`;
    const credential = (await navigator.credentials
        .create({
            publicKey: {
                rp: { name: rootName },
                user: {
                    id: randomBytes(16),
                    name: `${rootName} (${label})`,
                    displayName: label,
                },
                challenge: randomBytes(32),
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 },
                    { type: "public-key", alg: -257 },
                ],
                authenticatorSelection: {
                    residentKey: "required",
                    userVerification: "required",
                },
                extensions: prfExtension(),
            } as PublicKeyCredentialCreationOptions,
        })
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();

    const ext = credential.getClientExtensionResults() as PrfExtensionResults;
    const credentialId = new Uint8Array(credential.rawId);
    const first = ext.prf?.results?.first;
    if (first) return { credentialId, secret: new Uint8Array(first) };
    if (ext.prf?.enabled === false || !ext.prf) {
        throw new Unsupported(
            "This device made a passkey, but it can't produce the secret this network derives your keys from.",
        );
    }
    // Some devices only release the secret when the passkey is used, not when
    // it is created. That takes one more confirmation.
    onSecondTouch();
    return readPasskey(credentialId);
};

/** Whether the browser can look for a passkey without showing a dialog. */
export const canLookUpSilently = async (): Promise<boolean> => {
    try {
        const caps = await (
            PublicKeyCredential as unknown as {
                getClientCapabilities?: () => Promise<Record<string, boolean>>;
            }
        ).getClientCapabilities?.();
        return caps?.immediateGet === true;
    } catch {
        return false;
    }
};

export const fetchChainId = async (): Promise<Uint8Array> => {
    const res = await fetch("/common/chainid");
    if (!res.ok) throw new Error("Could not reach the network.");
    const id = hexToBytes((await res.json()) as string);
    if (id.length !== 32) throw new Error("Unexpected network id.");
    return id;
};

/**
 * What a passkey prompt unlocks: the root every key of this passkey is
 * derived from, and the guest key. Call wipe() as soon as the action that
 * needed it is finished.
 */
export interface Unlocked {
    chainId: Uint8Array;
    root: Uint8Array;
    guest: { publicKey: string; secret: Uint8Array };
    /** Base64url id of the passkey that was used. */
    credentialId: string;
    wipe(): void;
}

export const unlockWith = async (prf: PrfResult): Promise<Unlocked> => {
    const chainId = await fetchChainId();
    const root = rootFrom(chainId, prf.secret);
    prf.secret.fill(0);
    const secret = guestSecret(chainId, root);
    return {
        chainId,
        root,
        guest: { publicKey: publicKeyHex(secret), secret },
        credentialId: toB64Url(prf.credentialId),
        wipe: () => {
            root.fill(0);
            secret.fill(0);
        },
    };
};
