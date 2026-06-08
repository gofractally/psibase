/**
 * Minimal repro for churn DM sidebar click / URL-sync failures.
 *
 * Run:
 *   yarn e2e:dm-click-debug
 *   PSIBASE_E2E_DM_CLICK_SCENARIO=group-deep-link yarn e2e:dm-click-debug
 *   PSIBASE_E2E_DM_CLICK_SCENARIO=accumulated-churn-openDmThread yarn e2e:dm-click-debug
 *
 * Scenarios: group URL / parked wake / homeNav wake, openDmThread variants,
 * accumulated-churn (4× park/dm cycles), post-pending (offline send + park).
 */
import { test } from "../fixtures/chain";

import {
    createAccountViaInviteUrl,
    createInviteUrl,
    loginProducerViaUi,
    PRODUCER_ACCOUNT,
    uniqueE2eAccountName,
} from "../lib/auth-ui";
import {
    churnHomeNav,
    createGroupChat,
    ensureContact,
    focusChurnGroupThread,
    openDmThread,
    readChatSelectionState,
    sendChatMessage,
    sendChurnGroupMessage,
    startDmWithContact,
    wakeForDmInteraction,
} from "../lib/chat-ui";
import {
    logSelection,
    logSidebarInventory,
    parseDmClickScenarios,
    runDmClickScenario,
    runOpenDmThreadScenario,
    shouldRunScenario,
    snapshotSelection,
    type DmClickScenarioId,
} from "../lib/dm-sidebar-click-debug";
import { attachDiagnostics } from "../lib/diagnostics";

const SCENARIO_FILTER = parseDmClickScenarios();

