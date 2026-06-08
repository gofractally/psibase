import type { Page } from "@playwright/test";

import {
    expectOutboundMessageDelivered,
    expectThreadMessage,
    focusChurnGroupThread,
    resyncOnlineActorsToGroup,
} from "./chat-ui";
import type {
    PendingLedger,
    PendingLedgerEntry,
} from "./churn-pending-ledger";
import {
    ensureMeshForPendingEntry,
    expectPendingBodyVisible,
    flushPendingDmEntry,
    type PendingFlushPages,
} from "./pending-dm-delivery-helpers";
import {
    actorAccount,
    groupPeersFor,
    type PartyActor,
} from "./random-three-party-churn";
import { prepareForPendingFlush } from "./pending-flush-prep";

export { FLUSH_ENTRY_BUDGET_MS } from "./pending-flush-constants";
export {
    ensureContactsForPendingFlush,
    openChatForOfflineRejoinPendingFlush,
    recipientHasDmSidebar,
} from "./pending-dm-delivery-helpers";

type ChurnPages = PendingFlushPages;

const ACTORS: readonly PartyActor[] = ["alice", "bob", "carol"];

function pageFor(who: PartyActor, pages: ChurnPages): Page {
    const page = pages[who];
    if (!page) {
        throw new Error(`[random-churn] ${who} has no browser context`);
    }
    return page;
}

function sortPendingEntries(
    entries: readonly PendingLedgerEntry[],
): PendingLedgerEntry[] {
    return [...entries].sort((a, b) => {
        if (a.channel === b.channel) return 0;
        return a.channel === "dm" ? -1 : 1;
    });
}

function perEntryMeshMs(totalMeshMs: number): number {
    return Math.min(totalMeshMs, 60_000);
}

/** Dump transport + pending outbox from every online tab (for flush failures). */
export async function dumpTransportDeliverySnapshot(
    pages: ChurnPages,
    online: Set<PartyActor>,
    remotes: string[],
    label: string,
): Promise<void> {
    for (const who of ACTORS) {
        if (!online.has(who) || !pages[who]) continue;
        try {
            const payload = await pageFor(who, pages).evaluate(
                (peerAccounts) => {
                    const transport = (
                        window as unknown as {
                            __chatTransportDebug?: {
                                snapshot?: (remotes: string[]) => unknown;
                                deliverySnapshot?: () => unknown;
                                getOutbox?: () => unknown;
                                events?: () => unknown;
                                peerState?: (remote: string) => string;
                                started?: () => boolean;
                            };
                        }
                    ).__chatTransportDebug;
                    const churn = (
                        window as unknown as {
                            __chatChurnState?: () => Record<string, unknown>;
                        }
                    ).__chatChurnState?.();
                    const legacy = (
                        window as unknown as {
                            __chatDataDebug?: {
                                snapshot?: () => unknown;
                                events?: () => unknown;
                            };
                        }
                    ).__chatDataDebug;
                    return {
                        url: location.href,
                        churn,
                        transport:
                            transport?.snapshot?.(peerAccounts) ??
                            (v2
                                ? {
                                      started: transport.started?.(),
                                      peers: peerAccounts.map((remote) => ({
                                          remote,
                                          state: transport.peerState?.(remote),
                                      })),
                                  }
                                : null),
                        delivery:
                            transport?.deliverySnapshot?.() ?? transport?.getOutbox?.() ?? null,
                        routing:
                            typeof transport?.routingSnapshot === "function"
                                ? transport.routingSnapshot()
                                : null,
                        v2Events:
                            typeof transport?.events === "function"
                                ? transport.events()
                                : null,
                        chatDataEvents:
                            legacy?.events?.()?.slice(-40) ?? null,
                        chatDataSnapshot: legacy?.snapshot?.() ?? null,
                    };
                },
                remotes,
            );
            console.log(
                `[random-churn] transport-snapshot ${label} ${who}=${JSON.stringify(payload)}`,
            );
        } catch (err) {
            console.log(
                `[random-churn] transport-snapshot ${label} ${who}=skipped (${String(err)})`,
            );
        }
    }
}

export async function flushPendingCatchUp(
    who: PartyActor,
    ledger: PendingLedger,
    pages: ChurnPages,
    online: Set<PartyActor>,
    names: { alice: string; bob: string; carol: string },
    baseUrl: string,
    groupSpaceId: string,
    meshTimeoutMs: number,
    label: string,
): Promise<void> {
    const pending = sortPendingEntries(ledger.forRecipient(who));
    if (pending.length === 0) return;

    console.log(
        `[random-churn] flush pending for ${who} (${pending.length} entries) ${label}`,
    );

    const remotes = [
        ...new Set(
            pending.flatMap((e) => [
                actorAccount(e.from, names),
                actorAccount(e.to, names),
            ]),
        ),
    ];

    await prepareForPendingFlush(
        pages,
        online,
        baseUrl,
        names,
        groupSpaceId,
        pending,
    );

    for (const entry of pending) {
        console.log(
            `[random-churn] flush entry ${entry.channel} ${entry.from}->${entry.to} body=${entry.body}`,
        );
        try {
            await flushPendingEntry(
                entry,
                pages,
                online,
                names,
                baseUrl,
                groupSpaceId,
                meshTimeoutMs,
            );
            ledger.remove(entry);
        } catch (err) {
            await dumpTransportDeliverySnapshot(
                pages,
                online,
                remotes,
                `${label} body=${entry.body}`,
            );
            throw err;
        }
    }

    await resyncOnlineActorsToGroup(
        pages,
        online,
        baseUrl,
        groupSpaceId,
        (who) => groupPeersFor(who, names),
    );
}

async function flushPendingEntry(
    entry: PendingLedgerEntry,
    pages: ChurnPages,
    online: Set<PartyActor>,
    names: { alice: string; bob: string; carol: string },
    baseUrl: string,
    groupSpaceId: string,
    meshTimeoutMs: number,
): Promise<void> {
    const senderPage = pageFor(entry.from, pages);
    const assertMs = perEntryMeshMs(meshTimeoutMs);

    await ensureMeshForPendingEntry(
        entry,
        pages,
        online,
        names,
        meshTimeoutMs,
    );

    if (entry.channel === "dm") {
        await flushPendingDmEntry({
            entry,
            pages,
            names,
            baseUrl,
            groupSpaceId,
            meshTimeoutMs,
        });
        return;
    }

    const recipientPage = pageFor(entry.to, pages);
    await focusChurnGroupThread(
        recipientPage,
        baseUrl,
        groupPeersFor(entry.to, names),
        {
            groupSpaceId,
            churnNoRealtime: false,
            composerTimeout: 45_000,
        },
    );
    await expectPendingBodyVisible(
        recipientPage,
        baseUrl,
        entry.body,
        actorAccount(entry.from, names),
        groupSpaceId,
        groupPeersFor(entry.to, names),
        assertMs,
    );

    const groupRecipients = ACTORS.filter((a) => a !== entry.from);
    const allRecipientsOnline = groupRecipients.every((a) => online.has(a));
    if (allRecipientsOnline) {
        await focusChurnGroupThread(
            senderPage,
            baseUrl,
            groupPeersFor(entry.from, names),
            { groupSpaceId, churnNoRealtime: false, composerTimeout: 45_000 },
        );
        await expectOutboundMessageDelivered(senderPage, entry.body, {
            timeout: assertMs,
        });
    }
}
