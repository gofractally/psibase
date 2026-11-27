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

type ExtensionResults = {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
    largeBlob?: { supported?: boolean; blob?: ArrayBuffer; written?: boolean };
};

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

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

// ------------------------------------------------ what the passkey carries
//
// Besides the secret, a passkey can carry a small blob that travels with it
// to every device it syncs to (the largeBlob extension). The names of the
// accounts this passkey has been used with are kept there, so a new device
// needs nothing from any node to find them. Where the passkey's provider has
// no such blob, this browser's storage and then the node's encrypted list
// (account-list.ts) are used instead.
//
// The blob is only readable by this site after the passkey is confirmed. It
// can be written only while the passkey is being used, so it is written in
// the same prompt as the action that changes the list.

export interface PasskeyNotes {
    /** A name the holder chose to be shown by; optional. */
    displayName?: string;
    /** Account names, lowercase. */
    accounts: string[];
}

export const encodeNotes = (notes: PasskeyNotes): Uint8Array =>
    new TextEncoder().encode(
        JSON.stringify({
            v: 1,
            ...(notes.displayName ? { displayName: notes.displayName } : {}),
            accounts: [...new Set(notes.accounts)],
        }),
    );

const decodeNotes = (blob: ArrayBuffer | undefined): PasskeyNotes | undefined => {
    if (!blob || blob.byteLength === 0) return undefined;
    try {
        const parsed = JSON.parse(new TextDecoder().decode(blob)) as {
            displayName?: unknown;
            accounts?: unknown;
        };
        return {
            displayName:
                typeof parsed.displayName === "string" ? parsed.displayName : undefined,
            accounts: Array.isArray(parsed.accounts)
                ? parsed.accounts.filter((a): a is string => typeof a === "string")
                : [],
        };
    } catch {
        return undefined;
    }
};

export interface PrfResult {
    credentialId: Uint8Array;
    secret: Uint8Array;
    /** The passkey's fixed user id, which the password manager knows it by. */
    userId?: Uint8Array;
    /** What the passkey carries, if it carries anything. */
    notes?: PasskeyNotes;
    /** True when `write` was stored in the passkey by this use. */
    notesWritten?: boolean;
}

const prfExtension = () => ({ prf: { eval: { first: prfInput() } } });

/**
 * Uses a passkey this visitor already has. With `write` (and a known
 * passkey) the notes are replaced in the same prompt; otherwise they are read.
 */
export const readPasskey = async (
    credentialId?: Uint8Array,
    immediate = false,
    write?: PasskeyNotes,
): Promise<PrfResult> => {
    const writing = !!write && !!credentialId;
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
                extensions: {
                    ...prfExtension(),
                    largeBlob: writing ? { write: encodeNotes(write!) } : { read: true },
                },
            } as PublicKeyCredentialRequestOptions,
        } as CredentialRequestOptions)
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();
    const ext = credential.getClientExtensionResults() as ExtensionResults;
    const first = ext.prf?.results?.first;
    if (!first) {
        throw new Unsupported(
            "That passkey can't produce the secret this network derives your keys from.",
        );
    }
    const handle = (credential.response as AuthenticatorAssertionResponse).userHandle;
    return {
        credentialId: new Uint8Array(credential.rawId),
        secret: new Uint8Array(first),
        userId: handle && handle.byteLength ? new Uint8Array(handle) : undefined,
        notes: writing ? undefined : decodeNotes(ext.largeBlob?.blob),
        notesWritten: writing ? ext.largeBlob?.written === true : undefined,
    };
};

/** How a passkey is shown in the password manager. */
export interface PasskeyLabel {
    name: string;
    displayName: string;
}

/** Creates a new passkey, then reads its secret. */
export const createPasskey = async (
    rootName: string,
    label: PasskeyLabel,
    onSecondTouch: () => void,
): Promise<PrfResult> => {
    // Random and fixed for the life of the passkey: it names nobody, and is
    // what later renames and removals refer to.
    const userId = randomBytes(16);
    const credential = (await navigator.credentials
        .create({
            publicKey: {
                rp: { name: rootName },
                user: {
                    id: userId,
                    name: label.name,
                    displayName: label.displayName,
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
                extensions: {
                    ...prfExtension(),
                    largeBlob: { support: "preferred" },
                },
            } as PublicKeyCredentialCreationOptions,
        })
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();

    const ext = credential.getClientExtensionResults() as ExtensionResults;
    const credentialId = new Uint8Array(credential.rawId);
    const first = ext.prf?.results?.first;
    if (first) return { credentialId, secret: new Uint8Array(first), userId };
    if (ext.prf?.enabled === false || !ext.prf) {
        throw new Unsupported(
            "This device made a passkey, but it can't produce the secret this network derives your keys from.",
        );
    }
    // Some devices only release the secret when the passkey is used, not when
    // it is created. That takes one more confirmation.
    onSecondTouch();
    return { ...(await readPasskey(credentialId)), userId };
};

// ------------------------------------------------- the password manager
//
// Where the browser offers it, the password manager is told when a passkey's
// label changes and when a passkey is no longer of use. Where it does not,
// nothing happens: these are courtesies, not requirements.

type Signals = {
    signalCurrentUserDetails?: (o: {
        rpId: string;
        userId: string;
        name: string;
        displayName: string;
    }) => Promise<void>;
    signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
};

const signals = () => window.PublicKeyCredential as unknown as Signals;

/** Shows the passkey under `label` in the password manager. */
export const relabelPasskey = async (userId: string, label: PasskeyLabel) => {
    try {
        await signals().signalCurrentUserDetails?.({
            rpId: window.location.hostname,
            userId,
            ...label,
        });
    } catch (e) {
        console.warn("Could not rename the passkey", e);
    }
};

/** Whether the password manager can be told to drop a passkey. */
export const canDiscardPasskey = () => !!signals().signalUnknownCredential;

/** Tells the password manager this passkey is of no further use. */
export const discardPasskey = async (credentialId: string) => {
    try {
        await signals().signalUnknownCredential?.({
            rpId: window.location.hostname,
            credentialId,
        });
    } catch (e) {
        console.warn("Could not remove the passkey", e);
    }
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
    /** Base64url user id of the passkey, when the browser reported it. */
    userId?: string;
    /** What the passkey carried when it was read. */
    notes?: PasskeyNotes;
    /** True when this use stored new notes in the passkey. */
    notesWritten?: boolean;
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
        userId: prf.userId ? toB64Url(prf.userId) : undefined,
        notes: prf.notes,
        notesWritten: prf.notesWritten,
        wipe: () => {
            root.fill(0);
            secret.fill(0);
        },
    };
};
