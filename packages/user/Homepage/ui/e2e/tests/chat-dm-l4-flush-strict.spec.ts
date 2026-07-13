/**
 * Proves L4 flush-on-usable delivers a pending DM without remesh helpers.
 *
 * Soft budgets: peers must become usable via normal recover, then the message
 * must land — `ensureMesh` / bootstrap remesh is not used.
 */
import { expect, test } from "../fixtures/chain";
import {
    PRODUCER_ACCOUNT,
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    ensureContact,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    openChat,
    sendChatMessage,
    startDmWithContact,
    waitForDmDataChannelReady,
    waitForPeerOnline,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    waitForPeersUsable,
    waitForTransportReadyForFlush,
} from "../lib/transport-state-assertions";

/** Tight budgets — remesh must not be required for this scenario. */
const USABLE_MS = 45_000;
const DELIVER_MS = 30_000;

test.describe("Chat DM L4 flush (no remesh)", () => {
    test("pending DM flushes when peer returns usable without remesh", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(420_000);
        attachDiagnostics(alicePage, "alice");

        const ALICE = uniqueE2eAccountName("l4f");
        const BOB = uniqueE2eAccountName("l4f");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        await createAccountViaInviteUrl(alicePage, aliceInvite, ALICE);

        const bobCtx1 = await browser!.newContext();
        const bobPage1 = await bobCtx1.newPage();
        attachDiagnostics(bobPage1, "bob1");

        try {
            const bob = await createAccountViaInviteUrl(
                bobPage1,
                bobInvite,
                BOB,
            );
            await ensureContact(alicePage, chain.baseUrl, bob.name);
            await ensureContact(bobPage1, chain.baseUrl, ALICE);
            await startDmWithContact(bobPage1, chain.baseUrl, ALICE);
            await startDmWithContact(alicePage, chain.baseUrl, bob.name);
            await waitForPeerOnline(alicePage, bob.name, { timeout: 120_000 });
            await waitForPeerOnline(bobPage1, ALICE, { timeout: 120_000 });
            await waitForDmDataChannelReady(alicePage, bob.name);
            await waitForDmDataChannelReady(bobPage1, ALICE);

            await bobCtx1.close();

            const body = `l4-flush-${Date.now()}`;
            await sendChatMessage(alicePage, body);
            await expectPendingOutboundMessage(alicePage, body, {
                timeout: 30_000,
            });

            const bobCtx2 = await browser!.newContext();
            const bobPage2 = await bobCtx2.newPage();
            attachDiagnostics(bobPage2, "bob2");
            try {
                const { loginExistingAccountViaUi } =
                    await import("../lib/auth-ui");
                await loginExistingAccountViaUi(bobPage2, bob, chain.baseUrl);
                await ensureContact(bobPage2, chain.baseUrl, ALICE);
                await openChat(bobPage2, chain.baseUrl);
                await startDmWithContact(bobPage2, chain.baseUrl, ALICE);

                const aliceUsable = await waitForPeersUsable(
                    alicePage,
                    [bob.name],
                    { timeout: USABLE_MS },
                );
                expect(
                    aliceUsable,
                    "alice→bob must become usable without remesh helper",
                ).toBe(true);

                const bobReady = await waitForTransportReadyForFlush(
                    bobPage2,
                    [ALICE],
                    { timeout: USABLE_MS },
                );
                expect(
                    bobReady.usable,
                    "bob→alice must become usable without remesh helper",
                ).toBe(true);

                await expectThreadMessage(bobPage2, body, {
                    timeout: DELIVER_MS,
                });
                await expectOutboundMessageDelivered(alicePage, body, {
                    timeout: DELIVER_MS,
                });
            } finally {
                await bobCtx2.close();
            }
        } catch (err) {
            await bobCtx1.close().catch(() => {});
            throw err;
        }
    });
});
