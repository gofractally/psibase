/** Deterministic PRNG for reproducible manual stress runs. */
export function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export type PartyActor = "alice" | "bob" | "carol";

export type ChurnStep =
    | { kind: "groupSend"; from: PartyActor; body: string }
    | { kind: "dmSend"; from: PartyActor; to: PartyActor; body: string }
    | { kind: "homeNav"; who: PartyActor }
    /** Click the group row again while already on Chat (same conv twice in a row). */
    | { kind: "reselectGroup"; who: PartyActor }
    | { kind: "offlineRejoin"; who: "bob" | "carol" };

/** Total steps per iteration (includes the mandatory final `groupSend`). */
export const CHURN_PLAN_STEP_COUNT = 30;

/** Solo-phase steps before first staged rejoin (Bob). */
export const CHURN_SOLO_STEP_COUNT = 8;

/** Index of the mandatory Bob rejoin in the phased offline-first plan. */
export const CHURN_REJOIN_BOB_STEP_INDEX = CHURN_SOLO_STEP_COUNT;

/** Duo-phase steps (Alice + Bob online, Carol offline). */
export const CHURN_DUO_STEP_COUNT = 7;

/** Index of the mandatory Carol rejoin in the phased offline-first plan. */
export const CHURN_REJOIN_CAROL_STEP_INDEX =
    CHURN_REJOIN_BOB_STEP_INDEX + 1 + CHURN_DUO_STEP_COUNT;

const ACTORS: readonly PartyActor[] = ["alice", "bob", "carol"];

function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]!;
}

function otherActors(from: PartyActor): readonly PartyActor[] {
    return ACTORS.filter((a) => a !== from);
}

type PhaseStepConfig = {
    iteration: number;
    stepBase: number;
    allowedSenders: readonly PartyActor[];
    allowedHomeNav: readonly PartyActor[];
    allowReselect: boolean;
    rng: () => number;
};

function buildPhaseSteps(count: number, cfg: PhaseStepConfig): ChurnStep[] {
    const steps: ChurnStep[] = [];
    for (let i = 0; i < count; i++) {
        const stepIndex = cfg.stepBase + i;
        const roll = cfg.rng();
        if (roll < 0.38) {
            const from = pick(cfg.rng, cfg.allowedSenders);
            steps.push({
                kind: "groupSend",
                from,
                body: `rand-grp-${cfg.iteration}-${stepIndex}-${from}`,
            });
        } else if (roll < 0.72) {
            const from = pick(cfg.rng, cfg.allowedSenders);
            const to = pick(cfg.rng, otherActors(from));
            steps.push({
                kind: "dmSend",
                from,
                to,
                body: `rand-dm-${cfg.iteration}-${stepIndex}-${from}-${to}`,
            });
        } else if (roll < 0.88) {
            steps.push({
                kind: "homeNav",
                who: pick(cfg.rng, cfg.allowedHomeNav),
            });
        } else if (cfg.allowReselect) {
            steps.push({
                kind: "reselectGroup",
                who: pick(cfg.rng, cfg.allowedSenders),
            });
        } else {
            steps.push({
                kind: "homeNav",
                who: pick(cfg.rng, cfg.allowedHomeNav),
            });
        }
    }
    return steps;
}

function buildLegacyMiddleSteps(
    rng: () => number,
    iteration: number,
    middleCount: number,
): ChurnStep[] {
    const steps: ChurnStep[] = [];
    const offlineEnabled = parseChurnOfflineEnabled();
    let prevWasOfflineRejoin = false;
    for (let i = 0; i < middleCount; i++) {
        const roll = rng();
        if (roll < 0.32) {
            prevWasOfflineRejoin = false;
            const from = pick(rng, ACTORS);
            steps.push({
                kind: "groupSend",
                from,
                body: `rand-grp-${iteration}-${i}-${from}`,
            });
        } else if (roll < 0.62) {
            prevWasOfflineRejoin = false;
            const from = pick(rng, ACTORS);
            const to = pick(rng, otherActors(from));
            steps.push({
                kind: "dmSend",
                from,
                to,
                body: `rand-dm-${iteration}-${i}-${from}-${to}`,
            });
        } else if (roll < 0.82) {
            prevWasOfflineRejoin = false;
            steps.push({ kind: "homeNav", who: pick(rng, ACTORS) });
        } else if (roll < 0.9) {
            prevWasOfflineRejoin = false;
            steps.push({ kind: "reselectGroup", who: pick(rng, ACTORS) });
        } else if (offlineEnabled && !prevWasOfflineRejoin) {
            prevWasOfflineRejoin = true;
            steps.push({
                kind: "offlineRejoin",
                who: rng() < 0.5 ? "bob" : "carol",
            });
        } else {
            prevWasOfflineRejoin = false;
            steps.push({ kind: "homeNav", who: pick(rng, ACTORS) });
        }
    }
    return steps;
}

