/**
 * Read `__chatTransportDebug` peer / delivery state from a Playwright page
 * without remeshing. Prefer these over bootstrap/wait-for-DC helpers when the
 * legs are already expected to be usable.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type TransportDeliveryRow = {
    clientMsgId?: string;
    bodyPreview?: string;
    recipients?: string[];
    deliveredTo?: string[];
    status?: string | null;
    pendingCount?: { delivered: number; total: number } | null;
};

export type TransportDebugSnapshot = {
    peerStates: Record<string, string>;
    delivery: TransportDeliveryRow[];
    started: boolean | null;
};

type ChatTransportDebug = {
    peerState?: (remote: string) => string;
    snapshot?: (remotes: string[]) => {
        started?: boolean;
        peers?: Array<{ remote: string; state: string }>;
    };
    deliverySnapshot?: () => TransportDeliveryRow[];
    getOutbox?: () => unknown;
    started?: () => boolean;
};

/** Peer FSM states for the given remotes (`absent` when debug missing). */
export async function readTransportPeerStates(
    page: Page,
    remotes: readonly string[],
): Promise<Record<string, string>> {
    return page.evaluate((peerAccounts) => {
        const transport = (
            window as unknown as { __chatTransportDebug?: ChatTransportDebug }
        ).__chatTransportDebug;
        const out: Record<string, string> = {};
        for (const remote of peerAccounts) {
            out[remote] = transport?.peerState?.(remote) ?? "absent";
        }
        return out;
    }, [...remotes]);
}

/** Pending-outbox delivery snapshot rows (empty when debug / chain missing). */
export async function readDeliverySnapshot(
    page: Page,
): Promise<TransportDeliveryRow[]> {
    return page.evaluate(() => {
        const transport = (
            window as unknown as { __chatTransportDebug?: ChatTransportDebug }
        ).__chatTransportDebug;
        const rows = transport?.deliverySnapshot?.() ?? transport?.getOutbox?.();
        return Array.isArray(rows) ? (rows as TransportDeliveryRow[]) : [];
    });
}

/** Combined peer states + delivery rows for diagnostics / soft flush. */
export async function readTransportDebugSnapshot(
    page: Page,
    remotes: readonly string[],
): Promise<TransportDebugSnapshot> {
    return page.evaluate((peerAccounts) => {
        const transport = (
            window as unknown as { __chatTransportDebug?: ChatTransportDebug }
        ).__chatTransportDebug;
        const peerStates: Record<string, string> = {};
        for (const remote of peerAccounts) {
            peerStates[remote] = transport?.peerState?.(remote) ?? "absent";
        }
        const rows =
            transport?.deliverySnapshot?.() ?? transport?.getOutbox?.();
        return {
            peerStates,
            delivery: Array.isArray(rows)
                ? (rows as TransportDeliveryRow[])
                : [],
            started:
                typeof transport?.started === "function"
                    ? transport.started()
                    : transport != null
                      ? true
                      : null,
        };
    }, [...remotes]);
}

export function countPendingDeliveryRows(
    rows: readonly TransportDeliveryRow[],
): number {
    return rows.filter((row) => {
        if (row.status === "DELIVERED" || row.status === "FAILED") return false;
        if (row.pendingCount) {
            return row.pendingCount.delivered < row.pendingCount.total;
        }
        return row.status === "PENDING" || row.status === "SENT" || !row.status;
    }).length;
}

/** True when every listed remote is `usable` on this page. */
export async function arePeersUsable(
    page: Page,
    remotes: readonly string[],
): Promise<boolean> {
    if (remotes.length === 0) return true;
    const states = await readTransportPeerStates(page, remotes);
    return remotes.every((r) => states[r] === "usable");
}

/**
 * Wait until remotes are usable via `__chatTransportDebug` only — no remesh.
 * Returns false on timeout so callers can escalate to mesh bootstrap.
 */
export async function waitForPeersUsable(
    page: Page,
    remotes: readonly string[],
    options?: { timeout?: number },
): Promise<boolean> {
    const timeout = options?.timeout ?? 15_000;
    if (remotes.length === 0) return true;
    try {
        await expect
            .poll(async () => arePeersUsable(page, remotes), {
                timeout,
                intervals: [200, 400, 800, 1500],
            })
            .toBe(true);
        return true;
    } catch {
        return false;
    }
}

/**
 * Soft path: wait for usable peers + optionally drain pending count without
 * remeshing. Returns true when peers are usable (pending may still be > 0).
 */
export async function waitForTransportReadyForFlush(
    page: Page,
    remotes: readonly string[],
    options?: { timeout?: number; maxPending?: number },
): Promise<{ usable: boolean; pendingCount: number }> {
    const usable = await waitForPeersUsable(page, remotes, {
        timeout: options?.timeout ?? 15_000,
    });
    const delivery = await readDeliverySnapshot(page);
    const pendingCount = countPendingDeliveryRows(delivery);
    if (
        usable &&
        options?.maxPending != null &&
        pendingCount > options.maxPending
    ) {
        return { usable: true, pendingCount };
    }
    return { usable, pendingCount };
}
