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
    openChat,
    sendChatMessage,
    sendFirstDmBeforeSpaceReady,
    waitForChatConnected,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("Chat DM send before peer joins session", () => {
    /**
     * Reproduces the fast-fail path from manual testing: sender opens DM and
     * sends while the data channel is not ready; receiver opens the thread
     * seconds later. Must deliver without an endless "flush pending" loop.
     */
    test("message sent before peer opens DM is delivered when peer joins", async ({
        chain,
        alicePage,
        browser,
    }) => {
        const ALICE = uniqueE2eAccountName("dmsj");
        const BOB = uniqueE2eAccountName("dmsj");

        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        await createAccountViaInviteUrl(alicePage, aliceInvite, ALICE);

        const bobContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob");
        try {
            const bob = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );

            await ensureContact(alicePage, chain.baseUrl, bob.name);
            await ensureContact(bobPage, chain.baseUrl, ALICE);

            await sendFirstDmBeforeSpaceReady(
                alicePage,
                chain.baseUrl,
                bob.name,
                "hello before you opened",
            );

            await openChat(bobPage, chain.baseUrl);
            await waitForChatConnected(bobPage);
            const dmRow = bobPage.getByRole("button", {
                name: new RegExp(`^${ALICE}(?:,|$)`, "i"),
            });
            await dmRow.first().click({ timeout: 30_000 });
            await expect(bobPage.getByLabel("Message text")).toBeEnabled({
                timeout: 90_000,
            });

            await expectThreadMessage(bobPage, "hello before you opened", {
                timeout: 180_000,
            });

            await sendChatMessage(bobPage, "bob reply");
            await expectThreadMessage(alicePage, "bob reply", {
                timeout: 180_000,
            });
        } finally {
            await bobContext.close();
        }
    });
});
