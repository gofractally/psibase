import { test } from "../fixtures/chain";
import type { BrowserContext, Page } from "@playwright/test";

import { loginExistingAccountViaUi } from "../lib/auth-ui";
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
    createGroupChat,
    ensureContact,
    expectThreadMessage,
    churnHomeNav,
    churnReselectGroup,
    focusChurnGroupThread,
    openDmThread,
    openExistingGroupChat,
    openExistingGroupChatMinimal,
    sendChatMessage,
    sendChurnGroupMessage,
} from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";
import {
    actorAccount,
    buildChurnPlan,
    CHURN_PLAN_STEP_COUNT,
    parseRandomChurnRuns,
    shouldParkActorNoRealtime,
    parseRandomChurnSeed,
    type ChurnStep,
    type PartyActor,
} from "../lib/random-three-party-churn";
import { forceReleaseE2eChainPort } from "../lib/chain-boot";
import { setupThreePartyAccounts } from "../lib/setup-three-party";

const RUNS = parseRandomChurnRuns();
const BASE_SEED = parseRandomChurnSeed();
const STEP_MS = parseChurnStepTimeoutMs();
const OFFLINE_STEP_MS = parseChurnOfflineStepTimeoutMs();
const MESH_MS = parseChurnMeshTimeoutMs();
const COMPOSER_MS = 45_000;

const ALICE = "rndalice01";
const BOB = "rndbobbb01";
const CAROL = "rndcarol01";

const ACTORS: readonly PartyActor[] = ["alice", "bob", "carol"];

function groupPeersFor(
    who: PartyActor,
    names: { alice: string; bob: string; carol: string },
): string[] {
    if (who === "alice") return [names.bob, names.carol];
    if (who === "bob") return [names.alice, names.carol];
    return [names.alice, names.bob];
}

