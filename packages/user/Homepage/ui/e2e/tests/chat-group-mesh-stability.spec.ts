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
    waitForGroupInSidebar,
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
            "quinnquinn",
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
                "ruthruthru",
            );
            const carolAccount = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                "samsamsamx",
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
