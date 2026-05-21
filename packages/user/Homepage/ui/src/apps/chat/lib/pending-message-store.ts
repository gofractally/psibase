/**
 * Client-local durable outbox for pending chat messages.
 *
 * Plan C extraction: previously inline in `use-chat-socket.ts`. Encapsulated
 * here so the schema, persistence backend, retry/expiry metadata, and quota
 * recovery can evolve independently of the React hook.
 *
 * Backend: localStorage today (no behavior change vs the original inline
 * implementation). Plan C2 introduces an IndexedDB primary + localStorage
 * fallback; this module is the seam where that swap will land.
 *
 * Schema versions:
 *   v1 — original shape (clientMsgId, conversationId, from, body, createdAt,
 *        recipients, deliveredTo, status, errorReason)
 *   v2 — adds attempts, lastAttemptAt, expireAfter for retry/expiry policy.
 *        Reading v1 rows is supported via {@link migratePendingMessages}.
 */

import { chainScopedStorageKey } from "./chat-chain-storage";

const PENDING_STORAGE_PREFIX = "pslack.pendingMessages.v1";
/** Schema-version embedded in a wrapper envelope for v2+ writes. */
export const PENDING_MESSAGE_SCHEMA_VERSION = 2;

/**
 * Status of a pending row. `pending` is the live outbox; `failed` is the
 * "give up" state surfaced to the UI; `sent` rows are pruned at write time
 * and never persisted across reloads.
 */
export type PendingMessageStatus = "pending" | "sent" | "failed";

/**
 * Schema v2. Backward-compatible with v1: extra fields are optional.
 */
export type PendingChatMessage = {
    clientMsgId: string;
    conversationId: string;
    from: string;
    body: string;
    createdAt: number;
    recipients: string[];
    deliveredTo: string[];
    status: PendingMessageStatus;
    errorReason?: string;
    /** Plan C2: number of send attempts so far (across all recipients). */
    attempts?: number;
    /** Plan C2: timestamp (ms) of the last attempt. */
    lastAttemptAt?: number;
    /** Plan C2: TTL hint — promote to `failed` if `Date.now() > expireAfter`. */
    expireAfter?: number;
};

export type PendingMessageStoreError =
    | { kind: "quota-exceeded"; detail: string }
    | { kind: "io"; detail: string };

export interface PendingMessageStoreEvents {
    /** Fires when a write fails (e.g. quota exceeded). */
    onWriteError?: (err: PendingMessageStoreError) => void;
}

/** Best-effort detection of quota errors across browsers. */
export function isQuotaExceededError(e: unknown): boolean {
    if (!e || typeof e !== "object") return false;
    const err = e as {
        name?: string;
        code?: number;
        number?: number;
    };
    if (err.name === "QuotaExceededError") return true;
    if (err.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    // Legacy Edge / IE
    if (err.code === 22 || err.code === 1014) return true;
    if (err.number === -2147024882) return true;
    return false;
}

/** Storage key for a (chain, account) pair. */
export function pendingStorageKey(chainId: string, account: string): string {
    return chainScopedStorageKey(
        chainId,
        `${PENDING_STORAGE_PREFIX}.${account}`,
    );
}

function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((s) => typeof s === "string");
}

/**
 * Validate + dedupe a single row. Accepts both v1 (no version envelope) and
 * v2 shapes; v2-only fields (`attempts`, etc.) are filtered to known types.
 */
function normalizeRow(row: unknown): PendingChatMessage | null {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    if (
        typeof r.clientMsgId !== "string" ||
        typeof r.conversationId !== "string" ||
        typeof r.from !== "string" ||
        typeof r.body !== "string" ||
        typeof r.createdAt !== "number" ||
        !isStringArray(r.recipients) ||
        !isStringArray(r.deliveredTo)
    ) {
        return null;
    }
    if (
        r.status !== "pending" &&
        r.status !== "sent" &&
        r.status !== "failed"
    ) {
        return null;
    }
    return {
        clientMsgId: r.clientMsgId,
        conversationId: r.conversationId,
        from: r.from,
        body: r.body,
        createdAt: r.createdAt,
        recipients: [...new Set(r.recipients)],
        deliveredTo: [...new Set(r.deliveredTo)],
        status: r.status,
        errorReason:
            typeof r.errorReason === "string" ? r.errorReason : undefined,
        attempts: typeof r.attempts === "number" ? r.attempts : 0,
        lastAttemptAt:
            typeof r.lastAttemptAt === "number" ? r.lastAttemptAt : undefined,
        expireAfter:
            typeof r.expireAfter === "number" ? r.expireAfter : undefined,
    };
}

