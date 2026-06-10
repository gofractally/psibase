import { chainScopedStorageKey } from "./chat-chain-storage";

/** Chain-scoped JSON persistence (localStorage today; IndexedDB seam for Plan C2). */
export function durableStorageKey(
    chainId: string,
    account: string,
    suffix: string,
): string {
    return chainScopedStorageKey(chainId, `${suffix}:${account}`);
}

export function loadDurableJson<T>(
    chainId: string,
    account: string,
    suffix: string,
): T[] {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(
            durableStorageKey(chainId, account, suffix),
        );
        if (!raw) return [];
        const parsed = JSON.parse(raw) as T[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveDurableJson<T>(
    chainId: string,
    account: string,
    suffix: string,
    records: readonly T[],
): void {
    if (typeof localStorage === "undefined") return;
    const key = durableStorageKey(chainId, account, suffix);
    if (records.length === 0) {
        localStorage.removeItem(key);
        return;
    }
    localStorage.setItem(key, JSON.stringify(records));
}
