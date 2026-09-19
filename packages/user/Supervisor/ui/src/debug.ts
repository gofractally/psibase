/** Temporary hang diagnostics. Search the browser console for `[psibase]`. */

export function slog(msg: string, extra?: unknown): void {
    if (extra !== undefined) {
        console.log(`[psibase] ${msg}`, extra);
    } else {
        console.log(`[psibase] ${msg}`);
    }
}

export async function watchHang<T>(
    label: string,
    run: () => T | Promise<T>,
): Promise<T> {
    const started = performance.now();
    slog(`begin ${label}`);
    const timer = setInterval(() => {
        const s = ((performance.now() - started) / 1000).toFixed(1);
        console.warn(`[psibase] STILL WAITING ${label} after ${s}s`);
    }, 3000);
    try {
        const result = await run();
        const ms = (performance.now() - started).toFixed(0);
        slog(`end ${label} (${ms}ms)`);
        return result;
    } catch (e) {
        const ms = (performance.now() - started).toFixed(0);
        console.error(`[psibase] FAIL ${label} (${ms}ms)`, e);
        throw e;
    } finally {
        clearInterval(timer);
    }
}
