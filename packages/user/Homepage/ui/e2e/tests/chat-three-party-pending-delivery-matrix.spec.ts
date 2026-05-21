import { expect, test } from "../fixtures/chain";

import { loginExistingAccountViaUi } from "../lib/auth-ui";
import {
    assertChatDataHealthy,
    assertPendingDeliveredForPair,
    createGroupChat,
    ensureContact,
    expectPendingOutboundMessage,
    expectThreadMessage,
    groupConversationButton,
    openChat,
    leaveChatToHome,
    openExistingGroupChat,
    sendChatMessage,
    sendFirstDmBeforeSpaceReady,
    startDmWithContact,
    waitForChatConnected,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

const DM_PENDING = "matrix-dm-while-bob-offline";
const GROUP_PENDING = "matrix-group-while-bob-offline";

/**
 * Manual repro: DM to peer who never opened Chat, switch to group without
 * leaving Chat, group send while one member offline, staggered rejoin per pair.
 */
test.describe("Chat three-party pending delivery matrix", () => {
    test("pairwise delivery after offline peer and in-chat thread switch", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: "mtxalice01",
            bob: "mtxbobbb01",
            carol: "mtxcarol01",
        });

        const bobAccount = party.bobAccount;
        await party.bobPage.context().close();

        try {
            // H18: hard reload leaves WS wedged; leave Chat and re-enter after bob offline.
            await leaveChatToHome(alicePage, chain.baseUrl);
            await leaveChatToHome(party.carolPage, chain.baseUrl);
            await openChat(alicePage, chain.baseUrl);
            await openChat(party.carolPage, chain.baseUrl);
            await waitForChatConnected(alicePage, { timeout: 120_000 });
            await waitForChatConnected(party.carolPage, { timeout: 120_000 });

            await sendFirstDmBeforeSpaceReady(
                alicePage,
                chain.baseUrl,
                bobAccount.name,
                DM_PENDING,
            );
            await expectPendingOutboundMessage(alicePage, DM_PENDING);

            await createGroupChat(alicePage, chain.baseUrl, [
                bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.carolPage, chain.baseUrl, [
                party.aliceAccount.name,
                bobAccount.name,
            ]);

            const groupBtn = groupConversationButton(alicePage, [
                bobAccount.name,
                party.carolAccount.name,
            ]);
            await groupBtn.first().click({ timeout: 30_000 });
            await expect(alicePage.getByLabel("Message text")).toBeEnabled({
                timeout: 90_000,
            });

            await sendChatMessage(alicePage, GROUP_PENDING);
            await expectThreadMessage(party.carolPage, GROUP_PENDING, {
                timeout: 240_000,
            });

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
                    party.aliceAccount.name,
                );
                await openChat(bobPage2, chain.baseUrl);
                await waitForChatConnected(bobPage2);
                await startDmWithContact(
                    bobPage2,
                    chain.baseUrl,
                    party.aliceAccount.name,
                );
                await startDmWithContact(
                    alicePage,
                    chain.baseUrl,
                    bobAccount.name,
                );

                await assertPendingDeliveredForPair(
                    alicePage,
                    bobPage2,
                    party.aliceAccount.name,
                    bobAccount.name,
                    DM_PENDING,
                    { kind: "dm", timeout: 240_000 },
                );

                await openExistingGroupChat(bobPage2, chain.baseUrl, [
                    party.aliceAccount.name,
                    party.carolAccount.name,
                ]);
                await assertPendingDeliveredForPair(
                    alicePage,
                    bobPage2,
                    party.aliceAccount.name,
                    bobAccount.name,
                    GROUP_PENDING,
                    { kind: "group", timeout: 240_000 },
                );

                await assertChatDataHealthy(alicePage);
                await assertChatDataHealthy(bobPage2);
            } finally {
                await bobCtx2.close();
            }
        } finally {
            await party.cleanup();
        }
    });
});
