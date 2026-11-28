// What the supervisor works out from a plugin's bytes, kept on the device.
//
// A plugin is a wasm component. Before it can run, the supervisor reads its
// imports and exports (the component parser) and translates it into plain
// wasm modules plus JavaScript glue (jco). Both are pure functions of the
// plugin's bytes, both are done by tools that are megabytes of wasm
// themselves, and both were repeated for every plugin on every page load.
//
// The results are kept here, keyed by the hash of the plugin's bytes and the
// versions of the tools. When every plugin a page needs is found here, the
// tools are neither downloaded nor run.
//
// Trust: an entry is only ever written by this supervisor, from tools it
// runs itself, and is read back by the same origin. Nothing in it comes
// from a plugin's publisher. (gofractally/psibase#2312 is the design for a
// node vouching for the same results, so that a first visit is spared too.)
import { ComponentAPI } from "../wit-extraction";

// Change when the parser, jco, or the options given to jco change: an entry
// made by other tools must not be used.
const TOOLS = "parser-0.29.0|jco-1.35.0|opts-1";

const DB = "psibase-plugin-cache";
const STORE = "prepared";

export interface Prepared {
    api?: ComponentAPI;
    js?: string;
    wasm?: [string, Uint8Array][];
}

const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        const req = window.indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

let db: Promise<IDBDatabase | undefined> | undefined;
const database = () => (db ??= open().catch(() => undefined));

const request = async <T>(
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> => {
    const d = await database();
    if (!d) return undefined;
    return new Promise<T | undefined>((resolve) => {
        try {
            const tx = d.transaction(STORE, mode);
            const req = op(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => resolve(undefined);
            tx.onabort = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
};

/** The key for a plugin's bytes. */
export const preparedKey = async (bytes: Uint8Array): Promise<string> => {
    const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource),
    );
    return (
        TOOLS +
        ":" +
        Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")
    );
};

// One read per plugin although two steps ask for it.
const reads = new Map<string, Promise<Prepared | undefined>>();

export const getPrepared = (key: string): Promise<Prepared | undefined> => {
    let read = reads.get(key);
    if (!read) {
        read = request<Prepared>("readonly", (s) => s.get(key));
        reads.set(key, read);
    }
    return read;
};

/** Adds to what is kept for `key`. Never fails: this is only a saving. */
export const putPrepared = async (key: string, part: Prepared): Promise<void> => {
    const merged = { ...((await getPrepared(key)) ?? {}), ...part };
    reads.set(key, Promise.resolve(merged));
    await request("readwrite", (s) => s.put(merged, key));
};

export const dropPrepared = async (key: string): Promise<void> => {
    reads.delete(key);
    await request("readwrite", (s) => s.delete(key));
};
