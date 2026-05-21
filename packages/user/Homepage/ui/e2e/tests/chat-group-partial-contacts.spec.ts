import { test, expect } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
} from "../lib/auth-ui";
import {
    createGroupChat,
    ensureContact,
    groupConversationButton,
    openChat,
    waitForChatConnected,
    waitForGroupInSidebar,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

test.describe("Group visibility with partial contacts", () => {
    test("hides group until every other member is a contact", async ({
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
            "nancynancy",
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
                "oscaroscar",
            );
            const carolAccount = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                "paulpaulpa",
            );

            for (const [page, peer] of [
                [alicePage, bobAccount.name],
                [alicePage, carolAccount.name],
                [bobPage, aliceAccount.name],
                [carolPage, aliceAccount.name],
                [carolPage, bobAccount.name],
            ] as const) {
                await ensureContact(page, chain.baseUrl, peer);
            }

            await createGroupChat(alicePage, chain.baseUrl, [
                bobAccount.name,
                carolAccount.name,
            ]);

            await waitForGroupInSidebar(carolPage, chain.baseUrl, [
                aliceAccount.name,
                bobAccount.name,
            ]);

            await openChat(bobPage, chain.baseUrl);
            await waitForChatConnected(bobPage);
            const hiddenGroup = groupConversationButton(bobPage, [
                aliceAccount.name,
                carolAccount.name,
            ]);
            await expect(hiddenGroup.first()).not.toBeVisible({
                timeout: 15_000,
            });

            await ensureContact(bobPage, chain.baseUrl, carolAccount.name);

            await waitForGroupInSidebar(bobPage, chain.baseUrl, [
                aliceAccount.name,
                carolAccount.name,
            ]);
        } finally {
            await bobContext.close();
            await carolContext.close();
        }
    });
});
