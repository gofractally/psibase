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

const ACTORS: readonly PartyActor[] = ["alice", "bob", "carol"];

function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]!;
}

function otherActors(from: PartyActor): readonly PartyActor[] {
    return ACTORS.filter((a) => a !== from);
}

/**
 * Build a pseudo-random churn plan for one iteration.
 * Exactly {@link CHURN_PLAN_STEP_COUNT} steps; the last is always `groupSend`
 * so all parties can assert delivery in the group thread.
 */
export function buildChurnPlan(
    seed: number,
    iteration: number,
): ChurnStep[] {
    const rng = mulberry32(seed + iteration * 9973);
    const middleCount = CHURN_PLAN_STEP_COUNT - 1;
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

    steps.push({
        kind: "groupSend",
        from: pick(rng, ACTORS),
        body: `rand-${iteration}-final`,
    });
    return steps;
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

/** Offline rejoin is opt-in (default off); it often destabilizes the group mesh in one chain. */
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
