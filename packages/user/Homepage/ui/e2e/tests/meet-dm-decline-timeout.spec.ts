import { test } from "../fixtures/chain";
import {
    PRODUCER_ACCOUNT,
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
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
    installMeetSpecCleanup,
    meetSpecTeardownBeforeClose,
    trackMeetPage,
} from "../lib/meet-spec-hooks";
import {
    clickStartMeet,
    declineIncomingMeet,
    expectNoIncomingMeetRing,
    waitForIncomingMeetRing,
    waitForMeetCallPanelHidden,
    waitForMeetCallStatus,
    waitForMeetTerminalMessage,
} from "../lib/meet-ui";

test.describe("Meet DM decline / timeout", () => {
    installMeetSpecCleanup(test);

    test("bob declines alice's call → alice sees Call declined", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");
        trackMeetPage(alicePage);

        const ALICE = uniqueE2eAccountName("mdec");
        const BOB = uniqueE2eAccountName("mdec");

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
            // Wait for terminal copy in parallel with decline — CallView dismisses quickly.
            const aliceSawDeclined = waitForMeetTerminalMessage(
                alicePage,
                "Call declined",
            );
            await declineIncomingMeet(bobPage);
            await expectNoIncomingMeetRing(bobPage);
            await aliceSawDeclined;
            await waitForMeetCallPanelHidden(alicePage);
        } finally {
            await meetSpecTeardownBeforeClose([alicePage, bobPage]);
            await bobContext.close();
        }
    });

    test("alice times out while bob never accepts → No answer", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");
        trackMeetPage(alicePage);

        const ALICE = uniqueE2eAccountName("mto");
        const BOB = uniqueE2eAccountName("mto");

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
            // Bob never accepts — caller ring budget is 20s.
            await waitForMeetTerminalMessage(alicePage, "No answer", {
                timeout: 45_000,
            });
            await expectNoIncomingMeetRing(bobPage, { timeout: 15_000 });
            await waitForMeetCallPanelHidden(alicePage);
        } finally {
            await meetSpecTeardownBeforeClose([alicePage, bobPage]);
            await bobContext.close();
        }
    });
});
