import { test } from "../fixtures/chain";

import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    bootstrapGroupMeshPeers,
    openExistingGroupChat,
    sendChatMessage,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics, snapshotStep } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Chat group three-party", () => {
    test("alice's group message reaches bob and carol via mesh data channels", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(
            chain,
            alicePage,
            browser!,
            "g3tp",
        );
        await snapshotStep(alicePage, "01-alice-account-created");
        await snapshotStep(party.bobPage, "03-bob-account-created");
        await snapshotStep(party.carolPage, "04-carol-account-created");

        try {
            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await snapshotStep(alicePage, "05-alice-group-created");
            await openExistingGroupChat(party.bobPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await snapshotStep(party.bobPage, "06-bob-in-group");
            await openExistingGroupChat(party.carolPage, chain.baseUrl, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);
            await snapshotStep(party.carolPage, "07-carol-in-group");

            await bootstrapGroupMeshPeers(alicePage, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await bootstrapGroupMeshPeers(party.bobPage, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await bootstrapGroupMeshPeers(party.carolPage, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);

            await waitForGroupMeshReady(
                alicePage,
                [party.bobAccount.name, party.carolAccount.name],
                { timeout: 180_000 },
            );
            await sendChatMessage(alicePage, "hello group");
            await snapshotStep(alicePage, "08-alice-after-send");

            await expectThreadMessage(party.bobPage, "hello group", {
                timeout: 180_000,
            });
            await expectThreadMessage(party.carolPage, "hello group", {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(alicePage, "hello group", {
                timeout: 180_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
