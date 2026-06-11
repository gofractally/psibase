import { test } from "../fixtures/chain";

import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    openExistingGroupChat,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics, snapshotStep } from "../lib/diagnostics";
import {
    acceptIncomingMeet,
    clickStartMeet,
    endMeetCall,
    waitForIncomingMeetRing,
    waitForMeetCallStatus,
    waitForMeetEnded,
    waitForMeetVideoElements,
} from "../lib/meet-ui";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Meet group three-party", () => {
    test("group Meet rings all members, connects media, supports exit and rejoin", async ({
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
            "m3tp",
        );
        await snapshotStep(alicePage, "01-alice-ready");
        await snapshotStep(party.bobPage, "02-bob-ready");
        await snapshotStep(party.carolPage, "03-carol-ready");

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
            await waitForMeetCallStatus(alicePage, "Ringing");
            await snapshotStep(alicePage, "04-alice-ringing");

            await Promise.all([
                waitForIncomingMeetRing(party.bobPage),
                waitForIncomingMeetRing(party.carolPage),
            ]);
            await acceptIncomingMeet(party.bobPage);
            await acceptIncomingMeet(party.carolPage);
            await snapshotStep(party.bobPage, "05-bob-accepted");
            await snapshotStep(party.carolPage, "06-carol-accepted");

            await waitForMeetCallStatus(alicePage, "Connected");
            await waitForMeetCallStatus(party.bobPage, "Connected");
            await waitForMeetCallStatus(party.carolPage, "Connected");
            await waitForMeetVideoElements(alicePage, 1);
            await waitForMeetVideoElements(party.bobPage, 1);
            await waitForMeetVideoElements(party.carolPage, 1);
            await snapshotStep(alicePage, "07-all-connected");

            await Promise.all([
                endMeetCall(alicePage),
                endMeetCall(party.bobPage),
                endMeetCall(party.carolPage),
            ]);
            await waitForMeetEnded(alicePage);
            await waitForMeetEnded(party.bobPage);
            await waitForMeetEnded(party.carolPage);

            await clickStartMeet(alicePage);
            await waitForMeetCallStatus(alicePage, "Ringing");
            await Promise.all([
                waitForIncomingMeetRing(party.bobPage),
                waitForIncomingMeetRing(party.carolPage),
            ]);
            await acceptIncomingMeet(party.bobPage);
            await acceptIncomingMeet(party.carolPage);
            await waitForMeetCallStatus(alicePage, "Connected");
            await waitForMeetCallStatus(party.bobPage, "Connected");
            await waitForMeetCallStatus(party.carolPage, "Connected");
            await snapshotStep(alicePage, "08-rejoined-call");
        } finally {
            await party.cleanup();
        }
    });
});
