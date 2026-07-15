/**
 * Chain-scoped browser storage keys (same convention as Host `Bucket` ids:
 * `{chain_id}:...` — see `packages/user/Host/plugin/db/src/bucket.rs` and
 * Supervisor `LocalStorageManager`).
 */
export function chainScopedStorageKey(
    chainId: string,
    suffix: string,
): string {
    return `${chainId}:${suffix}`;
}

/**
 * Read a chain-scoped key; if missing, copy from a legacy unscoped-prefix key
 * (pre-rename) once, then remove the legacy entry.
 */
export function readMigratingLocalStorage(
    chainId: string,
    suffix: string,
    legacySuffix: string,
): string | null {
    const key = chainScopedStorageKey(chainId, suffix);
    try {
        const current = globalThis.localStorage.getItem(key);
        if (current != null) return current;
        const legacyKey = chainScopedStorageKey(chainId, legacySuffix);
        const legacy = globalThis.localStorage.getItem(legacyKey);
        if (legacy == null) return null;
        globalThis.localStorage.setItem(key, legacy);
        globalThis.localStorage.removeItem(legacyKey);
        return legacy;
    } catch {
        return null;
    }
}