function pageFor(
    who: PartyActor,
    pages: { alice: Page; bob: Page; carol: Page },
): Page {
    if (who === "alice") return pages.alice;
    if (who === "bob") return pages.bob;
    return pages.carol;
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

async function dumpChatDataSnapshot(
    pages: { alice: Page; bob: Page; carol: Page },
    label: string,
): Promise<void> {
    const snapMs = 5_000;
    for (const who of ACTORS) {
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
 * Opt-in stress suite: set `PSIBASE_E2E_RANDOM_CHURN_RUNS=10` (optional seed
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
        "Set PSIBASE_E2E_RANDOM_CHURN_RUNS=10 for manual PR validation",
    );

    test(`random churn (${RUNS}×${CHURN_PLAN_STEP_COUNT} steps, seed ${BASE_SEED})`, async ({
        chain,
        alicePage,
        browser,
    }) => {
        const timing = getChurnTimingConfig();
        const diag = getChurnDiagConfig();
        console.log(
            `[random-churn] speed=${timing.mode} meshSettleMs=${timing.meshSettleMs} interStepMs=${timing.interStepMs} strict=${timing.strict}`,
        );
        if (diag.enabled) {
            console.log(
                `[random-churn-diag] enabled humanRange=${diag.humanStepRange ? `${diag.humanStepRange.start}-${diag.humanStepRange.end}` : "off"} humanMs=${diag.humanMs} disableRecycle=${diag.disableRecycle} stopAt=${diag.stopAtStep ?? "none"}`,
            );
        }

        const wallSec = Number(
            process.env.PSIBASE_E2E_RANDOM_CHURN_TIMEOUT_SEC ??
                (timing.mode === "mesh" ? "1200" : "900"),
        );
        const pacingPerIter = estimateIterationPacingMs(
            CHURN_PLAN_STEP_COUNT,
            timing,
        );
        const computedMs =
            Math.max(1, RUNS) *
                (CHURN_PLAN_STEP_COUNT * STEP_MS + pacingPerIter) +
            180_000;
        test.setTimeout(
            Math.min(
                Number.isFinite(wallSec) && wallSec > 0
                    ? wallSec * 1000
                    : timing.mode === "mesh"
                      ? 1_200_000
                      : 600_000,
                computedMs,
            ),
        );

        attachDiagnostics(alicePage, "alice");
        await installChurnHealthPolicy(alicePage);

        const names = { alice: ALICE, bob: BOB, carol: CAROL };
        const party = await setupThreePartyAccounts(
            chain,
            alicePage,
            browser!,
            names,
        );

        let bobPage = party.bobPage;
        let carolPage = party.carolPage;
        await installChurnHealthPolicy(bobPage);
        await installChurnHealthPolicy(carolPage);
        const extraContexts: BrowserContext[] = [];

        const pages = {
            alice: alicePage,
            bob: bobPage,
            carol: carolPage,
        };

        try {
            const groupSpaceId = await createGroupChat(alicePage, chain.baseUrl, [
                party.bobAccount.name,
                party.carolAccount.name,
            ]);
            await openExistingGroupChat(
                bobPage,
                chain.baseUrl,
                groupPeersFor("bob", names),
            );
            await openExistingGroupChat(
                carolPage,
                chain.baseUrl,
                groupPeersFor("carol", names),
            );

            const execute = async (
                step: ChurnStep,
                iteration: number,
                stepIndex: number,
                plan: ChurnStep[],
            ): Promise<void> => {
                const label = `iter=${iteration} step=${stepIndex} kind=${step.kind}`;
                const defaultBudgetMs =
                    step.kind === "offlineRejoin"
                        ? OFFLINE_STEP_MS
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
                        await sendChurnGroupMessage(
                            page,
                            chain.baseUrl,
                            peers,
                            step.body,
                            {
                                composerTimeout: COMPOSER_MS,
                                groupSpaceId,
                            },
                        );
                        if (shouldParkActorNoRealtime(stepIndex, plan)) {
                            await parkActorNoRealtime(
                                page,
                                chain.baseUrl,
                                peers,
                                groupSpaceId,
                            );
                        }
                        return;
                    }
                    if (step.kind === "dmSend") {
                        const page = pageFor(step.from, pages);
                        const peer = actorAccount(step.to, names);
                        await openDmThread(page, chain.baseUrl, peer);
                        await sendChatMessage(page, step.body, {
                            composerTimeout: COMPOSER_MS,
                        });
                        if (shouldParkActorNoRealtime(stepIndex, plan)) {
                            await parkActorNoRealtime(
                                page,
                                chain.baseUrl,
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
                            chain.baseUrl,
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
                            chain.baseUrl,
                            groupPeersFor(step.who, names),
                            { groupSpaceId },
                        );
                        if (shouldParkActorNoRealtime(stepIndex, plan)) {
                            await parkActorNoRealtime(
                                page,
                                chain.baseUrl,
                                groupPeersFor(step.who, names),
                                groupSpaceId,
                            );
                        }
                        return;
                    }

                    const who = step.who;
                    console.log(`[random-churn] ${label} phase=close-context`);
                    const oldCtx = pageFor(who, pages).context();
                    await closeContextQuietly(oldCtx);

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
                            chain.baseUrl,
                        );
                        console.log(`[random-churn] ${label} phase=contacts`);
                        await ensureContact(
                            page,
                            chain.baseUrl,
                            party.aliceAccount.name,
                        );
                        await ensureContact(
                            page,
                            chain.baseUrl,
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
                            chain.baseUrl,
                        );
                        console.log(`[random-churn] ${label} phase=contacts`);
                        await ensureContact(
                            page,
                            chain.baseUrl,
                            party.aliceAccount.name,
                        );
                        await ensureContact(
                            page,
                            chain.baseUrl,
                            party.bobAccount.name,
                        );
                    }

                    console.log(`[random-churn] ${label} phase=open-group`);
                    await openExistingGroupChatMinimal(
                        page,
                        chain.baseUrl,
                        groupPeersFor(who, names),
                    );
                });
            };

            for (let iteration = 0; iteration < RUNS; iteration++) {
                const plan = buildChurnPlan(BASE_SEED, iteration);
                const baseline = `rand-${iteration}-baseline`;
                const stepFailures: string[] = [];

                await withChurnStepTimeout(
                    `iter=${iteration} baseline-send`,
                    STEP_MS,
                    async () => {
                        await openExistingGroupChatMinimal(
                            alicePage,
                            chain.baseUrl,
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
                await churnPacingAfterStep(
                    {
                        kind: "groupSend",
                        from: "alice",
                        body: baseline,
                    },
                    timing,
                );

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
                        await execute(step, iteration, stepIndex, plan);
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
                            `fail iter=${iteration} step=${stepIndex}`,
                        );
                        await dumpChurnDiagTraces(
                            pages,
                            ACTORS,
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
                        const page = pageFor(who, pages);
                        await focusChurnGroupThread(
                            page,
                            chain.baseUrl,
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
            }
        } catch (err) {
            await dumpChatDataSnapshot(pages, "fatal");
            await dumpChurnDiagTraces(pages, ACTORS, "fatal");
            throw err;
        } finally {
            for (const ctx of extraContexts) {
                await closeContextQuietly(ctx);
            }
            await party.cleanup();
            await forceReleaseE2eChainPort(undefined, { ignoreRunLock: true });
        }
    });
});
