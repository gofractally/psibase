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
    bootstrapDmPeer,
    ensureContact,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    leaveChatToHome,
    openChat,
    openDmThread,
    sendChatMessage,
    startDmWithContact,
    waitForChatConnected,
    waitForDmPeerReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("Chat DM pending with app churn", () => {
    test("pending DM delivers after peer reopens chat following home ↔ chat churn", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        const ALICE = uniqueE2eAccountName("dmch");
        const BOB = uniqueE2eAccountName("dmch");

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
            await startDmWithContact(bobPage, chain.baseUrl, aliceAccount.name);
            await startDmWithContact(alicePage, chain.baseUrl, bobAccount.name);
        } finally {
            await bobContext.close();
        }

        await openChat(alicePage, chain.baseUrl);
        await startDmWithContact(alicePage, chain.baseUrl, bobAccount.name);

        const pendingMsg = "dm-pending-after-churn";
        await sendChatMessage(alicePage, pendingMsg);
        await expectPendingOutboundMessage(alicePage, pendingMsg);

        // Alice churns in/out of Chat while Bob is still offline. Use openDmThread
        // (not full startDmWithContact) to avoid WS/composer reconnect storms.
        for (let i = 0; i < 2; i++) {
            await leaveChatToHome(alicePage, chain.baseUrl);
            await openChat(alicePage, chain.baseUrl);
            await waitForChatConnected(alicePage);
            await openDmThread(alicePage, chain.baseUrl, bobAccount.name);
        }

        const bobCtx2 = await browser!.newContext();
        const bobPage2 = await bobCtx2.newPage();
        attachDiagnostics(bobPage2, "bob2");
        try {
            await loginExistingAccountViaUi(
                bobPage2,
                bobAccount,
                chain.baseUrl,
            );
            await ensureContact(
                bobPage2,
                chain.baseUrl,
                aliceAccount.name,
            );
            await leaveChatToHome(bobPage2, chain.baseUrl);
            await startDmWithContact(bobPage2, chain.baseUrl, aliceAccount.name);
            await bootstrapDmPeer(bobPage2, aliceAccount.name);
            await bootstrapDmPeer(alicePage, bobAccount.name);
            await waitForDmPeerReady(bobPage2, aliceAccount.name, {
                timeout: 180_000,
            });

            await expectThreadMessage(bobPage2, pendingMsg, {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(alicePage, pendingMsg, {
                timeout: 180_000,
            });
        } finally {
            await bobCtx2.close();
        }
    });
});
