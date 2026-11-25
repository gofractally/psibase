// Keeps the passkey-derived private key between sign-in and the moment the
// guest becomes an account, so that step needs no second passkey prompt.
//
// The key is encrypted with an AES-GCM key that the browser generates as
// non-extractable and keeps in this origin's IndexedDB: code on this origin
// can ask the browser to decrypt with it, but nothing can read the wrapping
// key itself, and the ciphertext alone is useless off this browser profile.
// Signing out removes both. If any of this is unavailable the stash is
// simply empty and the passkey is asked for again.

const DB_NAME = "psibase-sign-in";
const STORE = "keys";
const WRAP_ID = "guest-key-wrap";
const STASH_KEY = "psibase.guest-key-stash.v1";

interface Stash {
    publicKey: string;
    iv: string;
    data: string;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) =>
    Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const idb = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const request = run(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
};

const wrappingKey = async (create: boolean): Promise<CryptoKey | undefined> => {
    const existing = await idb<CryptoKey | undefined>("readonly", (s) =>
        s.get(WRAP_ID),
    );
    if (existing || !create) return existing;
    const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false, // not extractable
        ["encrypt", "decrypt"],
    );
    await idb("readwrite", (s) => s.put(key, WRAP_ID));
    return key;
};

/** Remembers the private key (a PKCS#8 PEM) for this guest. */
export const stashKey = async (pem: string, publicKey: string) => {
    try {
        const key = await wrappingKey(true);
        if (!key) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(publicKey) },
            key,
            new TextEncoder().encode(pem),
        );
        const stash: Stash = {
            publicKey,
            iv: b64(iv),
            data: b64(new Uint8Array(data)),
        };
        window.localStorage.setItem(STASH_KEY, JSON.stringify(stash));
    } catch (e) {
        console.warn("Could not remember the key on this device", e);
    }
};

/** The remembered private key for `publicKey`, if this browser has it. */
export const stashedKey = async (
    publicKey: string,
): Promise<string | undefined> => {
    try {
        const raw = window.localStorage.getItem(STASH_KEY);
        if (!raw) return undefined;
        const stash = JSON.parse(raw) as Stash;
        if (stash.publicKey !== publicKey) return undefined;
        const key = await wrappingKey(false);
        if (!key) return undefined;
        const pem = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: unb64(stash.iv),
                additionalData: new TextEncoder().encode(publicKey),
            },
            key,
            unb64(stash.data),
        );
        return new TextDecoder().decode(pem);
    } catch {
        return undefined;
    }
};

export const clearStash = async () => {
    window.localStorage.removeItem(STASH_KEY);
    try {
        await idb("readwrite", (s) => s.delete(WRAP_ID));
    } catch {
        // Nothing stored, or storage unavailable.
    }
};
