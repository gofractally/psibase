import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    ensureContact,
    startDmWithContact,
    waitForDmDataChannelReady,
    waitForPeerOnline,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    acceptIncomingMeet,
    clickStartMeet,
    endMeetCall,
    waitForIncomingMeetRing,
    waitForMeetCallStatus,
    waitForMeetEnded,
    waitForMeetVideoElements,
} from "../lib/meet-ui";
import {
    installMeetSpecCleanup,
    meetSpecTeardownBeforeClose,
    trackMeetPage,
} from "../lib/meet-spec-hooks";

test.describe("Meet DM two-party", () => {
    installMeetSpecCleanup(test);

    test("alice calls bob: ring, accept, media, exit, and bob rejoins while alice stays", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");
        trackMeetPage(alicePage);

        const ALICE = uniqueE2eAccountName("m2a");
        const BOB = uniqueE2eAccountName("m2b");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        await createAccountViaInviteUrl(alicePage, aliceInvite, ALICE);

        const bobContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob");
        trackMeetPage(bobPage);

        try {
            const bob = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );

            await ensureContact(alicePage, chain.baseUrl, bob.name);
            await ensureContact(bobPage, chain.baseUrl, ALICE);

            await startDmWithContact(bobPage, chain.baseUrl, ALICE);
            await startDmWithContact(alicePage, chain.baseUrl, bob.name);
            await waitForPeerOnline(alicePage, bob.name, { timeout: 120_000 });
            await waitForPeerOnline(bobPage, ALICE, { timeout: 120_000 });
            await waitForDmDataChannelReady(alicePage, bob.name);
            await waitForDmDataChannelReady(bobPage, ALICE);

            await clickStartMeet(alicePage);
            await waitForMeetCallStatus(alicePage, "Ringing");
            await waitForIncomingMeetRing(bobPage);
            await acceptIncomingMeet(bobPage);

            await waitForMeetCallStatus(alicePage, "Connected");
            await waitForMeetCallStatus(bobPage, "Connected");
            await waitForMeetVideoElements(alicePage, 1);
            await waitForMeetVideoElements(bobPage, 1);

            await endMeetCall(bobPage);
            await waitForMeetEnded(bobPage);
            await waitForMeetEnded(alicePage);

            await clickStartMeet(alicePage);
            await waitForMeetCallStatus(alicePage, "Ringing");
            await waitForIncomingMeetRing(bobPage);
            await acceptIncomingMeet(bobPage);
            await waitForMeetCallStatus(alicePage, "Connected");
            await waitForMeetCallStatus(bobPage, "Connected");

            await endMeetCall(alicePage);
            await waitForMeetEnded(alicePage);
            await waitForMeetEnded(bobPage);
        } finally {
            await meetSpecTeardownBeforeClose([alicePage, bobPage]);
            await bobContext.close();
        }
    });
});