function buildPhasedOfflinePlan(seed: number, iteration: number): ChurnStep[] {
    const rng = mulberry32(seed + iteration * 9973);
    const steps: ChurnStep[] = [];

    steps.push(
        ...buildPhaseSteps(CHURN_SOLO_STEP_COUNT, {
            iteration,
            stepBase: 0,
            allowedSenders: ["alice"],
            allowedHomeNav: ["alice"],
            allowReselect: false,
            rng,
        }),
    );

    steps.push({ kind: "offlineRejoin", who: "bob" });

    steps.push(
        ...buildPhaseSteps(CHURN_DUO_STEP_COUNT, {
            iteration,
            stepBase: CHURN_REJOIN_BOB_STEP_INDEX + 1,
            allowedSenders: ["alice", "bob"],
            allowedHomeNav: ["alice", "bob"],
            allowReselect: true,
            rng,
        }),
    );

    steps.push({ kind: "offlineRejoin", who: "carol" });

    const trioCount =
        CHURN_PLAN_STEP_COUNT -
        1 -
        steps.length;
    steps.push(
        ...buildPhaseSteps(trioCount, {
            iteration,
            stepBase: CHURN_REJOIN_CAROL_STEP_INDEX + 1,
            allowedSenders: ACTORS,
            allowedHomeNav: ACTORS,
            allowReselect: true,
            rng,
        }),
    );

    steps.push({
        kind: "groupSend",
        from: pick(rng, ACTORS),
        body: `rand-${iteration}-final`,
    });

    return steps;
}

/**
 * Build a pseudo-random churn plan for one iteration.
 * Exactly {@link CHURN_PLAN_STEP_COUNT} steps; the last is always `groupSend`
 * so all parties can assert delivery in the group thread.
 *
 * Default: phased offline-first (solo → rejoin Bob → duo → rejoin Carol → trio).
 * Legacy pure-random middle: `PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN=1`.
 */
export function buildChurnPlan(
    seed: number,
    iteration: number,
): ChurnStep[] {
    if (parseChurnLegacyPlan()) {
        const rng = mulberry32(seed + iteration * 9973);
        const middleCount = CHURN_PLAN_STEP_COUNT - 1;
        const steps = buildLegacyMiddleSteps(rng, iteration, middleCount);
        steps.push({
            kind: "groupSend",
            from: pick(rng, ACTORS),
            body: `rand-${iteration}-final`,
        });
        return steps;
    }
    return buildPhasedOfflinePlan(seed, iteration);
}

/**
 * Park on `churnNoRealtime=1` after mesh steps (default on).
 * VS-2 strip-to-realtime before `groupSend` lives in `focusChurnGroupThread`; keeping
 * park after every step avoids signaling exhaustion before late-step sends.
 */
export function shouldParkActorNoRealtime(
    stepIndex: number,
    _plan: readonly ChurnStep[],
): boolean {
    if (stepIndex < 0 || stepIndex >= _plan.length - 1) return false;
    return true;
}

export function parseRandomChurnRuns(): number {
    const n = Number(process.env.PSIBASE_E2E_RANDOM_CHURN_RUNS ?? "0");
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Legacy pure-random plan (decaf / wedge baselines). */
export function parseChurnLegacyPlan(): boolean {
    return process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN === "1";
}

/** Offline rejoin rolls in legacy plan only (`PSIBASE_E2E_RANDOM_CHURN_OFFLINE=1`). */
export function parseChurnOfflineEnabled(): boolean {
    return process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE === "1";
}

export function parseRandomChurnSeed(): number {
    const raw = process.env.PSIBASE_E2E_RANDOM_CHURN_SEED;
    if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) return Math.floor(n) >>> 0;
    }
    return 0xdecafbad;
}

export function actorAccount(
    who: PartyActor,
    names: { alice: string; bob: string; carol: string },
): string {
    if (who === "alice") return names.alice;
    if (who === "bob") return names.bob;
    return names.carol;
}

/** Group peers for mesh helpers (everyone except self). */
export function groupPeersFor(
    who: PartyActor,
    names: { alice: string; bob: string; carol: string },
): string[] {
    if (who === "alice") return [names.bob, names.carol];
    if (who === "bob") return [names.alice, names.carol];
    return [names.alice, names.bob];
}
