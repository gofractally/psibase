/**
 * Coalesce noisy pending-flush skip logs so a hot React effect cannot
 * synchronously flood the console and block the main thread (H24).
 */
const SKIP_LOG_DEDUPE_MS = 5_000;

const lastSkipLogAt = new Map<string, number>();

export function shouldLogPendingSkip(key: string): boolean {
    const now = Date.now();
    const last = lastSkipLogAt.get(key) ?? 0;
    if (now - last < SKIP_LOG_DEDUPE_MS) return false;
    lastSkipLogAt.set(key, now);
    return true;
}

export function pendingSkipLogKey(
    reason: string,
    spaceUuid: string | undefined,
    recipient: string | undefined,
): string {
    return `${reason}:${spaceUuid ?? ""}:${recipient ?? ""}`;
}

/** Test-only reset. */
export function resetPendingSkipLogDedupe(): void {
    lastSkipLogAt.clear();
}
