import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    expectThreadMessage,
    openChat,
    openExistingGroupChat,
    sendChatMessage,
    waitForPeerOnline,
} from "../lib/chat-ui";

test.describe("Chat group offline member catch-up", () => {
    test("alice receives message sent while her browser was closed", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: "occalicegc",
            bob: "occbobbbgc",
            carol: "occcarolgc",
        });

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

            await waitForPeerOnline(alicePage, party.bobAccount.name, {
                timeout: 120_000,
            });
            await waitForPeerOnline(alicePage, party.carolAccount.name, {
                timeout: 120_000,
            });
            await sendChatMessage(alicePage, "baseline-mesh-ok");
            await expectThreadMessage(party.bobPage, "baseline-mesh-ok", {
                timeout: 180_000,
            });

            // Alice closes her browser (cold disconnect).
            await alicePage.context().close();

            const awayMsg = "while-alice-was-away";
            await waitForPeerOnline(party.bobPage, party.carolAccount.name, {
                timeout: 120_000,
            });
            await sendChatMessage(party.bobPage, awayMsg);
            await expectThreadMessage(party.carolPage, awayMsg, {
                timeout: 180_000,
            });

            // Alice returns on a fresh context.
            const aliceCtx2 = await browser!.newContext();
            const alicePage2 = await aliceCtx2.newPage();
            attachDiagnostics(alicePage2, "alice2");
            try {
                const { loginExistingAccountViaUi } = await import(
                    "../lib/auth-ui"
                );
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
                await openExistingGroupChat(alicePage2, chain.baseUrl, [
                    party.bobAccount.name,
                    party.carolAccount.name,
                ]);

                await expectThreadMessage(alicePage2, awayMsg, {
                    timeout: 180_000,
                });
                await expectThreadMessage(alicePage2, "baseline-mesh-ok", {
                    timeout: 180_000,
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
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: "navalicegc",
            bob: "navbobbbgc",
            carol: "navcarolgc",
        });

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

            await waitForPeerOnline(alicePage, party.bobAccount.name, {
                timeout: 120_000,
            });
            await waitForPeerOnline(alicePage, party.carolAccount.name, {
                timeout: 120_000,
            });
            await sendChatMessage(alicePage, "baseline-before-contacts");
            await expectThreadMessage(party.bobPage, "baseline-before-contacts", {
                timeout: 180_000,
            });

            const contactsUrl = chain.baseUrl.endsWith("/")
                ? `${chain.baseUrl}contacts`
                : `${chain.baseUrl}/contacts`;
            await alicePage.goto(contactsUrl);

            const awayMsg = "while-alice-on-contacts";
            await waitForPeerOnline(party.bobPage, party.carolAccount.name, {
                timeout: 120_000,
            });
            await sendChatMessage(party.bobPage, awayMsg);
            await expectThreadMessage(party.carolPage, awayMsg, {
                timeout: 180_000,
            });

            await openChat(alicePage, chain.baseUrl);
            await openExistingGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);

            await expectThreadMessage(alicePage, awayMsg, {
                timeout: 180_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
