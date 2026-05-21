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
    expectThreadMessage,
    openChat,
    sendChatMessage,
    startDmWithContact,
    waitForDmDataChannelReady,
    waitForGroupMeshReady,
    waitForPeerOnline,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

const ALICE = "e2emcaaaaa";
const BOB = "e2emcbbbbbb";
const CAROL = "e2emcccccc";

/**
 * Mirrors manual multi-tab churn: DM with A, DM with B, then 3-party group
 * without leaving Chat — the path that used to wedge on reconnect + H18.
 */
test.describe("Chat multi-conversation churn", () => {
    test("DM alice, DM carol, then group message delivers to both", async ({
        chain,
        alicePage,
        browser,
    }) => {
        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const carolInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const alice = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            ALICE,
        );

        const bobContext = await browser!.newContext();
        const carolContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        const carolPage = await carolContext.newPage();
        attachDiagnostics(bobPage, "bob");
        attachDiagnostics(carolPage, "carol");
        try {
            const bob = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                BOB,
            );
            const carol = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                CAROL,
            );

            for (const page of [alicePage, bobPage, carolPage]) {
                await ensureContact(page, chain.baseUrl, bob.name);
                await ensureContact(page, chain.baseUrl, carol.name);
                if (page !== alicePage) {
                    await ensureContact(page, chain.baseUrl, alice.name);
                }
            }

            await startDmWithContact(alicePage, chain.baseUrl, bob.name);
            await waitForPeerOnline(alicePage, bob.name);
            await waitForDmDataChannelReady(alicePage, bob.name);
            await sendChatMessage(alicePage, "dm to bob");
            await expectThreadMessage(bobPage, "dm to bob", {
                timeout: 180_000,
            });

            await startDmWithContact(alicePage, chain.baseUrl, carol.name);
            await waitForPeerOnline(alicePage, carol.name);
            await waitForDmDataChannelReady(alicePage, carol.name);
            await sendChatMessage(alicePage, "dm to carol");
            await expectThreadMessage(carolPage, "dm to carol", {
                timeout: 180_000,
            });

            await openChat(bobPage, chain.baseUrl);
            await openChat(carolPage, chain.baseUrl);
            await createGroupChat(alicePage, chain.baseUrl, [
                bob.name,
                carol.name,
            ]);
            await waitForGroupMeshReady(alicePage, [bob.name, carol.name]);
            await sendChatMessage(alicePage, "group hello");
            await expectThreadMessage(bobPage, "group hello", {
                timeout: 180_000,
            });
            await expectThreadMessage(carolPage, "group hello", {
                timeout: 180_000,
            });
        } finally {
            await bobContext.close();
            await carolContext.close();
        }
    });
});
