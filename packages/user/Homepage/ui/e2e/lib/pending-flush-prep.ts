import type { Page } from "@playwright/test";

import { focusChurnGroupThread } from "./chat-ui";
import type { PendingLedgerEntry } from "./churn-pending-ledger";
import type { PendingFlushPages } from "./pending-dm-delivery-helpers";
import { groupPeersFor, type PartyActor } from "./random-three-party-churn";

/**
 * Re-enable WebRTC on senders parked with `churnNoRealtime=1`. Recipients that
 * just rejoined already have realtime — avoid navigating them again.
 */
export async function prepareForPendingFlush(
    pages: PendingFlushPages,
    online: Set<PartyActor>,
    baseUrl: string,
    names: { alice: string; bob: string; carol: string },
    groupSpaceId: string,
    entries: readonly PendingLedgerEntry[],
): Promise<void> {
    if (entries.length === 0) return;

    const senders = new Set(entries.map((e) => e.from));
    for (const who of senders) {
        if (!online.has(who)) continue;
        const page = pages[who];
        if (!page) continue;
        if (
            new URL(page.url()).searchParams.get("churnNoRealtime") !== "1"
        ) {
            continue;
        }
        await focusChurnGroupThread(
            page,
            baseUrl,
            groupPeersFor(who, names),
            {
                groupSpaceId,
                churnNoRealtime: false,
                composerTimeout: 45_000,
                gotoTimeout: 25_000,
            },
        );
    }
}
