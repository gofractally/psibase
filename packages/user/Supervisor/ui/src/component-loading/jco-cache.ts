const DB_NAME = "psibase-jco-cache";
const STORE = "generate";
const DB_VERSION = 1;
const CACHE_GEN = "jco-1.34.0-jspi-1";

export interface CachedGenerate {
    jsSource: string;
    cores: Array<[string, Uint8Array]>;
}

function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: "key" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

// HTTP pages are not a Secure Context, so crypto.subtle is undefined.
function hashBytes(bytes: Uint8Array): string {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < bytes.length; i++) {
        h1 ^= bytes[i];
        h1 = Math.imul(h1, 16777619);
        h2 = Math.imul(h2, 33) ^ bytes[i];
    }
    return `${bytes.length.toString(16)}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

export function generateCacheKey(
    wasmBytes: Uint8Array,
    imports: string[],
    exports: string[],
): string {
    return `${CACHE_GEN}:${hashBytes(wasmBytes)}:${imports.join(",")}:${exports.join(",")}`;
}

export async function readGenerateCache(
    key: string,
): Promise<CachedGenerate | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => {
                const row = req.result as
                    | {
                          jsSource?: string;
                          cores?: Array<[string, ArrayBuffer]>;
                      }
                    | undefined;
                if (!row?.jsSource || !row.cores) {
                    resolve(null);
                    return;
                }
                resolve({
                    jsSource: row.jsSource,
                    cores: row.cores.map(([name, buf]) => [
                        name,
                        new Uint8Array(buf),
                    ]),
                });
            };
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export async function writeGenerateCache(
    key: string,
    value: CachedGenerate,
): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.objectStore(STORE).put({
                key,
                jsSource: value.jsSource,
                cores: value.cores.map(([name, bytes]) => [
                    name,
                    toArrayBuffer(bytes),
                ]),
            });
        } catch {
            resolve();
        }
    });
}
