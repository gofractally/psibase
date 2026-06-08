/**
 * Reusable e2e helpers for pending DM delivery — patterns learned from random-churn
 * and compose-first offline rejoin (recipient with dm:0 / no sidebar row yet).
 */
import type { Page } from "@playwright/test";

import { gotoReliable } from "./churn-navigation";
import {
    bootstrapDmPeer,
    bootstrapGroupMeshPeers,
    chatUrlForPage,
    ensureContact,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    focusChurnGroupThread,
    groupSpaceIdFromPage,
    openChat,
    openComposeFirstDmForFlush,
    openDmThread,
    openDmThreadForFlush,
    wakeForDmInteraction,
    waitForDmDataChannelReady,
    waitForGroupMeshReady,
} from "./chat-ui";
import type { PendingLedgerEntry } from "./churn-pending-ledger";
import { actorAccount, groupPeersFor, type PartyActor } from "./random-three-party-churn";

export type PendingFlushPages = {
    alice: Page;
    bob: Page | null;
    carol: Page | null;
};

/** True when the recipient has never opened a DM thread (no sidebar row). */
export async function recipientHasDmSidebar(page: Page): Promise<boolean> {
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

/**
 * After offline rejoin: open `/chat` without a group deep link when DM pending.
 * The flush coordinator owns any compose-first DM open after it has prepared peers.
 */
export async function openChatForOfflineRejoinPendingFlush(
    page: Page,
    baseUrl: string,
    pendingEntries: readonly PendingLedgerEntry[],
): Promise<void> {
    const hasComposeFirstDm = pendingEntries.some((e) => e.channel === "dm");
    if (!hasComposeFirstDm) return;

    await openChat(page, baseUrl);
    const hasDmSidebar = await recipientHasDmSidebar(page);
    if (!hasDmSidebar) {
        return;
    }
}

/** Pending flush may deliver via group outbox while the active thread is DM — try both. */
export async function expectPendingBodyVisible(
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

export async function ensureMeshForPendingEntry(
    entry: PendingLedgerEntry,
    pages: PendingFlushPages,
    online: Set<PartyActor>,
    names: { alice: string; bob: string; carol: string },
    meshTimeoutMs: number,
): Promise<void> {
    if (!online.has(entry.from) || !online.has(entry.to)) return;

    const pageFor = (who: PartyActor): Page => {
        const page = pages[who];
        if (!page) throw new Error(`[pending-flush] ${who} has no page`);
        return page;
    };

    const senderPage = pageFor(entry.from);
    const recipientPage = pageFor(entry.to);
    const senderName = actorAccount(entry.from, names);
    const recipientName = actorAccount(entry.to, names);
    const meshMs = Math.min(meshTimeoutMs, 60_000);

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

export type FlushPendingDmOptions = {
    entry: PendingLedgerEntry;
    pages: PendingFlushPages;
    names: { alice: string; bob: string; carol: string };
    baseUrl: string;
    groupSpaceId: string;
    meshTimeoutMs: number;
};

/**
 * Tiered DM flush: recipient-first when sidebar exists; compose-first path when
 * recipient has dm:0; sender outbox escalation when recipient-only path stalls.
 */
export async function flushPendingDmEntry(
    options: FlushPendingDmOptions,
): Promise<void> {
    const { entry, pages, names, baseUrl, groupSpaceId, meshTimeoutMs } =
        options;

    const pageFor = (who: PartyActor): Page => {
        const page = pages[who];
        if (!page) throw new Error(`[pending-flush] ${who} has no page`);
        return page;
    };

    const senderPage = pageFor(entry.from);
    const recipientPage = pageFor(entry.to);
    const senderName = actorAccount(entry.from, names);
    const recipientName = actorAccount(entry.to, names);

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
            await gotoReliable(senderPage, chatUrlForPage(senderPage, baseUrl), {
                timeout: 25_000,
                waitUntil: "domcontentloaded",
                maxAttempts: 2,
            });
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
        await openComposeFirstDmForFlush(
            recipientPage,
            senderName,
            groupSpaceId,
            meshTimeoutMs,
        );
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
}

/** Ensure contacts exist before compose-first DM open on rejoin. */
export async function ensureContactsForPendingFlush(
    page: Page,
    baseUrl: string,
    pendingEntries: readonly PendingLedgerEntry[],
    names: { alice: string; bob: string; carol: string },
    who: PartyActor,
): Promise<void> {
    for (const entry of pendingEntries) {
        if (entry.channel !== "dm") continue;
        const peer =
            entry.from === who
                ? actorAccount(entry.to, names)
                : actorAccount(entry.from, names);
        await ensureContact(page, baseUrl, peer);
    }
}
