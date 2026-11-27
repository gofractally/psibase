/** Native transaction contexts share persistent client authorization across tabs.
 * Every context (including zero-action approvals) uses this origin-wide lock.
 * A prompt unwinds the context and releases it before the user is redirected.
 * The caller takes it only around the context itself (start, the plugin call,
 * finish), never around loading plugins: a wait that never ends while this
 * lock is held stops every other tab of the origin.
 * There is deliberately no unsafe per-tab fallback on unsupported browsers.
 */
export async function withTransactionLock<T>(run: () => Promise<T>): Promise<T> {
    if (!globalThis.navigator?.locks?.request) {
        throw new Error("Native wallet authorization requires Web Locks. Use a supported browser on HTTPS or localhost.");
    }
    return navigator.locks.request("psibase-native-transaction", { mode: "exclusive" }, run);
}
