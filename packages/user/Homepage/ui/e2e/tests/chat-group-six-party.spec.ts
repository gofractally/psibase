import { test } from "../fixtures/chain";

import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    openExistingGroupChat,
    sendChatMessage,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import { setupSixPartyAccounts, type SixPartyMemberKey } from "../lib/setup-six-party";

const OTHER_MEMBERS: SixPartyMemberKey[] = ["bob", "carol", "dave", "eve", "frank"];

test.describe("Chat group six-party", () => {
    test("alice's group message reaches all five other members", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupSixPartyAccounts(chain, alicePage, browser!, "g6");

        try {
            const otherMemberNames = OTHER_MEMBERS.map((key) => party.accounts[key].name);

            await createGroupChat(alicePage, chain.baseUrl, otherMemberNames);

            for (const key of OTHER_MEMBERS) {
                await openExistingGroupChat(
                    party.pages[key],
                    chain.baseUrl,
                    party.peerNamesExcept(party.accounts[key].name),
                );
            }

            const allPages = [
                { page: alicePage, self: party.accounts.alice.name },
                ...OTHER_MEMBERS.map((key) => ({
                    page: party.pages[key],
                    self: party.accounts[key].name,
                })),
            ] as const;

            for (const { page, self } of allPages) {
                const peers = party.peerNamesExcept(self);
                await bootstrapGroupMeshPeers(page, peers);
                await waitForGroupMeshReady(page, peers, { timeout: 300_000 });
            }

            const body = "hello six-party group";
            await sendChatMessage(alicePage, body);

            for (const key of OTHER_MEMBERS) {
                await expectThreadMessage(party.pages[key], body, {
                    timeout: 300_000,
                });
            }
            await expectOutboundMessageDelivered(alicePage, body, {
                timeout: 300_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
