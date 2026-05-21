import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    openExistingGroupChat,
    sendChatMessage,
    waitForPeerOnline,
} from "../lib/chat-ui";

test.describe("Chat group roundtrip three-party", () => {
    test("each member sends one message and all three receive all three", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: "rtalicegc0",
            bob: "rtbobbbgc0",
            carol: "rtcarolgc0",
        });

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

            for (const [page, peers] of [
                [alicePage, [party.bobAccount.name, party.carolAccount.name]],
                [party.bobPage, [party.aliceAccount.name, party.carolAccount.name]],
                [party.carolPage, [party.aliceAccount.name, party.bobAccount.name]],
            ] as const) {
                for (const peer of peers) {
                    await waitForPeerOnline(page, peer, { timeout: 120_000 });
                }
            }

            const aliceMsg = "roundtrip-from-alice";
            const bobMsg = "roundtrip-from-bob";
            const carolMsg = "roundtrip-from-carol";

            await sendChatMessage(alicePage, aliceMsg);
            await sendChatMessage(party.bobPage, bobMsg);
            await sendChatMessage(party.carolPage, carolMsg);

            const allBodies = [aliceMsg, bobMsg, carolMsg];
            for (const [page, label] of [
                [alicePage, "alice"],
                [party.bobPage, "bob"],
                [party.carolPage, "carol"],
            ] as const) {
                for (const body of allBodies) {
                    await expectThreadMessage(page, body, { timeout: 180_000 });
                }
            }

            await expectOutboundMessageDelivered(alicePage, aliceMsg, {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(party.bobPage, bobMsg, {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(party.carolPage, carolMsg, {
                timeout: 180_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
