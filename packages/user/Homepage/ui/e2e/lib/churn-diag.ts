import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "@playwright/test";

export type ChurnDiagConfig = {
    /** Inclusive step index range for human-paced actions, e.g. 11–13. */
    humanStepRange: { start: number; end: number } | null;
    humanMs: number;
    /** Per-step timeout when human pacing is active (pauses add wall time). */
    humanStepBudgetMs: number;
    disableRecycle: boolean;
    /** Stop after this planner step index (inclusive). */
    stopAtStep: number | null;
    enabled: boolean;
};

function parseStepRange(
    raw: string | undefined,
): { start: number; end: number } | null {
    if (!raw?.trim()) return null;
    const m = raw.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        return null;
    }
    return { start, end };
}

export function getChurnDiagConfig(): ChurnDiagConfig {
    const humanStepRange = parseStepRange(
        process.env.PSIBASE_E2E_RANDOM_CHURN_DIAG_STEPS,
    );
    const humanMs = Number(process.env.PSIBASE_E2E_RANDOM_CHURN_HUMAN_MS ?? 0);
    const stopRaw = process.env.PSIBASE_E2E_RANDOM_CHURN_DIAG_STOP_AT;
    const stopAtStep =
        stopRaw !== undefined && stopRaw !== "" && Number.isFinite(Number(stopRaw))
            ? Number(stopRaw)
            : null;
    const disableRecycle =
        process.env.PSIBASE_E2E_RANDOM_CHURN_DISABLE_RECYCLE === "1";
    const enabled =
        Boolean(humanStepRange) ||
        disableRecycle ||
        stopAtStep !== null ||
        (Number.isFinite(humanMs) && humanMs > 0);
    const humanStepBudgetMs = Number(
        process.env.PSIBASE_E2E_RANDOM_CHURN_DIAG_STEP_MS ?? 300_000,
    );
    return {
        humanStepRange,
        humanMs: Number.isFinite(humanMs) && humanMs > 0 ? humanMs : 3_000,
        humanStepBudgetMs:
            Number.isFinite(humanStepBudgetMs) && humanStepBudgetMs > 0
                ? humanStepBudgetMs
                : 300_000,
        disableRecycle,
        stopAtStep,
        enabled,
    };
}

export function stepBudgetMsForDiag(
    stepIndex: number,
    defaultBudgetMs: number,
    config: ChurnDiagConfig,
): number {
    if (!isHumanDiagStep(stepIndex, config)) return defaultBudgetMs;
    return Math.max(defaultBudgetMs, config.humanStepBudgetMs);
}

export function isHumanDiagStep(
    stepIndex: number,
    config: ChurnDiagConfig,
): boolean {
    const r = config.humanStepRange;
    if (!r) return false;
    return stepIndex >= r.start && stepIndex <= r.end;
}

export async function humanDiagPause(
    config: ChurnDiagConfig,
    label: string,
): Promise<void> {
    if (!config.enabled || config.humanMs <= 0) return;
    console.log(
        `[random-churn-diag] human pause ${config.humanMs}ms label=${label}`,
    );
    await delay(config.humanMs);
}

/** Record a harness-side trace event in the page under test. */
export async function recordPageChurnTrace(
    page: Page,
    event: string,
    detail?: Record<string, unknown>,
): Promise<void> {
    await Promise.race([
        page.evaluate(
            ({ ev, det }) => {
                (
                    window as Window & {
                        __chatChurnTrace?: {
                            record: (
                                e: string,
                                d?: Record<string, unknown>,
                            ) => void;
                        };
                    }
                ).__chatChurnTrace?.record(ev, det);
            },
            { ev: event, det: detail },
        ),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
}

/** Read the churn probe through CDP so diagnostics still work when page.evaluate wedges. */
export async function readPageChurnProbe(page: Page): Promise<unknown> {
    try {
        const cdp = await page.context().newCDPSession(page);
        const result = await Promise.race([
            cdp.send("Runtime.evaluate", {
                expression: "globalThis.__chatChurnProbe?.() ?? null",
                returnByValue: true,
                awaitPromise: false,
            }),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error("cdp churn probe timeout")),
                    3_000,
                ),
            ),
        ]);
        return (result as { result?: { value?: unknown } }).result?.value ?? null;
    } catch (err) {
        return { error: String(err) };
    }
}

export async function dumpChurnDiagTraces(
    pages: { alice: Page; bob: Page | null; carol: Page | null },
    actors: readonly ("alice" | "bob" | "carol")[],
    label: string,
): Promise<void> {
    for (const who of actors) {
        const page = pages[who];
        if (!page) continue;
        try {
            const payload = await Promise.race([
                page.evaluate(() => {
                    const trace = (
                        window as Window & {
                            __chatChurnTrace?: {
                                events: () => unknown;
                                dump: () => string;
                            };
                        }
                    ).__chatChurnTrace;
                    const dbg = (
                        window as Window & {
                            __chatDataDebug?: {
                                snapshot?: () => unknown;
                            };
                        }
                    ).__chatDataDebug;
                    const churnState = (
                        window as Window & {
                            __chatChurnState?: () => Record<string, unknown>;
                        }
                    ).__chatChurnState?.();
                    const threadLifecycle = (
                        window as Window & {
                            __chatThreadLifecycle?: {
                                events: () => unknown;
                                dump: () => string;
                            };
                        }
                    ).__chatThreadLifecycle;
                    return {
                        url: location.href,
                        pathname: location.pathname,
                        trace: trace?.events?.() ?? [],
                        churnState: churnState ?? null,
                        threadLifecycle: threadLifecycle?.events?.().slice(-40) ?? [],
                        chatData: dbg?.snapshot?.() ?? null,
                    };
                }),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error("diag dump timeout")),
                        8_000,
                    ),
                ),
            ]);
            console.log(
                `[random-churn-diag] dump ${label} ${who}=${JSON.stringify(payload)}`,
            );
        } catch (err) {
            const probe = await readPageChurnProbe(page);
            console.log(
                `[random-churn-diag] dump ${label} ${who}=skipped (${String(err)}) probe=${JSON.stringify(probe)}`,
            );
        }
    }
}
