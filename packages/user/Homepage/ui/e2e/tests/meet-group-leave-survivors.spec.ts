import { expect, test } from "../fixtures/chain";

import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    openExistingGroupChat,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    acceptIncomingMeet,
    clickRejoinGroupMeet,
    clickStartMeet,
    expectMeetNotConnecting,
    installMeetFsmGuard,
    leaveMeetCall,
    waitForGroupMeetRejoinBanner,
    waitForIncomingMeetRing,
    waitForMeetCallPanelHidden,
    waitForMeetFullyConnected,
    waitForMeetVideoElements,
} from "../lib/meet-ui";
import { trackMeetPage } from "../lib/meet-spec-hooks";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

test.describe("Meet group leave survivors", () => {
    // Cleanup only in `finally` — afterEach teardown races with voluntary leave steps.

    test("one participant leaving keeps others connected and offers rejoin", async ({
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
            "m3ls",
        );
        trackMeetPage(party.bobPage);
        trackMeetPage(party.carolPage);
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
            await waitForMeetFullyConnected(party.bobPage);
            await acceptIncomingMeet(party.carolPage);
            await waitForMeetFullyConnected(alicePage);
            await waitForMeetFullyConnected(party.carolPage);

            await party.carolPage.bringToFront();
            const carolSelf = await party.carolPage.evaluate(
                () =>
                    (
                        globalThis as typeof globalThis & {
                            __psibaseMeetE2e?: { self: () => string | null };
                        }
                    ).__psibaseMeetE2e?.self() ?? null,
            );
            expect(carolSelf).toBe(party.carolAccount.name);
            await leaveMeetCall(party.carolPage);
            await waitForMeetCallPanelHidden(party.carolPage);
            await waitForGroupMeetRejoinBanner(party.carolPage);

            await waitForMeetFullyConnected(alicePage);
            await waitForMeetFullyConnected(party.bobPage);
            await expectMeetNotConnecting(alicePage);
            await expectMeetNotConnecting(party.bobPage);
            await waitForMeetVideoElements(alicePage, 1);
            await waitForMeetVideoElements(party.bobPage, 1);

            await clickRejoinGroupMeet(party.carolPage);
            await waitForMeetFullyConnected(party.carolPage);
            await waitForMeetVideoElements(party.carolPage, 2);
        } finally {
            await party.cleanup();
        }
    });
});