/**
 * Per-version migration step. Each step takes a row already normalized to
 * version `from` and returns a row matching version `to = from + 1`. Steps
 * compose, so the public {@link migratePendingMessages} runs whichever
 * subset of steps is needed to reach {@link PENDING_MESSAGE_SCHEMA_VERSION}.
 */
type PendingMigrationStep = {
    from: number;
    to: number;
    migrate: (row: PendingChatMessage) => PendingChatMessage;
};

const PENDING_MESSAGE_MIGRATIONS: readonly PendingMigrationStep[] = [
    {
        from: 1,
        to: 2,
        migrate: (row) => ({
            ...row,
            attempts: row.attempts ?? 0,
            // lastAttemptAt and expireAfter remain undefined for v1 rows;
            // the retry/expiry policy seeds them on next send/touch.
        }),
    },
];

/**
 * Apply each known migration step in order to bring rows up to the current
 * {@link PENDING_MESSAGE_SCHEMA_VERSION}. Rows already at the current version
 * pass through unchanged.
 */
export function migratePendingMessages(
    rows: readonly PendingChatMessage[],
    fromVersion: number = 1,
): PendingChatMessage[] {
    let out = [...rows];
    for (const step of PENDING_MESSAGE_MIGRATIONS) {
        if (step.from < fromVersion) continue;
        if (step.to > PENDING_MESSAGE_SCHEMA_VERSION) break;
        out = out.map(step.migrate);
    }
    return out;
}

/**
 * Parse the JSON payload into a list of pending rows. Handles both the legacy
 * flat-array v1 form and the v2+ versioned envelope `{ v, rows: [...] }`.
 * Unknown future versions are downgraded to a no-op (treated as the current
 * version with strict normalization) so old clients don't crash on newer
 * payloads written by a more recent build.
 */
export function parsePendingMessages(raw: string | null): PendingChatMessage[] {
    if (!raw) return [];
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return [];
    }
    let rows: unknown[];
    let version = 1;
    if (Array.isArray(data)) {
        rows = data;
    } else if (
        typeof data === "object" &&
        data !== null &&
        Array.isArray((data as Record<string, unknown>).rows)
    ) {
        const obj = data as Record<string, unknown>;
        rows = obj.rows as unknown[];
        if (typeof obj.v === "number") {
            version = obj.v;
        }
    } else {
        return [];
    }
    const normalized = rows
        .map(normalizeRow)
        .filter((r): r is PendingChatMessage => r !== null);
    return migratePendingMessages(normalized, version);
}

function serializeForStorage(rows: readonly PendingChatMessage[]): string {
    // Persist only durable rows (omit `sent`).
    const persisted = rows.filter((row) => row.status !== "sent");
    return JSON.stringify({
        v: PENDING_MESSAGE_SCHEMA_VERSION,
        rows: persisted,
    });
}

/**
 * Load and migrate the pending outbox for `(chainId, account)`. Returns an
 * empty list if storage is unavailable or the payload is malformed.
 */
export function loadPendingMessages(
    chainId: string,
    account: string,
): PendingChatMessage[] {
    try {
        const raw = globalThis.localStorage.getItem(
            pendingStorageKey(chainId, account),
        );
        return parsePendingMessages(raw);
    } catch {
        return [];
    }
}

/**
 * Save the pending outbox. Returns `{ ok: true }` on success or an error
 * object on quota / IO failure. Callers can subscribe to write errors via
 * the `events` parameter to surface a UI banner (Plan C4).
 */
export function savePendingMessages(
    chainId: string,
    account: string,
    rows: readonly PendingChatMessage[],
    events?: PendingMessageStoreEvents,
):
    | { ok: true }
    | { ok: false; error: PendingMessageStoreError } {
    const payload = serializeForStorage(rows);
    try {
        globalThis.localStorage.setItem(
            pendingStorageKey(chainId, account),
            payload,
        );
        return { ok: true };
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const err: PendingMessageStoreError = isQuotaExceededError(e)
            ? { kind: "quota-exceeded", detail }
            : { kind: "io", detail };
        events?.onWriteError?.(err);
        return { ok: false, error: err };
    }
}

