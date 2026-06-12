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
    endMeetCall,
    waitForIncomingMeetRing,
    waitForMeetCallStatus,
    waitForMeetEnded,
} from "../lib/meet-ui";
import {
    installMeetSpecCleanup,
    meetSpecTeardownBeforeClose,
    trackMeetPage,
} from "../lib/meet-spec-hooks";
import {
    setupSixPartyAccounts,
    type SixPartyMemberKey,
} from "../lib/setup-six-party";

const OTHER_MEMBERS: SixPartyMemberKey[] = [
    "bob",
    "carol",
    "dave",
    "eve",
    "frank",
];

test.describe("Meet group six-party", () => {
    installMeetSpecCleanup(test);

    test("alice starts Meet, all five ring and connect; one member leaves and rejoins", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(1_200_000);
        attachDiagnostics(alicePage, "alice");
        trackMeetPage(alicePage);

        const party = await setupSixPartyAccounts(chain, alicePage, browser!, "m6");
        for (const key of OTHER_MEMBERS) {
            trackMeetPage(party.pages[key]);
        }

        try {
            const otherMemberNames = OTHER_MEMBERS.map(
                (key) => party.accounts[key].name,
            );

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

            await clickStartMeet(alicePage);
            await waitForMeetCallStatus(alicePage, "Ringing");

            await Promise.all(
                OTHER_MEMBERS.map((key) =>
                    waitForIncomingMeetRing(party.pages[key], {
                        timeout: 240_000,
                    }),
                ),
            );

            for (const key of OTHER_MEMBERS) {
                await acceptIncomingMeet(party.pages[key]);
            }

            await waitForMeetCallStatus(alicePage, "Connected", {
                timeout: 300_000,
            });
            for (const key of OTHER_MEMBERS) {
                await waitForMeetCallStatus(party.pages[key], "Connected", {
                    timeout: 300_000,
                });
            }

            await Promise.all(allPages.map(({ page }) => endMeetCall(page)));
            for (const { page } of allPages) {
                await waitForMeetEnded(page);
            }

            await clickStartMeet(alicePage);
            await waitForMeetCallStatus(alicePage, "Ringing", {
                timeout: 120_000,
            });
            await Promise.all(
                OTHER_MEMBERS.map((key) =>
                    waitForIncomingMeetRing(party.pages[key], {
                        timeout: 240_000,
                    }),
                ),
            );
            for (const key of OTHER_MEMBERS) {
                await acceptIncomingMeet(party.pages[key]);
            }
            await waitForMeetCallStatus(alicePage, "Connected", {
                timeout: 300_000,
            });
        } finally {
            await meetSpecTeardownBeforeClose([
                alicePage,
                ...OTHER_MEMBERS.map((key) => party.pages[key]),
            ]);
            await party.cleanup();
        }
    });
});
