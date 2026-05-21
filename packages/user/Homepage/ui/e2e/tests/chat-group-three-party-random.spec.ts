import { test } from "../fixtures/chain";
import type { BrowserContext, Page } from "@playwright/test";

import { loginExistingAccountViaUi } from "../lib/auth-ui";
import { resetPageForFreshChain } from "../lib/chain-page-reset";
import {
    createPendingLedger,
    type PendingLedger,
} from "../lib/churn-pending-ledger";
import {
    flushPendingCatchUp,
    FLUSH_ENTRY_BUDGET_MS,
    dumpTransportDeliverySnapshot,
} from "../lib/churn-pending-flush";
import {
    dumpChurnDiagTraces,
    getChurnDiagConfig,
    humanDiagPause,
    isHumanDiagStep,
    stepBudgetMsForDiag,
} from "../lib/churn-diag";
import {
    parseChurnMeshTimeoutMs,
    parseChurnOfflineStepTimeoutMs,
    parseChurnStepTimeoutMs,
    withChurnStepTimeout,
} from "../lib/churn-step-timeout";
import {
    churnPacingAfterStep,
    churnPacingBeforeStep,
    estimateIterationPacingMs,
    getChurnTimingConfig,
} from "../lib/churn-timing";
import {
    assertOutboundDmRouting,
    assertPendingDeliveredForPair,
    createGroupChat,
    ensureContact,
    expectPendingOutboundMessage,
    expectThreadMessage,
    churnHomeNav,
    churnReselectGroup,
    focusChurnGroupThread,
    openDmThread,
    openExistingGroupChat,
    openExistingGroupChatMinimal,
    readChatSelectionState,
    sendChatMessage,
    sendChurnGroupMessage,
    waitForDmThreadWithPeer,
    wakeActorFromChurnNoRealtime,
    wakeForDmInteraction,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    actorAccount,
    buildChurnPlan,
    CHURN_PLAN_STEP_COUNT,
    groupPeersFor,
    parseChurnLegacyPlan,
    parseRandomChurnRuns,
    shouldParkActorNoRealtime,
    parseRandomChurnSeed,
    type ChurnStep,
    type PartyActor,
} from "../lib/random-three-party-churn";
import {
    forceReleaseE2eChainPort,
    restartE2eChain,
    type E2eChainInfo,
} from "../lib/chain-boot";
import { setupThreePartyAccounts, uniqueThreePartyNames } from "../lib/setup-three-party";

const RUNS = parseRandomChurnRuns();
const BASE_SEED = parseRandomChurnSeed();
const LEGACY_PLAN = parseChurnLegacyPlan();
const STEP_MS = parseChurnStepTimeoutMs();
const OFFLINE_STEP_MS = parseChurnOfflineStepTimeoutMs();
const MESH_MS = parseChurnMeshTimeoutMs();
const COMPOSER_MS = 45_000;

const ACTORS: readonly PartyActor[] = ["alice", "bob", "carol"];

type ChurnPages = {
    alice: Page;
    bob: Page | null;
    carol: Page | null;
};

function pageFor(who: PartyActor, pages: ChurnPages): Page {
    const page = pages[who];
    if (!page) {
        throw new Error(`[random-churn] ${who} has no browser context`);
    }
    return page;
}

async function closeContextQuietly(ctx: BrowserContext): Promise<void> {
    await ctx.close().catch(() => {});
}

async function installChurnHealthPolicy(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.setItem("chat-churn-disable-health-reconnect", "1");
    });
    await page
        .evaluate(() => {
            localStorage.setItem("chat-churn-disable-health-reconnect", "1");
        })
        .catch(() => {});
}

async function parkActorNoRealtime(
    page: Page,
    baseUrl: string,
    peers: string[],
    groupSpaceId: string,
): Promise<void> {
    await focusChurnGroupThread(page, baseUrl, peers, {
        groupSpaceId,
        composerTimeout: 20_000,
        gotoTimeout: 20_000,
        churnNoRealtime: true,
    }).catch((err) => {
        console.log(`[random-churn] park no-realtime skipped (${String(err)})`);
    });
}

async function parkActorsOffline(
    pages: ChurnPages,
    online: Set<PartyActor>,
): Promise<void> {
    for (const who of ["bob", "carol"] as const) {
        const page = pages[who];
        if (!page) continue;
        console.log(`[random-churn] parking ${who} offline (close context)`);
        await closeContextQuietly(page.context());
        pages[who] = null;
        online.delete(who);
    }
}

