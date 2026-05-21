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
