import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectPendingOutboundMessage,
    expectThreadMessage,
    leaveChatToHome,
    openChat,
    openExistingGroupChat,
    sendChatMessage,
    startDmWithContact,
    waitForChatConnected,
    waitForGroupMeshReady,
    waitForPeerOnline,
} from "../lib/chat-ui";

/** Fixed names (≥10 chars) for a fresh chain boot. */
const ALICE = "oofalice01";
const BOB = "oofbobbb01";
const CAROL = "oofcarol01";

const DM_OFFLINE = "dm-a-to-b-while-b-offline";
const GROUP_FROM_A = "group-a-first";
const GROUP_FROM_B = "group-b-reply";

/**
 * Scripted three-party flow: pending DM to an offline peer, then group chat
 * with one peer already in-app and one opening Chat only at the end.
 */
test.describe("Chat three-party online/offline flow", () => {
    test("pending DM then group with staggered joiners", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: ALICE,
            bob: BOB,
            carol: CAROL,
        });

        const groupPeers = (who: "alice" | "bob" | "carol") => {
            if (who === "alice") {
                return [party.bobAccount.name, party.carolAccount.name];
            }
            if (who === "bob") {
                return [party.aliceAccount.name, party.carolAccount.name];
            }
            return [party.aliceAccount.name, party.bobAccount.name];
        };

        try {
            // (a) Alice messages Bob while Bob has never opened Chat.
            await startDmWithContact(
                alicePage,
                chain.baseUrl,
                party.bobAccount.name,
            );
            await sendChatMessage(alicePage, DM_OFFLINE);
            await expectPendingOutboundMessage(alicePage, DM_OFFLINE);

            await startDmWithContact(
                party.bobPage,
                chain.baseUrl,
                party.aliceAccount.name,
            );
            await expectThreadMessage(party.bobPage, DM_OFFLINE, {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(alicePage, DM_OFFLINE, {
                timeout: 180_000,
            });

            // Bob was in Chat for (a); we leave and re-enter so group mesh can form
            // (DM + group on one socket without this reset leaves mesh stuck — H18).
            await leaveChatToHome(alicePage, chain.baseUrl);
            await leaveChatToHome(party.bobPage, chain.baseUrl);

            // (b) Alice creates ABC group; Bob re-enters Chat and joins the thread.
            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(
                alicePage,
                chain.baseUrl,
                groupPeers("alice"),
            );
            await openExistingGroupChat(
                party.bobPage,
                chain.baseUrl,
                groupPeers("bob"),
            );
            await waitForPeerOnline(alicePage, party.bobAccount.name, {
                timeout: 120_000,
            });
            await waitForPeerOnline(party.bobPage, party.aliceAccount.name, {
                timeout: 120_000,
            });
            await waitForGroupMeshReady(alicePage, [party.bobAccount.name], {
                timeout: 300_000,
            });
            await waitForGroupMeshReady(party.bobPage, [party.aliceAccount.name], {
                timeout: 300_000,
            });
            await sendChatMessage(alicePage, GROUP_FROM_A);
            await expectThreadMessage(party.bobPage, GROUP_FROM_A, {
                timeout: 240_000,
            });

            // (c) Bob replies in group; Alice (still on group thread) sees it.
            await sendChatMessage(party.bobPage, GROUP_FROM_B);
            await expectThreadMessage(alicePage, GROUP_FROM_B, {
                timeout: 240_000,
            });

            // (d) Carol opens Chat for the first time; history catch-up via late-joiner mesh.
            await openChat(party.carolPage, chain.baseUrl);
            await waitForChatConnected(party.carolPage);
            await openExistingGroupChat(
                party.carolPage,
                chain.baseUrl,
                groupPeers("carol"),
            );
            for (const peer of groupPeers("carol")) {
                await waitForPeerOnline(party.carolPage, peer, {
                    timeout: 180_000,
                });
            }
            await expectThreadMessage(party.carolPage, GROUP_FROM_A, {
                timeout: 300_000,
            });
            await expectThreadMessage(party.carolPage, GROUP_FROM_B, {
                timeout: 300_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