function recordGroupSendPending(
    ledger: PendingLedger,
    from: PartyActor,
    body: string,
    online: Set<PartyActor>,
): void {
    for (const who of ACTORS) {
        if (who === from || online.has(who)) continue;
        ledger.record({ body, from, to: who, channel: "group" });
    }
}

async function assertGroupLiveDelivery(
    pages: ChurnPages,
    online: Set<PartyActor>,
    from: PartyActor,
    body: string,
): Promise<void> {
    for (const who of ACTORS) {
        if (who === from || !online.has(who)) continue;
        await expectThreadMessage(pageFor(who, pages), body, {
            timeout: MESH_MS,
        });
    }
}

async function dumpChatDataSnapshot(
    pages: ChurnPages,
    online: Set<PartyActor>,
    label: string,
): Promise<void> {
    const snapMs = 5_000;
    for (const who of ACTORS) {
        if (!online.has(who) || !pages[who]) continue;
        try {
            const snap = await Promise.race([
                pageFor(who, pages).evaluate(() => {
                    const dbg = (
                        window as unknown as {
                            __chatDataDebug?: { snapshot?: () => unknown };
                        }
                    ).__chatDataDebug;
                    return dbg?.snapshot?.() ?? null;
                }),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error("snapshot timeout")),
                        snapMs,
                    ),
                ),
            ]);
            console.log(
                `[random-churn] snapshot ${label} ${who}=${JSON.stringify(snap)}`,
            );
        } catch (err) {
            console.log(
                `[random-churn] snapshot ${label} ${who}=skipped (${String(err)})`,
            );
        }
    }
}

/**
 * Opt-in stress suite: set `PSIBASE_E2E_RANDOM_CHURN_RUNS=2` (optional seed
 * via `PSIBASE_E2E_RANDOM_CHURN_SEED`). Skipped in the default `yarn e2e` run.
 */
test.use({
    actionTimeout: COMPOSER_MS,
    trace: "off",
    video: "off",
});

