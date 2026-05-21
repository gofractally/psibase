/** Per-step wall-clock budget for random churn (fail fast instead of hanging). */
export function parseChurnStepTimeoutMs(): number {
    const raw = process.env.PSIBASE_E2E_RANDOM_CHURN_STEP_MS;
    if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 90_000;
}

/** Offline browser recycle can take longer (login + contacts + group). */
export function parseChurnOfflineStepTimeoutMs(): number {
    const raw = process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE_STEP_MS;
    if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 180_000;
}

export function parseChurnMeshTimeoutMs(): number {
    const raw = process.env.PSIBASE_E2E_RANDOM_CHURN_MESH_MS;
    if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 150_000;
}

export async function withChurnStepTimeout<T>(
    label: string,
    timeoutMs: number,
    fn: () => Promise<T>,
): Promise<T> {
    console.log(`[random-churn] ${label} begin`);
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(
                        new Error(
                            `[random-churn] STEP TIMEOUT ${label} after ${timeoutMs}ms`,
                        ),
                    );
                }, timeoutMs);
            }),
        ]);
        console.log(
            `[random-churn] ${label} end (+${Date.now() - started}ms)`,
        );
        return result;
    } catch (err) {
        console.log(
            `[random-churn] ${label} FAIL (+${Date.now() - started}ms): ${err}`,
        );
        throw err;
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
