import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    establishThreePartyGroupMeshCarolLast,
    expectThreadMessage,
    GROUP_MESH_TIMEOUT_MS,
    leaveChatToHome,
    openChat,
    openExistingGroupChat,
    resetThreePartyChatBeforeGroup,
    sendChatMessage,
    waitForChatConnected,
    waitForGroupMeshReady,
} from "../lib/chat-ui";

test.describe("Chat group offline member catch-up", () => {
    test("alice receives message sent while her browser was closed", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "ocatch");

        const pages = {
            alice: alicePage,
            bob: party.bobPage,
            carol: party.carolPage,
        };
        const accounts = {
            alice: party.aliceAccount.name,
            bob: party.bobAccount.name,
            carol: party.carolAccount.name,
        };
        const groupPeersFor = (who: "alice" | "bob" | "carol") => {
            if (who === "alice") return [accounts.bob, accounts.carol];
            if (who === "bob") return [accounts.alice, accounts.carol];
            return [accounts.alice, accounts.bob];
        };

        try {
            await resetThreePartyChatBeforeGroup(pages, chain.baseUrl);

            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.bobPage, chain.baseUrl, groupPeersFor("bob"));
            await establishThreePartyGroupMeshCarolLast(
                pages,
                accounts,
                () =>
                    openExistingGroupChat(
                        party.carolPage,
                        chain.baseUrl,
                        groupPeersFor("carol"),
                    ),
            );

            await sendChatMessage(alicePage, "baseline-mesh-ok");
            await expectThreadMessage(party.bobPage, "baseline-mesh-ok", {
                timeout: 180_000,
            });

            await alicePage.context().close();

            const awayMsg = "while-alice-was-away";
            await waitForGroupMeshReady(party.bobPage, [accounts.carol], {
                timeout: GROUP_MESH_TIMEOUT_MS,
            });
            await sendChatMessage(party.bobPage, awayMsg);
            await expectThreadMessage(party.carolPage, awayMsg, {
                timeout: 180_000,
            });

            const aliceCtx2 = await browser!.newContext();
            const alicePage2 = await aliceCtx2.newPage();
            attachDiagnostics(alicePage2, "alice2");
            try {
                const { loginExistingAccountViaUi } = await import("../lib/auth-ui");
                const { ensureContact } = await import("../lib/chat-ui");
                await loginExistingAccountViaUi(
                    alicePage2,
                    party.aliceAccount,
                    chain.baseUrl,
                );
                await ensureContact(
                    alicePage2,
                    chain.baseUrl,
                    party.bobAccount.name,
                );
                await ensureContact(
                    alicePage2,
                    chain.baseUrl,
                    party.carolAccount.name,
                );
                await openChat(alicePage2, chain.baseUrl);
                await waitForChatConnected(alicePage2, { timeout: 120_000 });
                await openExistingGroupChat(alicePage2, chain.baseUrl, groupPeersFor("alice"));

                await expectThreadMessage(alicePage2, awayMsg, {
                    timeout: 240_000,
                });
                await expectThreadMessage(alicePage2, "baseline-mesh-ok", {
                    timeout: 240_000,
                });
            } finally {
                await aliceCtx2.close();
            }
        } finally {
            await party.cleanup();
        }
    });

    test("alice receives message after navigating to contacts and back", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "navcat");

        const pages = {
            alice: alicePage,
            bob: party.bobPage,
            carol: party.carolPage,
        };
        const accounts = {
            alice: party.aliceAccount.name,
            bob: party.bobAccount.name,
            carol: party.carolAccount.name,
        };
        const groupPeersFor = (who: "alice" | "bob" | "carol") => {
            if (who === "alice") return [accounts.bob, accounts.carol];
            if (who === "bob") return [accounts.alice, accounts.carol];
            return [accounts.alice, accounts.bob];
        };

        try {
            await resetThreePartyChatBeforeGroup(pages, chain.baseUrl);

            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.bobPage, chain.baseUrl, groupPeersFor("bob"));
            await establishThreePartyGroupMeshCarolLast(
                pages,
                accounts,
                () =>
                    openExistingGroupChat(
                        party.carolPage,
                        chain.baseUrl,
                        groupPeersFor("carol"),
                    ),
            );

            await sendChatMessage(alicePage, "baseline-before-contacts");
            await expectThreadMessage(party.bobPage, "baseline-before-contacts", {
                timeout: 180_000,
            });

            const contactsUrl = chain.baseUrl.endsWith("/")
                ? `${chain.baseUrl}contacts`
                : `${chain.baseUrl}/contacts`;
            await alicePage.goto(contactsUrl);

            const awayMsg = "while-alice-on-contacts";
            await waitForGroupMeshReady(party.bobPage, [accounts.carol], {
                timeout: GROUP_MESH_TIMEOUT_MS,
            });
            await sendChatMessage(party.bobPage, awayMsg);
            await expectThreadMessage(party.carolPage, awayMsg, {
                timeout: 180_000,
            });

            await openChat(alicePage, chain.baseUrl);
            await waitForChatConnected(alicePage, { timeout: 120_000 });
            await openExistingGroupChat(alicePage, chain.baseUrl, groupPeersFor("alice"));

            await expectThreadMessage(alicePage, awayMsg, {
                timeout: 240_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
