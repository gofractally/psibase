import type { Page } from "@playwright/test";

import { gotoReliable } from "./churn-navigation";
import {
    bootstrapDmPeer,
    bootstrapGroupMeshPeers,
    chatUrlForPage,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    focusChurnGroupThread,
    groupSpaceIdFromPage,
    openDmThread,
    openDmThreadForFlush,
    resyncOnlineActorsToGroup,
    wakeForDmInteraction,
    waitForDmDataChannelReady,
    waitForGroupMeshReady,
} from "./chat-ui";
import type {
    PendingLedger,
    PendingLedgerEntry,
} from "./churn-pending-ledger";
import {
    actorAccount,
    groupPeersFor,
    type PartyActor,
} from "./random-three-party-churn";

type ChurnPages = {
    alice: Page;
    bob: Page | null;
    carol: Page | null;
};

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

/** Dump v2 transport + pending outbox from every online tab (for flush failures). */
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
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                snapshot?: (remotes: string[]) => unknown;
                                deliverySnapshot?: () => unknown;
                                getOutbox?: () => unknown;
                                events?: () => unknown;
                                peerState?: (remote: string) => string;
                                started?: () => boolean;
                            };
                        }
                    ).__chatTransportV2Debug;
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
                            v2?.snapshot?.(peerAccounts) ??
                            (v2
                                ? {
                                      started: v2.started?.(),
                                      peers: peerAccounts.map((remote) => ({
                                          remote,
                                          state: v2.peerState?.(remote),
                                      })),
                                  }
                                : null),
                        delivery:
                            v2?.deliverySnapshot?.() ?? v2?.getOutbox?.() ?? null,
                        routing:
                            typeof v2?.routingSnapshot === "function"
                                ? v2.routingSnapshot()
                                : null,
                        v2Events:
                            typeof v2?.events === "function"
                                ? v2.events()
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

/**
 * Re-enable WebRTC on senders parked with `churnNoRealtime=1`. Recipients that
 * just rejoined already have realtime — avoid navigating them again.
 */
