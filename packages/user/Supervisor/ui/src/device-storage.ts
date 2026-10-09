import { siblingUrl } from "@psibase/common-lib";

/** Persistent string storage on this device, private to the supervisor origin. */
export interface DeviceStorage {
    get(name: string): Promise<string | undefined>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
}

const HOST_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const IDB_NAME = "supervisor";
const IDB_STORE = "device-storage";

/** True for desktop Safari and every iOS browser. */
export function isWebKit(userAgent: string): boolean {
    return (
        userAgent.includes("AppleWebKit") &&
        !["Chrome/", "Chromium/", "Edg/"].some((token) =>
            userAgent.includes(token),
        )
    );
}

// WebKit partitions local storage and IndexedDB per top-level origin and
// deletes script-written storage, including `document.cookie` cookies, after
// 7 days without interaction. Server-set cookies are exempt, and every
// `set` restarts the cookie's max-age.
class HostCookieStorage implements DeviceStorage {
    async get(name: string): Promise<string | undefined> {
        const prefix = `__Host-${name}=`;
        return document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(prefix))
            ?.slice(prefix.length);
    }

    set(name: string, value: string): Promise<void> {
        return this.post(name, value, HOST_COOKIE_MAX_AGE);
    }

    delete(name: string): Promise<void> {
        return this.post(name, "", 0);
    }

    private async post(
        name: string,
        value: string,
        maxAge: number,
    ): Promise<void> {
        const url = siblingUrl(null, "supervisor", "/common/set-host-cookie");
        const response = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, value, maxAge, httpOnly: false }),
        });
        if (!response.ok) {
            throw new Error(
                `Failed to set ${name} cookie: HTTP ${response.status}`,
            );
        }
    }
}

class IndexedDbStorage implements DeviceStorage {
    private db?: Promise<IDBDatabase>;

    get(name: string): Promise<string | undefined> {
        return this.run(
            "readonly",
            (store) => store.get(name) as IDBRequest<string | undefined>,
        );
    }

    async set(name: string, value: string): Promise<void> {
        await this.run("readwrite", (store) => store.put(value, name));
    }

    delete(name: string): Promise<void> {
        return this.run("readwrite", (store) => store.delete(name));
    }

    private open(): Promise<IDBDatabase> {
        this.db ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(IDB_NAME, 1);
            request.onupgradeneeded = () =>
                request.result.createObjectStore(IDB_STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.db;
    }

    private async run<T>(
        mode: IDBTransactionMode,
        op: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, mode);
            const request = op(tx.objectStore(IDB_STORE));
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error);
        });
    }
}

export function createDeviceStorage(): DeviceStorage {
    return isWebKit(navigator.userAgent)
        ? new HostCookieStorage()
        : new IndexedDbStorage();
}
