import { expect, test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    ensureContact,
    expectThreadMessage,
    sendChatMessage,
    startDmWithContact,
    waitForDmDataChannelReady,
    waitForPeerOnline,
} from "../lib/chat-ui";

test.describe("Chat DM first-send", () => {
    test("alice's first DM reaches bob via WebRTC", async ({
        chain,
        alicePage,
        browser,
    }) => {
        const ALICE = uniqueE2eAccountName("dmfs");
        const BOB = uniqueE2eAccountName("dmfs");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        await createAccountViaInviteUrl(alicePage, aliceInvite, ALICE);

        const bobContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        try {
            const bob = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );

            await ensureContact(alicePage, chain.baseUrl, bob.name);
            await ensureContact(bobPage, chain.baseUrl, ALICE);

            // Both peers open the DM before send so WebRTC can negotiate.
            await startDmWithContact(bobPage, chain.baseUrl, ALICE);
            await startDmWithContact(alicePage, chain.baseUrl, bob.name);
            await waitForPeerOnline(alicePage, bob.name, { timeout: 120_000 });
            await waitForPeerOnline(bobPage, ALICE, { timeout: 120_000 });
            await waitForDmDataChannelReady(alicePage, bob.name);
            await waitForDmDataChannelReady(bobPage, ALICE);
            await sendChatMessage(alicePage, "hello bob");

            // Sender-side sanity: message entered outbox / left wire.
            await expect
                .poll(
                    async () =>
                        alicePage.evaluate(() => {
                            const dbg = (
                                window as unknown as {
                                    __chatMessagingDebug?: {
                                        getOutbox?: () => unknown[];
                                        events?: () => Array<{
                                            kind: string;
                                        }>;
                                    };
                                    __chatTransportDebug?: {
                                        started?: () => boolean;
                                        peerState?: (remote: string) => string;
                                    };
                                }
                            ).__chatMessagingDebug;
                            const transport = (
                                window as unknown as {
                                    __chatTransportDebug?: {
                                        started?: () => boolean;
                                        peerState?: (remote: string) => string;
                                        getOutbox?: () => unknown[];
                                    };
                                }
                            ).__chatTransportDebug;
                            const outbox = dbg?.getOutbox?.() ?? [];
                            const events = dbg?.events?.() ?? [];
                            const hasTimeline = Boolean(
                                document.body.textContent?.includes("hello bob"),
                            );
                            return (
                                outbox.length > 0 ||
                                events.some((e) => e.kind === "message-status") ||
                                hasTimeline
                            );
                        }),
                    { timeout: 30_000 },
                )
                .toBe(true);

            await expectThreadMessage(bobPage, "hello bob", {
                timeout: 180_000,
            });
        } finally {
            await bobContext.close();
        }
    });
});
