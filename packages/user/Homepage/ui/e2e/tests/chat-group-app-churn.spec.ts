import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    leaveChatToHome,
    openExistingGroupChat,
    sendChatMessage,
    waitForGroupMeshReady,
    waitForPeerOnline,
} from "../lib/chat-ui";

test.describe("Chat group app exit/re-entry churn", () => {
    test("three-party group survives repeated chat ↔ home navigation and offline rejoin", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice");

        const party = await setupThreePartyAccounts(chain, alicePage, browser!, {
            alice: "churnalice",
            bob: "churnbobbb",
            carol: "churncarol",
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

            const meshPeers = {
                alice: [party.bobAccount.name, party.carolAccount.name],
                bob: [party.aliceAccount.name, party.carolAccount.name],
                carol: [party.aliceAccount.name, party.bobAccount.name],
            } as const;

            for (const [page, who] of [
                [alicePage, "alice"],
                [party.bobPage, "bob"],
                [party.carolPage, "carol"],
            ] as const) {
                for (const peer of meshPeers[who]) {
                    await waitForPeerOnline(page, peer, { timeout: 120_000 });
                }
                await waitForGroupMeshReady(page, meshPeers[who], {
                    timeout: 180_000,
                });
            }

            await sendChatMessage(alicePage, "churn-baseline");
            await expectThreadMessage(party.bobPage, "churn-baseline", {
                timeout: 180_000,
            });

            const groupPeersFor = (self: "alice" | "bob" | "carol") => {
                if (self === "alice") {
                    return [party.bobAccount.name, party.carolAccount.name];
                }
                if (self === "bob") {
                    return [party.aliceAccount.name, party.carolAccount.name];
                }
                return [party.aliceAccount.name, party.bobAccount.name];
            };

            // Repeated app exit/re-entry on all three clients.
            for (let round = 1; round <= 3; round++) {
                for (const [page, who] of [
                    [alicePage, "alice"],
                    [party.bobPage, "bob"],
                    [party.carolPage, "carol"],
                ] as const) {
                    await leaveChatToHome(page, chain.baseUrl);
                    await openExistingGroupChat(
                        page,
                        chain.baseUrl,
                        groupPeersFor(who),
                    );
                }

                for (const [page, who] of [
                    [alicePage, "alice"],
                    [party.bobPage, "bob"],
                    [party.carolPage, "carol"],
                ] as const) {
                    await waitForGroupMeshReady(page, meshPeers[who], {
                        timeout: 180_000,
                    });
                }

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
                await openExistingGroupChat(bobPage2, chain.baseUrl, [
                    party.aliceAccount.name,
                    party.carolAccount.name,
                ]);
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
