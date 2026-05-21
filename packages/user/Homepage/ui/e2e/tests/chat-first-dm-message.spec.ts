import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    ensureContact,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    openChat,
    sendFirstDmBeforeSpaceReady,
    startDmWithContact,
    waitForChatConnected,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("First DM message before space exists", () => {
    test("queues and delivers the first outbound message from Contacts", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const aliceAccount = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            uniqueE2eAccountName("fdma"),
        );

        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob");

        try {
            const bobAccount = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                uniqueE2eAccountName("fdmb"),
            );

            await ensureContact(alicePage, chain.baseUrl, bobAccount.name);
            await ensureContact(bobPage, chain.baseUrl, aliceAccount.name);

            const firstBody = "first message before dm space existed";
            await sendFirstDmBeforeSpaceReady(
                alicePage,
                chain.baseUrl,
                bobAccount.name,
                firstBody,
            );

            await expectPendingOutboundMessage(alicePage, firstBody);

            await openChat(bobPage, chain.baseUrl);
            await waitForChatConnected(bobPage);
            await startDmWithContact(
                bobPage,
                chain.baseUrl,
                aliceAccount.name,
            );
            await expectThreadMessage(bobPage, firstBody, {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(alicePage, firstBody, {
                timeout: 180_000,
            });
        } finally {
            await bobContext.close();
        }
    });
});
