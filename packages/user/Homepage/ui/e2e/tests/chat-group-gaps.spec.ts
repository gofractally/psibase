import { test } from "../fixtures/chain";

import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    openChat,
    openExistingGroupChat,
    sendChatMessage,
    startDmWithContact,
    waitForGroupInSidebar,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Chat group coverage gaps", () => {
    test("recipients discover a group created by another member", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "ggap1");

        try {
            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);

            await waitForGroupInSidebar(party.bobPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await waitForGroupInSidebar(party.carolPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);
        } finally {
            await party.cleanup();
        }
    });

    test("group message pending until recipients open the thread", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "ggap2");

        try {
            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await sendChatMessage(alicePage, "queued before peers opened group");
            await expectPendingOutboundMessage(
                alicePage,
                "queued before peers opened group",
            );

            await openExistingGroupChat(party.bobPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.carolPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);

            await expectThreadMessage(
                party.bobPage,
                "queued before peers opened group",
                { timeout: 180_000 },
            );
            await expectThreadMessage(
                party.carolPage,
                "queued before peers opened group",
                { timeout: 180_000 },
            );
            await expectOutboundMessageDelivered(
                alicePage,
                "queued before peers opened group",
                { timeout: 180_000 },
            );
        } finally {
            await party.cleanup();
        }
    });

    test("DM send works while a group thread is active", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "ggap3");

        try {
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

            await sendChatMessage(alicePage, "hello group");
            await expectThreadMessage(party.bobPage, "hello group", {
                timeout: 180_000,
            });

            await startDmWithContact(
                alicePage,
                chain.baseUrl,
                party.bobAccount.name,
            );
            await startDmWithContact(
                party.bobPage,
                chain.baseUrl,
                party.aliceAccount.name,
            );
            await sendChatMessage(alicePage, "hello dm side channel");
            await expectThreadMessage(party.bobPage, "hello dm side channel", {
                timeout: 180_000,
            });

            await openChat(alicePage, chain.baseUrl);
            await openExistingGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await sendChatMessage(alicePage, "hello group again");
            await expectThreadMessage(party.carolPage, "hello group again", {
                timeout: 180_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