test.describe("Chat group three-party random churn @manual", () => {
    test.skip(
        RUNS === 0,
        "Set PSIBASE_E2E_RANDOM_CHURN_RUNS=2 for manual PR validation",
    );

    test(`random churn (${RUNS}×${CHURN_PLAN_STEP_COUNT} steps, seed ${BASE_SEED}${LEGACY_PLAN ? ", legacy" : ", offline-phased"})`, async ({
        alicePage,
        browser,
    }) => {
        const timing = getChurnTimingConfig();
        const diag = getChurnDiagConfig();
        console.log(
            `[random-churn] speed=${timing.mode} meshSettleMs=${timing.meshSettleMs} interStepMs=${timing.interStepMs} strict=${timing.strict} legacyPlan=${LEGACY_PLAN}`,
        );
        if (diag.enabled) {
            console.log(
                `[random-churn-diag] enabled humanRange=${diag.humanStepRange ? `${diag.humanStepRange.start}-${diag.humanStepRange.end}` : "off"} humanMs=${diag.humanMs} disableRecycle=${diag.disableRecycle} stopAt=${diag.stopAtStep ?? "none"}`,
            );
        }

        const wallSec = Number(
            process.env.PSIBASE_E2E_RANDOM_CHURN_TIMEOUT_SEC ??
                (timing.mode === "mesh" ? "1200" : "1800"),
        );
        const pacingPerIter = estimateIterationPacingMs(
            CHURN_PLAN_STEP_COUNT,
            timing,
        );
        const chainBootMs = 240_000;
        const computedMs =
            Math.max(1, RUNS) *
                (CHURN_PLAN_STEP_COUNT * STEP_MS +
                    pacingPerIter +
                    chainBootMs) +
            180_000;
        test.setTimeout(
            Math.min(
                Number.isFinite(wallSec) && wallSec > 0
                    ? wallSec * 1000
                    : timing.mode === "mesh"
                      ? 1_200_000
                      : 1_800_000,
                computedMs,
            ),
        );

        attachDiagnostics(alicePage, "alice");
        await installChurnHealthPolicy(alicePage);

        let chainInfo: E2eChainInfo | null = null;

        try {
            for (let iteration = 0; iteration < RUNS; iteration++) {
                console.log(`[random-churn] iter=${iteration} restart chain`);
                const restarted = await restartE2eChain();
                chainInfo = restarted;

                await resetPageForFreshChain(alicePage, chainInfo.baseUrl);

                const names = uniqueThreePartyNames(`rndchurn${iteration}`);
                const party = await setupThreePartyAccounts(
                    chainInfo,
                    alicePage,
                    browser!,
                    names,
                );

                let bobPage: Page | null = party.bobPage;
                let carolPage: Page | null = party.carolPage;
                await installChurnHealthPolicy(bobPage);
                await installChurnHealthPolicy(carolPage);
                const extraContexts: BrowserContext[] = [];

                const pages: ChurnPages = {
                    alice: alicePage,
                    bob: bobPage,
                    carol: carolPage,
                };
                const online = new Set<PartyActor>(["alice", "bob", "carol"]);
                const ledger = createPendingLedger();

                const groupSpaceId = await createGroupChat(
                    alicePage,
                    chainInfo.baseUrl,
                    [party.bobAccount.name, party.carolAccount.name],
                );
                await openExistingGroupChat(
                    bobPage,
                    chainInfo.baseUrl,
                    groupPeersFor("bob", names),
                );
                await openExistingGroupChat(
                    carolPage,
                    chainInfo.baseUrl,
                    groupPeersFor("carol", names),
                );

                const execute = async (
                    step: ChurnStep,
                    stepIndex: number,
                    plan: ChurnStep[],
                ): Promise<void> => {
                    const label = `iter=${iteration} step=${stepIndex} kind=${step.kind}`;
                    const pendingForFlush =
                        step.kind === "offlineRejoin"
                            ? ledger.forRecipient(step.who).length
                            : 0;
                    const defaultBudgetMs =
                        step.kind === "offlineRejoin"
                            ? OFFLINE_STEP_MS +
                              pendingForFlush * FLUSH_ENTRY_BUDGET_MS
                            : timing.mode === "mesh" &&
                                (step.kind === "homeNav" ||
                                    step.kind === "dmSend" ||
                                    step.kind === "groupSend" ||
                                    step.kind === "reselectGroup")
                              ? Math.max(STEP_MS, MESH_MS)
                              : STEP_MS;
                    const budgetMs = stepBudgetMsForDiag(
                        stepIndex,
                        defaultBudgetMs,
                        diag,
                    );
                    console.log(`[random-churn] ${label} budgetMs=${budgetMs}`);

                    if (isHumanDiagStep(stepIndex, diag)) {
                        await humanDiagPause(diag, `${label}:before-step`);
                    }

                    await withChurnStepTimeout(label, budgetMs, async () => {
                        if (step.kind === "groupSend") {
                            const page = pageFor(step.from, pages);
                            const peers = groupPeersFor(step.from, names);
                            const preSend = await readChatSelectionState(page);
                            console.log(
                                `[random-churn] ${label} pre-group-send selection=${JSON.stringify(preSend)}`,
                            );
                            await sendChurnGroupMessage(
                                page,
                                chainInfo!.baseUrl,
                                peers,
                                step.body,
                                {
                                    composerTimeout: COMPOSER_MS,
                                    groupSpaceId,
                                },
                            );
                            recordGroupSendPending(
                                ledger,
                                step.from,
                                step.body,
                                online,
                            );
                            await assertGroupLiveDelivery(
                                pages,
                                online,
                                step.from,
                                step.body,
                            );
                            if (shouldParkActorNoRealtime(stepIndex, plan)) {
                                await parkActorNoRealtime(
                                    page,
                                    chainInfo!.baseUrl,
                                    peers,
                                    groupSpaceId,
                                );
                            }
                            return;
                        }
                        if (step.kind === "dmSend") {
                            const page = pageFor(step.from, pages);
                            const peer = actorAccount(step.to, names);
                            await wakeForDmInteraction(
                                page,
                                chainInfo!.baseUrl,
                            );
                            await openDmThread(page, chainInfo!.baseUrl, peer, {
                                groupSpaceId,
                                gotoTimeout: COMPOSER_MS,
                            });
                            await sendChatMessage(page, step.body, {
                                composerTimeout: COMPOSER_MS,
                            });
                            if (!online.has(step.to)) {
                                await expectPendingOutboundMessage(
                                    page,
                                    step.body,
                                );
                                await assertOutboundDmRouting(
                                    page,
                                    step.body,
                                    groupSpaceId,
                                );
                                ledger.record({
                                    body: step.body,
                                    from: step.from,
                                    to: step.to,
                                    channel: "dm",
                                });
                            } else {
                                await assertPendingDeliveredForPair(
                                    page,
                                    pageFor(step.to, pages),
                                    actorAccount(step.from, names),
                                    peer,
                                    step.body,
                                    {
                                        kind: "dm",
                                        timeout: MESH_MS,
                                        baseUrl: chainInfo!.baseUrl,
                                        groupSpaceId,
                                        senderGroupPeers: groupPeersFor(
                                            step.from,
                                            names,
                                        ),
                                        recipientGroupPeers: groupPeersFor(
                                            step.to,
                                            names,
                                        ),
                                    },
                                );
                            }
                            if (shouldParkActorNoRealtime(stepIndex, plan)) {
                                await parkActorNoRealtime(
                                    page,
                                    chainInfo!.baseUrl,
                                    groupPeersFor(step.from, names),
                                    groupSpaceId,
                                );
                            }
                            return;
                        }
                        if (step.kind === "homeNav") {
                            const page = pageFor(step.who, pages);
                            await churnHomeNav(
                                page,
                                chainInfo!.baseUrl,
                                groupPeersFor(step.who, names),
                                {
                                    groupSpaceId,
                                    diag,
                                    diagStepIndex: stepIndex,
                                },
                            );
                            return;
                        }
                        if (step.kind === "reselectGroup") {
                            const page = pageFor(step.who, pages);
                            await churnReselectGroup(
                                page,
                                chainInfo!.baseUrl,
                                groupPeersFor(step.who, names),
                                { groupSpaceId },
                            );
                            if (shouldParkActorNoRealtime(stepIndex, plan)) {
                                await parkActorNoRealtime(
                                    page,
                                    chainInfo!.baseUrl,
                                    groupPeersFor(step.who, names),
                                    groupSpaceId,
                                );
                            }
                            return;
                        }

                        const who = step.who;
                        console.log(`[random-churn] ${label} phase=close-context`);
                        const oldPage = pages[who];
                        if (oldPage) {
                            await closeContextQuietly(oldPage.context());
                            pages[who] = null;
                        }

                        console.log(`[random-churn] ${label} phase=new-context`);
                        const ctx = await browser!.newContext();
                        extraContexts.push(ctx);
                        const page = await ctx.newPage();
                        await installChurnHealthPolicy(page);

                        if (who === "bob") {
                            bobPage = page;
                            pages.bob = page;
                            attachDiagnostics(page, `bob-r${iteration}`);
                            console.log(`[random-churn] ${label} phase=login`);
                            await loginExistingAccountViaUi(
                                page,
                                party.bobAccount,
                                chainInfo!.baseUrl,
                            );
                            console.log(`[random-churn] ${label} phase=contacts`);
                            await ensureContact(
                                page,
                                chainInfo!.baseUrl,
                                party.aliceAccount.name,
                            );
                            await ensureContact(
                                page,
                                chainInfo!.baseUrl,
                                party.carolAccount.name,
                            );
                        } else {
                            carolPage = page;
                            pages.carol = page;
                            attachDiagnostics(page, `carol-r${iteration}`);
                            console.log(`[random-churn] ${label} phase=login`);
                            await loginExistingAccountViaUi(
                                page,
                                party.carolAccount,
                                chainInfo!.baseUrl,
                            );
                            console.log(`[random-churn] ${label} phase=contacts`);
                            await ensureContact(
                                page,
                                chainInfo!.baseUrl,
                                party.aliceAccount.name,
                            );
                            await ensureContact(
                                page,
                                chainInfo!.baseUrl,
                                party.bobAccount.name,
                            );
                        }

                        online.add(who);
                        console.log(`[random-churn] ${label} phase=open-group`);
                        await openExistingGroupChatMinimal(
                            page,
                            chainInfo!.baseUrl,
                            groupPeersFor(who, names),
                        );
                        await flushPendingCatchUp(
                            who,
                            ledger,
                            pages,
                            online,
                            names,
                            chainInfo!.baseUrl,
                            groupSpaceId,
                            MESH_MS,
                            label,
                        );
                    });
                };

                const plan = buildChurnPlan(BASE_SEED, iteration);
                const baseline = `rand-${iteration}-baseline`;
                const stepFailures: string[] = [];

                await withChurnStepTimeout(
                    `iter=${iteration} baseline-send`,
                    STEP_MS,
                    async () => {
                        await openExistingGroupChatMinimal(
                            alicePage,
                            chainInfo.baseUrl,
                            groupPeersFor("alice", names),
                        );
                        await sendChatMessage(alicePage, baseline, {
                            composerTimeout: COMPOSER_MS,
                        });
                    },
                );
                await expectThreadMessage(bobPage, baseline, {
                    timeout: MESH_MS,
                });
                await expectThreadMessage(carolPage, baseline, {
                    timeout: MESH_MS,
                });
                await churnPacingAfterStep(
                    {
                        kind: "groupSend",
                        from: "alice",
                        body: baseline,
                    },
                    timing,
                );

                if (!LEGACY_PLAN) {
                    await parkActorsOffline(pages, online);
                }

                let prevStep: ChurnStep | undefined;
                for (let stepIndex = 0; stepIndex < plan.length; stepIndex++) {
                    const step = plan[stepIndex]!;
                    if (
                        diag.stopAtStep !== null &&
                        stepIndex > diag.stopAtStep
                    ) {
                        console.log(
                            `[random-churn-diag] stop after step ${diag.stopAtStep}`,
                        );
                        break;
                    }
                    try {
                        if (!isHumanDiagStep(stepIndex, diag)) {
                            await churnPacingBeforeStep(step, timing, prevStep);
                        }
                        await execute(step, stepIndex, plan);
                        if (!isHumanDiagStep(stepIndex, diag)) {
                            await churnPacingAfterStep(step, timing);
                        } else {
                            await humanDiagPause(
                                diag,
                                `iter=${iteration} step=${stepIndex}:after-step`,
                            );
                        }
                        prevStep = step;
                    } catch (err) {
                        const msg = `iter=${iteration} step=${stepIndex} kind=${step.kind}: ${err}`;
                        stepFailures.push(msg);
                        await dumpChatDataSnapshot(
                            pages,
                            online,
                            `fail iter=${iteration} step=${stepIndex}`,
                        );
                        await dumpTransportDeliverySnapshot(
                            pages,
                            online,
                            [
                                party.aliceAccount.name,
                                party.bobAccount.name,
                                party.carolAccount.name,
                            ],
                            `fail iter=${iteration} step=${stepIndex}`,
                        );
                        await dumpChurnDiagTraces(
                            pages,
                            ACTORS.filter((who) => online.has(who)),
                            `fail iter=${iteration} step=${stepIndex}`,
                        );
                        if (timing.strict) {
                            throw err;
                        }
                        console.log(`[random-churn] stress continue: ${msg}`);
                    }
                }

                if (stepFailures.length > 0) {
                    const summary = stepFailures.join("\n");
                    console.log(
                        `[random-churn] iter=${iteration} step failures (${stepFailures.length}):\n${summary}`,
                    );
                    if (timing.strict) {
                        throw new Error(stepFailures[0]);
                    }
                    test.info().annotations.push({
                        type: timing.mode,
                        description: `${stepFailures.length} step errors (stress run continues)`,
                    });
                }

                if (diag.stopAtStep === null) {
                    const finalBody = plan[plan.length - 1]!.body;
                    if (timing.mode === "mesh") {
                        await churnPacingAfterStep(
                            plan[plan.length - 1]!,
                            timing,
                        );
                    }

                    for (const who of ACTORS) {
                        const page = pages[who];
                        if (!page) {
                            throw new Error(
                                `[random-churn] iter=${iteration} final assert: ${who} offline`,
                            );
                        }
                        await focusChurnGroupThread(
                            page,
                            chainInfo.baseUrl,
                            groupPeersFor(who, names),
                            {
                                groupSpaceId,
                                composerTimeout: 45_000,
                                sidebarTimeout: 30_000,
                                gotoTimeout: 25_000,
                            },
                        );
                        await expectThreadMessage(page, finalBody, {
                            timeout: MESH_MS,
                        });
                    }
                }

                for (const ctx of extraContexts) {
                    await closeContextQuietly(ctx);
                }
                await party.cleanup();
                ledger.clear();
            }
        } catch (err) {
            throw err;
        } finally {
            await forceReleaseE2eChainPort(undefined, { ignoreRunLock: true });
        }
    });
});
