import { test } from "../fixtures/chain";

import {
    loginExistingAccountViaUi,
} from "../lib/auth-ui";
import {
    createGroupChat,
    ensureContact,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    leaveChatToHome,
    openChat,
    openExistingGroupChat,
    sendChatMessage,
    waitForChatConnected,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

const HISTORY_SYNC_ACK_MSG = "history-sync-ack-clear";

/**
 * Manual repro: alice sends while carol is offline; carol reopens and learns
 * the message from bob's history push without a direct alice-carol ack path.
 * Sender pending must still clear once carol accepts synced history.
 */
test.describe("Chat group history sync ack", () => {
    test("sender pending clears after offline peer receives history sync", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(
            chain,
            alicePage,
            browser!,
            "hsyncack",
        );

        try {
            await openChat(alicePage, chain.baseUrl);
            await openChat(party.bobPage, chain.baseUrl);
            await openChat(party.carolPage, chain.baseUrl);
            await waitForChatConnected(alicePage, { timeout: 120_000 });
            await waitForChatConnected(party.bobPage, { timeout: 120_000 });
            await waitForChatConnected(party.carolPage, { timeout: 120_000 });

            // Reset socket/mesh state before group (same as three-party flow H18).
            await leaveChatToHome(alicePage, chain.baseUrl);
            await leaveChatToHome(party.bobPage, chain.baseUrl);
            await leaveChatToHome(party.carolPage, chain.baseUrl);

            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.bobPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.carolPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);
            // Initiator (alice) negotiates both legs; establish one peer at a time.
            await waitForGroupMeshReady(alicePage, [party.bobAccount.name], {
                timeout: 300_000,
            });
            await waitForGroupMeshReady(
                alicePage,
                [party.carolAccount.name],
                { timeout: 300_000 },
            );
            await waitForGroupMeshReady(
                party.bobPage,
                [party.aliceAccount.name, party.carolAccount.name],
                { timeout: 300_000 },
            );
            await waitForGroupMeshReady(
                party.carolPage,
                [party.aliceAccount.name, party.bobAccount.name],
                { timeout: 300_000 },
            );

            await party.carolPage.context().close();

            await sendChatMessage(alicePage, HISTORY_SYNC_ACK_MSG);
            await expectThreadMessage(party.bobPage, HISTORY_SYNC_ACK_MSG, {
                timeout: 240_000,
            });
            await expectPendingOutboundMessage(alicePage, HISTORY_SYNC_ACK_MSG);

            const carolContext = await browser!.newContext();
            const carolPage = await carolContext.newPage();
            attachDiagnostics(carolPage, "carol-rejoin");
            try {
                await loginExistingAccountViaUi(
                    carolPage,
                    party.carolAccount,
                    chain.baseUrl,
                );
                await ensureContact(
                    carolPage,
                    chain.baseUrl,
                    party.aliceAccount.name,
                );
                await ensureContact(
                    carolPage,
                    chain.baseUrl,
                    party.bobAccount.name,
                );
                await openChat(carolPage, chain.baseUrl);
                await waitForChatConnected(carolPage, { timeout: 120_000 });
                await openExistingGroupChat(carolPage, chain.baseUrl, [
                    party.aliceAccount.name,
                    party.bobAccount.name,
                ]);

                await expectThreadMessage(carolPage, HISTORY_SYNC_ACK_MSG, {
                    timeout: 240_000,
                });
                await expectOutboundMessageDelivered(
                    alicePage,
                    HISTORY_SYNC_ACK_MSG,
                    { timeout: 240_000 },
                );
            } finally {
                await carolContext.close().catch(() => {});
            }
        } finally {
            await party.cleanup();
        }
    });
});
