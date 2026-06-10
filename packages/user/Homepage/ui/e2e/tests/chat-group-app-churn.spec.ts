import { test } from "../fixtures/chain";
import type { Page } from "@playwright/test";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    leaveChatToHome,
    openChat,
    openExistingGroupChat,
    sendChatMessage,
    waitForChatConnected,
    waitForGroupMeshReady,
} from "../lib/chat-ui";

const MESH_TIMEOUT_MS = 300_000;

/** Staggered mesh setup: alice (initiator) one leg at a time, then bob/carol. */
async function establishThreePartyGroupMesh(
    pages: {
        alice: Page;
        bob: Page;
        carol: Page;
    },
    accounts: {
        alice: string;
        bob: string;
        carol: string;
    },
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? MESH_TIMEOUT_MS;
    await waitForGroupMeshReady(pages.alice, [accounts.bob], { timeout });
    await waitForGroupMeshReady(pages.alice, [accounts.carol], { timeout });
    await waitForGroupMeshReady(
        pages.bob,
        [accounts.alice, accounts.carol],
        { timeout },
    );
    await waitForGroupMeshReady(
        pages.carol,
        [accounts.alice, accounts.bob],
        { timeout },
    );
}

/**
 * After chat ↔ home churn: reconnect WS, bring alice+bob up first (one initiator
 * leg), then carol — opening all three group threads at once races dual
 * negotiation against peers still recovering from alice's navigation.
 */
async function reenterGroupAfterChurn(
    baseUrl: string,
    pages: {
        alice: Page;
        bob: Page;
        carol: Page;
    },
    accounts: {
        alice: string;
        bob: string;
        carol: string;
    },
    groupPeersFor: (who: "alice" | "bob" | "carol") => string[],
): Promise<void> {
    const timeout = MESH_TIMEOUT_MS;

    await openChat(pages.alice, baseUrl);
    await openChat(pages.bob, baseUrl);
    await waitForChatConnected(pages.alice, { timeout: 120_000 });
    await waitForChatConnected(pages.bob, { timeout: 120_000 });

    await openExistingGroupChat(pages.alice, baseUrl, groupPeersFor("alice"));
    await openExistingGroupChat(pages.bob, baseUrl, groupPeersFor("bob"));
    await waitForGroupMeshReady(pages.alice, [accounts.bob], { timeout });
    await waitForGroupMeshReady(pages.bob, [accounts.alice], { timeout });

    await openChat(pages.carol, baseUrl);
    await waitForChatConnected(pages.carol, { timeout: 120_000 });
    await openExistingGroupChat(pages.carol, baseUrl, groupPeersFor("carol"));
    await waitForGroupMeshReady(pages.alice, [accounts.carol], { timeout });
    await waitForGroupMeshReady(pages.bob, [accounts.carol], { timeout });
    await waitForGroupMeshReady(
        pages.carol,
        [accounts.alice, accounts.bob],
        { timeout },
    );
}

test.describe("Chat group app exit/re-entry churn", () => {
    test("three-party group survives repeated chat ↔ home navigation and offline rejoin", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(900_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, "gchurn");

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
            if (who === "alice") {
                return [accounts.bob, accounts.carol];
            }
            if (who === "bob") {
                return [accounts.alice, accounts.carol];
            }
            return [accounts.alice, accounts.bob];
        };

        try {
            await openChat(alicePage, chain.baseUrl);
            await openChat(party.bobPage, chain.baseUrl);
            await openChat(party.carolPage, chain.baseUrl);
            await waitForChatConnected(alicePage, { timeout: 120_000 });
            await waitForChatConnected(party.bobPage, { timeout: 120_000 });
            await waitForChatConnected(party.carolPage, { timeout: 120_000 });

            // Reset socket/mesh state before group (H18 — same as history-sync / three-party flow).
            await leaveChatToHome(alicePage, chain.baseUrl);
            await leaveChatToHome(party.bobPage, chain.baseUrl);
            await leaveChatToHome(party.carolPage, chain.baseUrl);

            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(party.bobPage, chain.baseUrl, groupPeersFor("bob"));
            await openExistingGroupChat(party.carolPage, chain.baseUrl, groupPeersFor("carol"));

            await establishThreePartyGroupMesh(pages, accounts);

            await sendChatMessage(alicePage, "churn-baseline");
            await expectThreadMessage(party.bobPage, "churn-baseline", {
                timeout: 180_000,
            });

            // Repeated app exit/re-entry on all three clients.
            for (let round = 1; round <= 3; round++) {
                await leaveChatToHome(party.carolPage, chain.baseUrl);
                await leaveChatToHome(party.bobPage, chain.baseUrl);
                await leaveChatToHome(alicePage, chain.baseUrl);

                await reenterGroupAfterChurn(
                    chain.baseUrl,
                    pages,
                    accounts,
                    groupPeersFor,
                );

                const msg = `churn-after-nav-${round}`;
                await sendChatMessage(alicePage, msg);
                await expectThreadMessage(party.bobPage, msg, {
                    timeout: 180_000,
                });
                await expectThreadMessage(party.carolPage, msg, {
                    timeout: 180_000,
                });
            }

            // Bob goes fully offline, alice sends, bob returns on fresh context.
            await party.bobPage.context().close();
            const awayMsg = "churn-while-bob-away";
            await sendChatMessage(alicePage, awayMsg);
            await expectThreadMessage(party.carolPage, awayMsg, {
                timeout: 180_000,
            });

            const bobCtx2 = await browser!.newContext();
            const bobPage2 = await bobCtx2.newPage();
            attachDiagnostics(bobPage2, "bob2");
            try {
                const { loginExistingAccountViaUi } = await import("../lib/auth-ui");
                const { ensureContact } = await import("../lib/chat-ui");
                await loginExistingAccountViaUi(
                    bobPage2,
                    party.bobAccount,
                    chain.baseUrl,
                );
                await ensureContact(
                    bobPage2,
                    chain.baseUrl,
                    party.aliceAccount.name,
                );
                await ensureContact(
                    bobPage2,
                    chain.baseUrl,
                    party.carolAccount.name,
                );
                await openExistingGroupChat(bobPage2, chain.baseUrl, groupPeersFor("bob"));
                await waitForGroupMeshReady(bobPage2, [accounts.alice], {
                    timeout: MESH_TIMEOUT_MS,
                });
                await waitForGroupMeshReady(bobPage2, [accounts.carol], {
                    timeout: MESH_TIMEOUT_MS,
                });
                await expectThreadMessage(bobPage2, awayMsg, {
                    timeout: 180_000,
                });
                await expectThreadMessage(bobPage2, "churn-after-nav-3", {
                    timeout: 180_000,
                });
            } finally {
                await bobCtx2.close();
            }

            await expectOutboundMessageDelivered(alicePage, awayMsg, {
                timeout: 180_000,
            });
        } finally {
            await party.cleanup();
        }
    });
});