export async function prepareForPendingFlush(
    pages: ChurnPages,
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
        const page = pageFor(who, pages);
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

async function prepareFlushDelivery(
    pending: readonly PendingLedgerEntry[],
    who: PartyActor,
    pages: ChurnPages,
    online: Set<PartyActor>,
    names: { alice: string; bob: string; carol: string },
    baseUrl: string,
    groupSpaceId: string,
    _meshTimeoutMs: number,
): Promise<void> {
    // Mesh is established per flush entry — avoid bootstrapping every pair upfront.
    void pending;
    void who;
    void pages;
    void online;
    void names;
    void baseUrl;
    void groupSpaceId;
}

async function ensureMeshForEntry(
    entry: PendingLedgerEntry,
    pages: ChurnPages,
    online: Set<PartyActor>,
    names: { alice: string; bob: string; carol: string },
    meshTimeoutMs: number,
): Promise<void> {
    if (!online.has(entry.from) || !online.has(entry.to)) return;

    const senderPage = pageFor(entry.from, pages);
    const recipientPage = pageFor(entry.to, pages);
    const senderName = actorAccount(entry.from, names);
    const recipientName = actorAccount(entry.to, names);
    const meshMs = perEntryMeshMs(meshTimeoutMs);

    await bootstrapGroupMeshPeers(senderPage, [recipientName]);
    await bootstrapGroupMeshPeers(recipientPage, [senderName]);

    if (entry.channel === "dm") {
        await waitForDmDataChannelReady(senderPage, recipientName, {
            timeout: meshMs,
        });
        await waitForDmDataChannelReady(recipientPage, senderName, {
            timeout: meshMs,
        });
        return;
    }

    await waitForGroupMeshReady(senderPage, [recipientName], {
        timeout: meshMs,
    });
    await waitForGroupMeshReady(recipientPage, [senderName], {
        timeout: meshMs,
    });
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

    await prepareFlushDelivery(
        pending,
        who,
        pages,
        online,
        names,
        baseUrl,
        groupSpaceId,
        meshTimeoutMs,
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

/** Pending flush may deliver via group outbox while the active thread is DM — try both. */
async function expectPendingBodyVisible(
    recipientPage: Page,
    baseUrl: string,
    body: string,
    peerAccount: string,
    groupSpaceId: string,
    groupPeers: string[],
    timeoutMs: number,
): Promise<void> {
    try {
        await expectThreadMessage(recipientPage, body, { timeout: 4_000 });
        return;
    } catch {
        /* not on the delivering thread yet */
    }
    try {
        await openDmThreadForFlush(
            recipientPage,
            baseUrl,
            peerAccount,
            groupSpaceId,
            timeoutMs,
        );
        await expectThreadMessage(recipientPage, body, { timeout: 8_000 });
        return;
    } catch {
        /* DM UI open failed — try group thread before final assert */
    }
    await focusChurnGroupThread(recipientPage, baseUrl, groupPeers, {
        groupSpaceId,
        churnNoRealtime: false,
        composerTimeout: 45_000,
    });
    await expectThreadMessage(recipientPage, body, { timeout: timeoutMs });
}

async function recipientHasDmSidebar(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const churn = (
            window as Window & {
                __chatChurnState?: () => {
                    conversationListSummary?: { dm?: number };
                };
            }
        ).__chatChurnState?.();
        return (churn?.conversationListSummary?.dm ?? 0) > 0;
    });
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
    const recipientPage = pageFor(entry.to, pages);
    const senderName = actorAccount(entry.from, names);
    const recipientName = actorAccount(entry.to, names);
    const assertMs = perEntryMeshMs(meshTimeoutMs);

    if (entry.channel === "dm") {
        await ensureMeshForEntry(
            entry,
            pages,
            online,
            names,
            meshTimeoutMs,
        );

        await wakeForDmInteraction(recipientPage, baseUrl, {
            composerTimeout: Math.min(meshTimeoutMs, 45_000),
        });

        const tryRecipientDelivery = async (): Promise<void> => {
            await expectPendingBodyVisible(
                recipientPage,
                baseUrl,
                entry.body,
                senderName,
                groupSpaceId,
                groupPeersFor(entry.to, names),
                meshTimeoutMs,
            );
        };

        const flushFromSender = async (): Promise<void> => {
            if (groupSpaceIdFromPage(senderPage) === groupSpaceId) {
                await gotoReliable(
                    senderPage,
                    chatUrlForPage(senderPage, baseUrl),
                    {
                        timeout: 25_000,
                        waitUntil: "domcontentloaded",
                        maxAttempts: 2,
                    },
                );
            }
            await openDmThreadForFlush(
                senderPage,
                baseUrl,
                recipientName,
                groupSpaceId,
                meshTimeoutMs,
            );
            await waitForDmDataChannelReady(senderPage, recipientName, {
                timeout: meshTimeoutMs,
            }).catch(() => {});
            await wakeForDmInteraction(recipientPage, baseUrl, {
                composerTimeout: Math.min(meshTimeoutMs, 45_000),
            });
            await tryRecipientDelivery();
        };

        const flushComposeFirstRecipient = async (): Promise<void> => {
            await wakeForDmInteraction(recipientPage, baseUrl, {
                composerTimeout: Math.min(meshTimeoutMs, 45_000),
            });
            await openDmThread(recipientPage, baseUrl, senderName, {
                groupSpaceId,
                gotoTimeout: meshTimeoutMs,
            });
            await bootstrapDmPeer(recipientPage, senderName);
            await bootstrapDmPeer(senderPage, recipientName);
            await flushFromSender();
        };

        const composeFirst = !(await recipientHasDmSidebar(recipientPage));
        if (composeFirst) {
            await flushComposeFirstRecipient();
        } else {
            try {
                await tryRecipientDelivery();
                await expectOutboundMessageDelivered(senderPage, entry.body, {
                    timeout: 15_000,
                });
                return;
            } catch {
                /* recipient-only path incomplete — drive sender outbox flush */
            }
            await flushFromSender();
        }

        await expectOutboundMessageDelivered(senderPage, entry.body, {
            timeout: meshTimeoutMs,
        });
        return;
    }

    await ensureMeshForEntry(entry, pages, online, names, meshTimeoutMs);
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
    await expectThreadMessage(recipientPage, entry.body, {
        timeout: assertMs,
    });

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

/** Extra wall-clock budget per pending ledger entry during offline rejoin flush. */
export const FLUSH_ENTRY_BUDGET_MS = 150_000;