/**
 * Promote the oldest `pending` rows to `failed` to free space, then retry the
 * save once. Used by quota-recovery (Plan C4): never silently lose messages —
 * surface them via the failed state and a UI banner.
 */
export function savePendingMessagesWithQuotaRecovery(
    chainId: string,
    account: string,
    rows: readonly PendingChatMessage[],
    events?: PendingMessageStoreEvents,
):
    | { ok: true; promoted: readonly PendingChatMessage[] }
    | { ok: false; error: PendingMessageStoreError } {
    const first = savePendingMessages(chainId, account, rows, events);
    if (first.ok) return { ok: true, promoted: [] };
    if (first.error.kind !== "quota-exceeded") return first;

    // Promote the oldest 25% of pending rows to failed. The threshold is a
    // heuristic; quota recovery is a "best effort, never lose messages"
    // operation, not a precise compaction.
    const pending = rows
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.createdAt - b.createdAt);
    const promoteCount = Math.max(1, Math.ceil(pending.length / 4));
    const toPromote = new Set(
        pending.slice(0, promoteCount).map((r) => r.clientMsgId),
    );
    const promoted: PendingChatMessage[] = [];
    const adjusted = rows.map<PendingChatMessage>((row) => {
        if (toPromote.has(row.clientMsgId) && row.status === "pending") {
            const failed: PendingChatMessage = {
                ...row,
                status: "failed",
                errorReason: row.errorReason ?? "storage quota exceeded",
            };
            promoted.push(failed);
            return failed;
        }
        return row;
    });

    const second = savePendingMessages(chainId, account, adjusted, events);
    if (second.ok) return { ok: true, promoted };
    return second;
}

/** Remove the entire outbox for `(chainId, account)`. */
export function clearPendingMessages(chainId: string, account: string): void {
    try {
        globalThis.localStorage.removeItem(
            pendingStorageKey(chainId, account),
        );
    } catch {
        // Best-effort: ignore.
    }
}

/**
 * Apply expiry policy: promote rows past their `expireAfter` to `failed`.
 * Pure helper; callers are responsible for persisting the result.
 */
export function expirePendingMessages(
    rows: readonly PendingChatMessage[],
    now: number = Date.now(),
): { rows: PendingChatMessage[]; expired: PendingChatMessage[] } {
    const expired: PendingChatMessage[] = [];
    const next: PendingChatMessage[] = rows.map((row) => {
        if (
            row.status === "pending" &&
            typeof row.expireAfter === "number" &&
            now > row.expireAfter
        ) {
            const failed: PendingChatMessage = {
                ...row,
                status: "failed",
                errorReason: row.errorReason ?? "send timed out",
            };
            expired.push(failed);
            return failed;
        }
        return row;
    });
    return { rows: next, expired };
}

/** Maximum send attempts before promoting a pending row to `failed`. */
export const PENDING_MESSAGE_MAX_ATTEMPTS = 8;

/** Record an attempt against a pending row and apply the retry-cap policy. */
export function recordSendAttempt(
    row: PendingChatMessage,
    now: number = Date.now(),
): PendingChatMessage {
    const attempts = (row.attempts ?? 0) + 1;
    if (
        row.status === "pending" &&
        attempts >= PENDING_MESSAGE_MAX_ATTEMPTS
    ) {
        return {
            ...row,
            attempts,
            lastAttemptAt: now,
            status: "failed",
            errorReason:
                row.errorReason ??
                `exceeded ${PENDING_MESSAGE_MAX_ATTEMPTS} send attempts`,
        };
    }
    return { ...row, attempts, lastAttemptAt: now };
}

/**
 * Exponential backoff schedule for the next attempt, capped at ~5 minutes.
 * Pure helper — callers decide whether to actually wait. Returned value is
 * the suggested delay in milliseconds before the *next* attempt.
 */
export function nextRetryDelayMs(attempts: number): number {
    if (attempts <= 0) return 0;
    const base = 1_000;
    const cap = 5 * 60_000;
    const delay = Math.min(cap, base * 2 ** Math.min(attempts - 1, 10));
    return delay;
}
