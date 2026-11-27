// What a passkey prompt unlocked, kept across the provider check.
//
// THIS IS A STATED EXCEPTION to the rule that the root and the owner keys
// exist only for the moment after a passkey prompt and are never stored
// (gofractally/psibase#2275, section 4; the project owner's decision of
// 2026-11-27: "save the data until you get back from github, we can use the
// browser's crypto store temp, then delete any secrets we don't want to
// keep").
//
// Why: a new account is created a page later than the passkey was used; the
// provider check in between is a round trip to another site, and the page's
// memory does not survive it. Without this the visitor is asked for the
// passkey (and, for a passkey that gives no secret, its password) a second
// time to make the same keys again.
//
// What is kept, where and for how long:
// - the root (from which the account's keys are derived) and the facts
//   about the passkey that came with it; nothing else;
// - encrypted with an AES-GCM key made here that cannot be exported
//   (`extractable: false`), so script can use it but never read it; the key
//   and the ciphertext sit in this origin's IndexedDB;
// - tied to the passkey and the network it was made for;
// - deleted the moment it is read, when the visitor signs out, and by the
//   sweep at every load of this page once it is ten minutes old.
// It is used for one thing: creating the account the visitor asked for.
// Every other owner action still takes a passkey prompt.
import { guestSecret, publicKeyHex } from "./account-keys";
import { type PasskeyNotes, type Unlocked } from "./passkey";

const DB = "psibase-sign-in";
const STORE = "held";
const ID = "root";
const KEEP_MS = 10 * 60 * 1000;

interface Held {
    key: CryptoKey;
    iv: Uint8Array;
    data: ArrayBuffer;
    until: number;
}

interface Payload {
    root: string;
    chainId: string;
    credentialId: string;
    userId?: string;
    notes?: PasskeyNotes;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));

const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        const req = window.indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = op(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
};

const bound = (credentialId: string, chainId: string) =>
    new TextEncoder().encode(`psibase/sign-in/held-root/v1\n${chainId}\n${credentialId}`);

/** Removes anything kept. */
export const dropHeld = async (): Promise<void> => {
    try {
        await run("readwrite", (s) => s.delete(ID));
    } catch {
        // Nothing was kept, or this browser has no such storage.
    }
};

/** At page load: removes what is past its time. */
export const sweepHeld = async (): Promise<void> => {
    try {
        const held = await run<Held | undefined>("readonly", (s) => s.get(ID));
        if (held && !(Date.now() < held.until)) await dropHeld();
    } catch {
        await dropHeld();
    }
};

/** Keeps what `unlocked` holds until the account step asks for it. */
export const holdRoot = async (unlocked: Unlocked): Promise<void> => {
    try {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
            "encrypt",
            "decrypt",
        ]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const chainId = hex(unlocked.chainId);
        const payload: Payload = {
            root: hex(unlocked.root),
            chainId,
            credentialId: unlocked.credentialId,
            userId: unlocked.userId,
            notes: unlocked.notes,
        };
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: bound(unlocked.credentialId, chainId) },
            key,
            new TextEncoder().encode(JSON.stringify(payload)),
        );
        const held: Held = { key, iv, data, until: Date.now() + KEEP_MS };
        await run("readwrite", (s) => s.put(held, ID));
    } catch (e) {
        // Then the account step asks for the passkey, as it always could.
        console.warn("Could not keep the sign-in across the next step", e);
        await dropHeld();
    }
};

/**
 * What was kept for this passkey on this network, once: it is removed before
 * it is returned. Nothing if there is none, it is too old, or it belongs to
 * another passkey or network.
 */
export const takeHeldRoot = async (
    credentialId: string,
    chainId: Uint8Array,
): Promise<Unlocked | undefined> => {
    let held: Held | undefined;
    try {
        held = await run<Held | undefined>("readonly", (s) => s.get(ID));
    } catch {
        return undefined;
    }
    await dropHeld();
    if (!held || !(Date.now() < held.until)) return undefined;
    try {
        const plain = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: new Uint8Array(held.iv),
                additionalData: bound(credentialId, hex(chainId)),
            },
            held.key,
            held.data,
        );
        const payload = JSON.parse(new TextDecoder().decode(plain)) as Payload;
        const root = unhex(payload.root);
        const secret = guestSecret(chainId, root);
        return {
            chainId,
            root,
            guest: { publicKey: publicKeyHex(secret), secret },
            credentialId: payload.credentialId,
            userId: payload.userId,
            notes: payload.notes,
            // Nothing was written to the passkey: there was no prompt.
            notesWritten: undefined,
            wipe: () => {
                root.fill(0);
                secret.fill(0);
            },
        };
    } catch {
        return undefined;
    }
};
