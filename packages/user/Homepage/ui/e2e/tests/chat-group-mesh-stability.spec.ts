import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    bootstrapGroupMeshPeers,
    createGroupChat,
    ensureContact,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    openExistingGroupChat,
    sendChatMessage,
    waitForGroupMeshReady,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("Group mesh stability", () => {
    test("group message delivers after re-selecting the thread", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const carolInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const aliceAccount = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            uniqueE2eAccountName("mesh"),
        );

        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        attachDiagnostics(bobPage, "bob");
        const carolContext = await browser.newContext();
        const carolPage = await carolContext.newPage();
        attachDiagnostics(carolPage, "carol");

        try {
            const bobAccount = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                uniqueE2eAccountName("meshb"),
            );
            const carolAccount = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                uniqueE2eAccountName("meshc"),
            );

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

            await createGroupChat(alicePage, chain.baseUrl, [
                bobAccount.name,
                carolAccount.name,
            ]);
            await openExistingGroupChat(bobPage, chain.baseUrl, [
                aliceAccount.name,
                carolAccount.name,
            ]);
            await openExistingGroupChat(carolPage, chain.baseUrl, [
                aliceAccount.name,
                bobAccount.name,
            ]);

            const meshPeers = {
                alice: [bobAccount.name, carolAccount.name],
                bob: [aliceAccount.name, carolAccount.name],
                carol: [aliceAccount.name, bobAccount.name],
            } as const;

            for (const [page, who] of [
                [alicePage, "alice"],
                [bobPage, "bob"],
                [carolPage, "carol"],
            ] as const) {
                await bootstrapGroupMeshPeers(page, meshPeers[who]);
                await waitForGroupMeshReady(page, meshPeers[who], {
                    timeout: 180_000,
                });
            }

            await sendChatMessage(alicePage, "first group ping");
            await expectThreadMessage(bobPage, "first group ping", {
                timeout: 180_000,
            });

            await alicePage
                .getByRole("button")
                .filter({ hasText: bobAccount.name })
                .first()
                .click();
            await openExistingGroupChat(alicePage, chain.baseUrl, [
                bobAccount.name,
                carolAccount.name,
            ]);

            await bootstrapGroupMeshPeers(alicePage, meshPeers.alice);
            await waitForGroupMeshReady(alicePage, meshPeers.alice, {
                timeout: 180_000,
            });

            await sendChatMessage(alicePage, "after re-select group");
            await expectThreadMessage(bobPage, "after re-select group", {
                timeout: 180_000,
            });
            await expectThreadMessage(carolPage, "after re-select group", {
                timeout: 180_000,
            });
            await expectOutboundMessageDelivered(
                alicePage,
                "after re-select group",
                { timeout: 180_000 },
            );
        } finally {
            await bobContext.close();
            await carolContext.close();
        }
    });
});