test.describe("DM sidebar click debug", () => {
    test("reproduces group-url / parked / homeNav DM selection failures", async ({
        chain,
        alicePage,
        browser,
    }) => {
        test.setTimeout(600_000);
        attachDiagnostics(alicePage, "alice", {
            consoleFilter:
                /dm-compose|thread:|churn-trace|url-space|selection|composer-ready|compose-wake/i,
        });
        await alicePage.addInitScript(() => {
            localStorage.setItem("chat-churn-disable-health-reconnect", "1");
        });

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        const aliceInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const bobInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);
        const carolInvite = await createInviteUrl(alicePage, PRODUCER_ACCOUNT);

        const aliceAccount = await createAccountViaInviteUrl(
            alicePage,
            aliceInvite,
            uniqueE2eAccountName("dmclk"),
        );

        const bobContext = await browser!.newContext();
        const carolContext = await browser!.newContext();
        const bobPage = await bobContext.newPage();
        const carolPage = await carolContext.newPage();
        attachDiagnostics(bobPage, "bob");
        attachDiagnostics(carolPage, "carol");

        try {
            const bobAccount = await createAccountViaInviteUrl(
                bobPage,
                bobInvite,
                uniqueE2eAccountName("dmclk"),
            );
            const carolAccount = await createAccountViaInviteUrl(
                carolPage,
                carolInvite,
                uniqueE2eAccountName("dmclk"),
            );

            for (const page of [alicePage, bobPage, carolPage]) {
                await ensureContact(page, chain.baseUrl, aliceAccount.name);
                await ensureContact(page, chain.baseUrl, bobAccount.name);
                await ensureContact(page, chain.baseUrl, carolAccount.name);
            }

            const groupPeers = [bobAccount.name, carolAccount.name];
            await createGroupChat(alicePage, chain.baseUrl, groupPeers);
            const groupSpaceId =
                (await readChatSelectionState(alicePage))
                    .selectedConversationId ?? "";
            if (!groupSpaceId.startsWith("space:")) {
                throw new Error(
                    `[dm-click-debug] bootstrap: missing group space id (${groupSpaceId})`,
                );
            }
            console.log(
                `[dm-click-debug] bootstrap groupSpaceId=${groupSpaceId}`,
            );

            await startDmWithContact(
                alicePage,
                chain.baseUrl,
                bobAccount.name,
            );
            await sendChatMessage(alicePage, "dm-click-debug-bootstrap", {
                composerTimeout: 45_000,
            });
            logSelection(
                "bootstrap:after-dm",
                await snapshotSelection(alicePage),
            );
            await logSidebarInventory(
                alicePage,
                bobAccount.name,
                "bootstrap:after-dm",
            );

            async function setupAccumulatedChurnPark(): Promise<void> {
                for (let i = 0; i < 4; i++) {
                    await focusChurnGroupThread(
                        alicePage,
                        chain.baseUrl,
                        groupPeers,
                        { groupSpaceId, composerTimeout: 45_000 },
                    );
                    await sendChurnGroupMessage(
                        alicePage,
                        chain.baseUrl,
                        groupPeers,
                        `accum-group-${i}`,
                        { composerTimeout: 45_000, groupSpaceId },
                    );
                    await focusChurnGroupThread(
                        alicePage,
                        chain.baseUrl,
                        groupPeers,
                        {
                            groupSpaceId,
                            churnNoRealtime: true,
                            composerTimeout: 45_000,
                        },
                    );
                    await wakeForDmInteraction(alicePage, chain.baseUrl);
                    await openDmThread(
                        alicePage,
                        chain.baseUrl,
                        bobAccount.name,
                        { groupSpaceId, gotoTimeout: 45_000 },
                    );
                    await sendChatMessage(alicePage, `accum-dm-${i}`, {
                        composerTimeout: 45_000,
                    });
                }
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    {
                        groupSpaceId,
                        churnNoRealtime: true,
                        composerTimeout: 45_000,
                    },
                );
                await wakeForDmInteraction(alicePage, chain.baseUrl);
            }

            async function setupPostPendingPark(): Promise<void> {
                await bobContext.close();
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    { groupSpaceId, composerTimeout: 45_000 },
                );
                await wakeForDmInteraction(alicePage, chain.baseUrl);
                await openDmThread(
                    alicePage,
                    chain.baseUrl,
                    bobAccount.name,
                    { groupSpaceId, gotoTimeout: 45_000 },
                );
                await sendChatMessage(alicePage, "post-pending-offline-dm", {
                    composerTimeout: 45_000,
                });
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    {
                        groupSpaceId,
                        churnNoRealtime: true,
                        composerTimeout: 45_000,
                    },
                );
                await wakeForDmInteraction(alicePage, chain.baseUrl);
            }

            type ScenarioRun = {
                id: DmClickScenarioId;
                setup: () => Promise<void>;
                run: () => Promise<void>;
            };

            async function setupGroupDeepLink(): Promise<void> {
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    { groupSpaceId, composerTimeout: 45_000 },
                );
            }

            async function setupParkedWake(): Promise<void> {
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    {
                        groupSpaceId,
                        churnNoRealtime: true,
                        composerTimeout: 45_000,
                    },
                );
                await wakeForDmInteraction(alicePage, chain.baseUrl);
            }

            async function setupHomeNavWake(): Promise<void> {
                await focusChurnGroupThread(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    {
                        groupSpaceId,
                        churnNoRealtime: true,
                        composerTimeout: 45_000,
                    },
                );
                await churnHomeNav(
                    alicePage,
                    chain.baseUrl,
                    groupPeers,
                    { groupSpaceId },
                );
                await wakeForDmInteraction(alicePage, chain.baseUrl);
            }

            const scenarioRuns: ScenarioRun[] = [
                {
                    id: "group-deep-link",
                    setup: setupGroupDeepLink,
                    run: () =>
                        runDmClickScenario(
                            alicePage,
                            "group-deep-link",
                            bobAccount.name,
                            groupSpaceId,
                        ),
                },
                {
                    id: "parked-no-realtime",
                    setup: setupParkedWake,
                    run: () =>
                        runDmClickScenario(
                            alicePage,
                            "parked-no-realtime",
                            bobAccount.name,
                            groupSpaceId,
                        ),
                },
                {
                    id: "home-nav",
                    setup: setupHomeNavWake,
                    run: () =>
                        runDmClickScenario(
                            alicePage,
                            "home-nav",
                            bobAccount.name,
                            groupSpaceId,
                        ),
                },
                {
                    id: "openDmThread-group-deep-link",
                    setup: setupGroupDeepLink,
                    run: () =>
                        runOpenDmThreadScenario(
                            alicePage,
                            "openDmThread-group-deep-link",
                            bobAccount.name,
                            groupSpaceId,
                            openDmThread,
                            chain.baseUrl,
                        ),
                },
                {
                    id: "openDmThread-parked-no-realtime",
                    setup: setupParkedWake,
                    run: () =>
                        runOpenDmThreadScenario(
                            alicePage,
                            "openDmThread-parked-no-realtime",
                            bobAccount.name,
                            groupSpaceId,
                            openDmThread,
                            chain.baseUrl,
                        ),
                },
                {
                    id: "openDmThread-home-nav",
                    setup: setupHomeNavWake,
                    run: () =>
                        runOpenDmThreadScenario(
                            alicePage,
                            "openDmThread-home-nav",
                            bobAccount.name,
                            groupSpaceId,
                            openDmThread,
                            chain.baseUrl,
                        ),
                },
                {
                    id: "accumulated-churn-openDmThread",
                    setup: setupAccumulatedChurnPark,
                    run: () =>
                        runOpenDmThreadScenario(
                            alicePage,
                            "accumulated-churn-openDmThread",
                            bobAccount.name,
                            groupSpaceId,
                            openDmThread,
                            chain.baseUrl,
                            { assertMs: 90_000, gotoTimeout: 90_000 },
                        ),
                },
                {
                    id: "post-pending-openDmThread",
                    setup: setupPostPendingPark,
                    run: () =>
                        runOpenDmThreadScenario(
                            alicePage,
                            "post-pending-openDmThread",
                            bobAccount.name,
                            groupSpaceId,
                            openDmThread,
                            chain.baseUrl,
                            { assertMs: 90_000, gotoTimeout: 90_000 },
                        ),
                },
            ];

            const failures: string[] = [];

            for (const { id, setup, run } of scenarioRuns) {
                if (!shouldRunScenario(id, SCENARIO_FILTER)) {
                    console.log(
                        `[dm-click-debug] skipping scenario ${id} (filter)`,
                    );
                    continue;
                }

                try {
                    await setup();
                    await run();
                } catch (err) {
                    failures.push(`${id}: ${String(err)}`);
                }
            }

            if (failures.length > 0) {
                throw new Error(
                    `[dm-click-debug] failed scenarios:\n${failures.join("\n")}`,
                );
            }
        } finally {
            await bobContext.close().catch(() => {});
            await carolContext.close().catch(() => {});
        }
    });
});
