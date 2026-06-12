import { test } from "../fixtures/chain";

import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    openExistingGroupChat,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    acceptIncomingMeet,
    clickStartMeet,
    installMeetFsmGuard,
    leaveMeetCall,
    waitForIncomingMeetRing,
    waitForMeetCallStatus,
    waitForMeetEnded,
    waitForMeetFullyConnected,
} from "../lib/meet-ui";
import {
    installMeetSpecCleanup,
    meetSpecTeardownBeforeClose,
    trackMeetPage,
} from "../lib/meet-spec-hooks";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Meet group partial rejoin", () => {
    installMeetSpecCleanup(test);

    test(
        "departing member can rejoin while others remain connected",
        async ({ chain, alicePage, browser }) => {
            test.setTimeout(900_000);
            attachDiagnostics(alicePage, "alice");
            trackMeetPage(alicePage);

            const party = await setupThreePartyAccounts(
                chain,
                alicePage,
                browser!,
                "m3pr",
            );
            trackMeetPage(party.bobPage);
            trackMeetPage(party.carolPage);
            installMeetFsmGuard(alicePage, "alice");
            installMeetFsmGuard(party.bobPage, "bob");
            installMeetFsmGuard(party.carolPage, "carol");

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
                await waitForGroupMeshReady(alicePage, peers, {
                    timeout: 180_000,
                });
                await waitForGroupMeshReady(party.bobPage, [
                    party.aliceAccount.name,
                    party.carolAccount.name,
                ]);
                await waitForGroupMeshReady(party.carolPage, [
                    party.aliceAccount.name,
                    party.bobAccount.name,
                ]);

                await clickStartMeet(alicePage);
                await waitForMeetCallStatus(alicePage, "Ringing");
                await Promise.all([
                    waitForIncomingMeetRing(party.bobPage),
                    waitForIncomingMeetRing(party.carolPage),
                ]);
                await acceptIncomingMeet(party.bobPage);
                await acceptIncomingMeet(party.carolPage);
                await waitForMeetFullyConnected(alicePage, {
                    timeout: 180_000,
                });
                await waitForMeetFullyConnected(party.bobPage);
                await waitForMeetFullyConnected(party.carolPage);

                await leaveMeetCall(party.bobPage);
                await waitForMeetEnded(party.bobPage);
                await waitForMeetFullyConnected(alicePage);
                await waitForMeetFullyConnected(party.carolPage);

                await clickStartMeet(party.bobPage);
                await waitForMeetFullyConnected(party.bobPage);
                await waitForMeetFullyConnected(alicePage);
                await waitForMeetFullyConnected(party.carolPage);
            } finally {
                await meetSpecTeardownBeforeClose([
                    alicePage,
                    party.bobPage,
                    party.carolPage,
                ]);
                await party.cleanup();
            }
        },
    );
});
