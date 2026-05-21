import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
} from "../lib/auth-ui";
import {
    createGroupChat,
    ensureContact,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    openExistingGroupChat,
    sendChatMessage,
    waitForPeerOnline,
} from "../lib/chat-ui";
import { attachDiagnostics, snapshotStep } from "../lib/diagnostics";

const ALICE = "e2ealicegc";
const BOB = "daviddavid";
const CAROL = "e2ecarolgc";

test.describe("Chat group three-party", () => {
    test("alice's group message reaches bob and carol via mesh data channels", async ({
        chain,
        alicePage,
        browser,
    }) => {
        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const carolInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const aliceAccount = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            ALICE,
        );
        await snapshotStep(alicePage, "01-alice-account-created");

        const bobContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob");
        let bobAccount: { name: string };
        try {
            bobAccount = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );
            await snapshotStep(bobPage, "03-bob-account-created");
        } catch (e) {
            await snapshotStep(bobPage, "03-bob-account-create-FAILED");
            await bobContext.close();
            throw e;
        }

        const carolContext = await browser!.newContext();
        const carolPage = await carolContext.newPage();
        attachDiagnostics(carolPage, "carol");
        let carolAccount: { name: string };
        try {
            carolAccount = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                CAROL,
            );
            await snapshotStep(carolPage, "04-carol-account-created");
        } catch (e) {
            await snapshotStep(carolPage, "04-carol-account-create-FAILED");
            await bobContext.close();
            await carolContext.close();
            throw e;
        }

        try {
            // Full contact graph — Chat requires contacts before messaging.
            for (const [page, peer] of [
                [alicePage, bobAccount.name],
                [alicePage, carolAccount.name],
                [bobPage, aliceAccount.name],
                [bobPage, carolAccount.name],
                [carolPage, aliceAccount.name],
                [carolPage, bobAccount.name],
            ] as const) {
                await ensureContact(page, chain.baseUrl, peer);
            }

            // Alice creates the group; bob and carol join the same Space thread.
            await createGroupChat(alicePage, chain.baseUrl, [
                bobAccount.name,
                carolAccount.name,
            ]);
            await snapshotStep(alicePage, "05-alice-group-created");
            await openExistingGroupChat(bobPage, chain.baseUrl, [
                aliceAccount.name,
                carolAccount.name,
            ]);
            await snapshotStep(bobPage, "06-bob-in-group");
            await openExistingGroupChat(carolPage, chain.baseUrl, [
                aliceAccount.name,
                bobAccount.name,
            ]);
            await snapshotStep(carolPage, "07-carol-in-group");

            // All mesh legs must be up before send (mirrors DM first-send pattern).
            await waitForPeerOnline(alicePage, bobAccount.name, {
                timeout: 120_000,
            });
            await waitForPeerOnline(alicePage, carolAccount.name, {
                timeout: 120_000,
            });
            await sendChatMessage(alicePage, "hello group");
            await snapshotStep(alicePage, "08-alice-after-send");

            await expectThreadMessage(bobPage, "hello group", {
                timeout: 180_000,
            });
            await expectThreadMessage(carolPage, "hello group", {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(alicePage, "hello group", {
                timeout: 180_000,
            });
        } finally {
            await bobContext.close();
            await carolContext.close();
        }
    });
});
