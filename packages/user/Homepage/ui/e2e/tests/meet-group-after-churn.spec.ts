import { test } from "../fixtures/chain";

import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    leaveChatToHome,
    openChat,
    openExistingGroupChat,
    startDmWithContact,
    waitForDmDataChannelReady,
    waitForGroupMeshReady,
    waitForPeerOnline,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    acceptIncomingMeet,
    clickStartMeet,
    installMeetFsmGuard,
    waitForIncomingMeetRing,
    waitForMeetFullyConnected,
    waitForMeetVideoElements,
} from "../lib/meet-ui";
import {
    installMeetSpecCleanup,
    meetSpecTeardownBeforeClose,
    trackMeetPage,
} from "../lib/meet-spec-hooks";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Meet group after churn", () => {
    installMeetSpecCleanup(test);

    test("group Meet succeeds after DM mesh churn and chat navigation", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");
        installMeetFsmGuard(alicePage, "alice");
        trackMeetPage(alicePage);

        const party = await setupThreePartyAccounts(
            chain,
            alicePage,
            browser!,
            "m3ch",
        );
        trackMeetPage(party.bobPage);
        trackMeetPage(party.carolPage);
        installMeetFsmGuard(party.bobPage, "bob");
        installMeetFsmGuard(party.carolPage, "carol");

        try {
            await startDmWithContact(alicePage, chain.baseUrl, party.bobAccount.name);
            await startDmWithContact(party.bobPage, chain.baseUrl, party.aliceAccount.name);
            await waitForPeerOnline(alicePage, party.bobAccount.name);
            await waitForPeerOnline(party.bobPage, party.aliceAccount.name);
            await waitForDmDataChannelReady(alicePage, party.bobAccount.name);
            await waitForDmDataChannelReady(party.bobPage, party.aliceAccount.name);

            await startDmWithContact(alicePage, chain.baseUrl, party.carolAccount.name);
            await startDmWithContact(party.carolPage, chain.baseUrl, party.aliceAccount.name);
            await waitForPeerOnline(alicePage, party.carolAccount.name);
            await waitForPeerOnline(party.carolPage, party.aliceAccount.name);
            await waitForDmDataChannelReady(alicePage, party.carolAccount.name);
            await waitForDmDataChannelReady(party.carolPage, party.aliceAccount.name);

            await leaveChatToHome(alicePage, chain.baseUrl);
            await openChat(alicePage, chain.baseUrl);

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

            const peers = [party.bobAccount.name, party.carolAccount.name];
            await bootstrapGroupMeshPeers(alicePage, peers);
            await bootstrapGroupMeshPeers(party.bobPage, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await bootstrapGroupMeshPeers(party.carolPage, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);
            await waitForGroupMeshReady(alicePage, peers, { timeout: 180_000 });
            await waitForGroupMeshReady(party.bobPage, [
                party.aliceAccount.name,
                party.carolAccount.name,
            ]);
            await waitForGroupMeshReady(party.carolPage, [
                party.aliceAccount.name,
                party.bobAccount.name,
            ]);

            await clickStartMeet(alicePage);
            await Promise.all([
                waitForIncomingMeetRing(party.bobPage),
                waitForIncomingMeetRing(party.carolPage),
            ]);
            await acceptIncomingMeet(party.bobPage);
            await party.carolPage.waitForTimeout(8_000);
            await acceptIncomingMeet(party.carolPage);

            await waitForMeetFullyConnected(alicePage);
            await waitForMeetFullyConnected(party.bobPage);
            await waitForMeetFullyConnected(party.carolPage);
            await waitForMeetVideoElements(alicePage, 2);
            await waitForMeetVideoElements(party.bobPage, 2);
            await waitForMeetVideoElements(party.carolPage, 2);
        } finally {
            await meetSpecTeardownBeforeClose([
                alicePage,
                party.bobPage,
                party.carolPage,
            ]);
            await party.cleanup();
        }
    });
});
