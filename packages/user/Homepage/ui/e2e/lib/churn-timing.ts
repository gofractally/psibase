import { setTimeout as delay } from "node:timers/promises";

import type { ChurnStep } from "./random-three-party-churn";

/** Mesh-paced runs wait for signaling; stress runs steps back-to-back. */
export type ChurnSpeedMode = "mesh" | "stress";

export type ChurnTimingConfig = {
    mode: ChurnSpeedMode;
    /** Pause after steps that start or tear down WebRTC / navigation. */
    meshSettleMs: number;
    /** Minimum gap between consecutive planner steps. */
    interStepMs: number;
    /** After leaving Chat shell, before reopening (homeNav path). */
    homeDelayMs: number;
    /** Fail the test on first step error; if false, run all steps and report. */
    strict: boolean;
};

function parsePositiveMs(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
}

export function parseChurnSpeedMode(): ChurnSpeedMode {
    const raw = process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED?.toLowerCase();
    if (raw === "mesh" || raw === "paced" || raw === "slow") return "mesh";
    return "stress";
}

export function getChurnTimingConfig(): ChurnTimingConfig {
    const mode = parseChurnSpeedMode();
    if (mode === "mesh") {
        return {
            mode,
            meshSettleMs: parsePositiveMs(
                process.env.PSIBASE_E2E_CHURN_MESH_SETTLE_MS,
                3_000,
            ),
            interStepMs: parsePositiveMs(
                process.env.PSIBASE_E2E_CHURN_INTER_STEP_MS,
                400,
            ),
            homeDelayMs: parsePositiveMs(
                process.env.PSIBASE_E2E_CHURN_HOME_DELAY_MS,
                1_500,
            ),
            strict: process.env.PSIBASE_E2E_RANDOM_CHURN_STRICT !== "0",
        };
    }
    return {
        mode,
        meshSettleMs: parsePositiveMs(
            process.env.PSIBASE_E2E_CHURN_MESH_SETTLE_MS,
            0,
        ),
        interStepMs: parsePositiveMs(
            process.env.PSIBASE_E2E_CHURN_INTER_STEP_MS,
            0,
        ),
        homeDelayMs: parsePositiveMs(
            process.env.PSIBASE_E2E_CHURN_HOME_DELAY_MS,
            1_000,
        ),
        strict: process.env.PSIBASE_E2E_RANDOM_CHURN_STRICT === "1",
    };
}

/** Steps that need time for mesh legs / session join to finish before the next action. */
export function stepNeedsMeshSettle(step: ChurnStep): boolean {
    return (
        step.kind === "groupSend" ||
        step.kind === "reselectGroup" ||
        step.kind === "homeNav" ||
        step.kind === "dmSend" ||
        step.kind === "offlineRejoin"
    );
}

export function pacingDelayAfterStep(
    step: ChurnStep,
    config: ChurnTimingConfig,
): number {
    if (config.mode === "stress" && config.meshSettleMs === 0) {
        return config.interStepMs;
    }
    let settle = stepNeedsMeshSettle(step) ? config.meshSettleMs : 0;
    if (config.mode === "mesh") {
        // Home→Chat churn aborts in-flight mesh work; allow legs to finish.
        if (step.kind === "homeNav") {
            settle += config.meshSettleMs;
        }
        // Group send after nav needs both mesh legs up (~3s each hop).
        if (step.kind === "groupSend") {
            settle += config.meshSettleMs;
        }
    }
    return config.interStepMs + settle;
}

export async function churnPacingAfterStep(
    step: ChurnStep,
    config: ChurnTimingConfig,
): Promise<void> {
    const ms = pacingDelayAfterStep(step, config);
    if (ms <= 0) return;
    console.log(
        `[random-churn] pacing mode=${config.mode} after=${step.kind} waitMs=${ms}`,
    );
    await delay(ms);
}

/** Let the prior step's mesh/signaling finish before a disruptive action. */
export async function churnPacingBeforeStep(
    step: ChurnStep,
    config: ChurnTimingConfig,
    prevStep?: ChurnStep,
): Promise<void> {
    if (config.mode !== "mesh" || !stepNeedsMeshSettle(step)) return;
    let ms = config.meshSettleMs;
    if (config.mode === "mesh" && step.kind === "homeNav" && prevStep) {
        if (prevStep.kind === "homeNav") {
            ms += config.meshSettleMs * 3;
        } else if (prevStep.kind === "dmSend") {
            ms += config.meshSettleMs * 3;
        } else if (prevStep.kind === "groupSend") {
            ms += config.meshSettleMs * 2;
        }
    }
    if (ms <= 0) return;
    console.log(
        `[random-churn] pacing mode=${config.mode} before=${step.kind} waitMs=${ms}`,
    );
    await delay(ms);
}

/** Extra wall clock per iteration for mesh pacing (planner steps only). */
export function estimateIterationPacingMs(
    stepCount: number,
    config: ChurnTimingConfig,
): number {
    if (config.mode === "stress") {
        return stepCount * config.interStepMs;
    }
    const settlePasses = 2;
    return stepCount * (config.interStepMs + config.meshSettleMs * settlePasses);
}
