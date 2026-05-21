
import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginExistingAccountViaUi,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
    type TestAccount,
} from "../lib/auth-ui";
import {
    assertChatDataHealthy,
    bootstrapDmPeer,
    ensureContact,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    openChat,
    sendChatMessage,
    startDmWithContact,
    waitForDmPeerReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("Chat DM pending flush on rejoin", () => {
    test("queued DM arrives after peer reopens chat", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        const ALICE = uniqueE2eAccountName("dmrj");
        const BOB = uniqueE2eAccountName("dmrj");

        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const aliceAccount = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            ALICE,
        );

        const bobContext = await browser!.newContext();
        let bobAccount: TestAccount;
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob1");
        try {
            bobAccount = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );

            await ensureContact(alicePage, chain.baseUrl, bobAccount.name);
            await ensureContact(bobPage, chain.baseUrl, aliceAccount.name);

            // Bob1 opens the DM thread so the chat-data session is created
            // on chain and Bob is recorded as having joined at least once.
            // No baseline message exchange — that path is covered separately.
            await startDmWithContact(bobPage, chain.baseUrl, aliceAccount.name);
            await startDmWithContact(alicePage, chain.baseUrl, bobAccount.name);
            await bootstrapDmPeer(bobPage, aliceAccount.name);
            await bootstrapDmPeer(alicePage, bobAccount.name);
            await waitForDmPeerReady(bobPage, aliceAccount.name, {
                timeout: 120_000,
            });
            await waitForDmPeerReady(alicePage, bobAccount.name, {
                timeout: 120_000,
            });
        } finally {
            console.log("[bob1] closing context");
            await bobContext.close();
        }

        await openChat(alicePage, chain.baseUrl);
        await startDmWithContact(alicePage, chain.baseUrl, bobAccount!.name);
        await sendChatMessage(alicePage, "queued while bob was away");
        await expectPendingOutboundMessage(alicePage, "queued while bob was away");

        const bobCtx2 = await browser!.newContext();
        const bobPage2 = await bobCtx2.newPage();
        attachDiagnostics(bobPage2, "bob2");
        try {
            await loginExistingAccountViaUi(
                bobPage2,
                bobAccount!,
                chain.baseUrl,
            );
            await ensureContact(bobPage2, chain.baseUrl, aliceAccount.name);
            await startDmWithContact(bobPage2, chain.baseUrl, aliceAccount.name);
            await bootstrapDmPeer(bobPage2, aliceAccount.name);
            await bootstrapDmPeer(alicePage, bobAccount!.name);
            await waitForDmPeerReady(bobPage2, aliceAccount.name, {
                timeout: 180_000,
            });

            await expectThreadMessage(bobPage2, "queued while bob was away", {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(
                alicePage,
                "queued while bob was away",
                { timeout: 180_000 },
            );
            await assertChatDataHealthy(alicePage);
            await assertChatDataHealthy(bobPage2);
        } finally {
            await bobCtx2.close();
        }
    });
});
