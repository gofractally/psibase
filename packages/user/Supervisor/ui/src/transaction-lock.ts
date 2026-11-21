/** Native transaction contexts share persistent client authorization across tabs.
 * Every context (including zero-action approvals) uses this origin-wide lock.
 * A prompt unwinds the context and releases it before the user is redirected.
 * There is deliberately no unsafe per-tab fallback on unsupported browsers.
 */
export async function withTransactionLock<T>(run: () => Promise<T>): Promise<T> {
    if (!globalThis.navigator?.locks?.request) {
        throw new Error("Native wallet authorization requires Web Locks. Use a supported browser on HTTPS or localhost.");
    }
    return navigator.locks.request("psibase-native-transaction", { mode: "exclusive" }, run);
}
