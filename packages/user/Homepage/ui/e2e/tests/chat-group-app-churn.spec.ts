import { test } from "../fixtures/chain";

import { attachDiagnostics } from "../lib/diagnostics";
import { setupThreePartyAccounts } from "../lib/setup-three-party";
import {
    createGroupChat,
    establishThreePartyGroupMesh,
    expectOutboundMessageDelivered,
    expectThreadMessage,
    GROUP_MESH_TIMEOUT_MS,
    leaveThreePartyChatForChurn,
    openExistingGroupChat,
    readLastOpenGroupSpaceId,
    reenterThreePartyGroupAfterChurn,
    resetThreePartyChatBeforeGroup,
    sendChatMessage,
    waitForGroupMeshReady,
} from "../lib/chat-ui";

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
            await resetThreePartyChatBeforeGroup(pages, chain.baseUrl);

            await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            const groupSpaceId =
                (await readLastOpenGroupSpaceId(alicePage)) ?? undefined;
            await openExistingGroupChat(party.bobPage, chain.baseUrl, groupPeersFor("bob"));
            await openExistingGroupChat(
                party.carolPage,
                chain.baseUrl,
                groupPeersFor("carol"),
            );
            await establishThreePartyGroupMesh(pages, accounts);

            await sendChatMessage(alicePage, "churn-baseline");
            await expectThreadMessage(party.bobPage, "churn-baseline", {
                timeout: 180_000,
            });

            for (let round = 1; round <= 3; round++) {
                await leaveThreePartyChatForChurn(pages, chain.baseUrl);
                await reenterThreePartyGroupAfterChurn(
                    chain.baseUrl,
                    pages,
                    accounts,
                    groupPeersFor,
                    { groupSpaceId },
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
                await openExistingGroupChat(
                    bobPage2,
                    chain.baseUrl,
                    groupPeersFor("bob"),
                );
                await waitForGroupMeshReady(bobPage2, [accounts.alice], {
                    timeout: GROUP_MESH_TIMEOUT_MS,
                });
                await waitForGroupMeshReady(bobPage2, [accounts.carol], {
                    timeout: GROUP_MESH_TIMEOUT_MS,
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
