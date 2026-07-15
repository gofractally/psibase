import { describe, expect, it } from "vitest";

import {
    buildChurnPlan,
    CHURN_DUO_STEP_COUNT,
    CHURN_PLAN_STEP_COUNT,
    CHURN_REJOIN_BOB_STEP_INDEX,
    CHURN_REJOIN_CAROL_STEP_INDEX,
    CHURN_SOLO_STEP_COUNT,
    parseChurnLegacyPlan,
    parseChurnOfflineEnabled,
    shouldParkActorNoRealtime,
} from "./random-three-party-churn";

describe("buildChurnPlan", () => {
    it("returns 30 steps with a final groupSend", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan).toHaveLength(CHURN_PLAN_STEP_COUNT);
        expect(plan[plan.length - 1]?.kind).toBe("groupSend");
    });

    it("phased plan front-loads solo sends and staged rejoins", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        const plan = buildChurnPlan(0xdecafbad, 0);

        for (let i = 0; i < CHURN_SOLO_STEP_COUNT; i++) {
            const step = plan[i]!;
            if (step.kind === "groupSend" || step.kind === "dmSend") {
                expect(step.from).toBe("alice");
            }
            if (step.kind === "homeNav") {
                expect(step.who).toBe("alice");
            }
            expect(step.kind).not.toBe("reselectGroup");
        }

        expect(plan[CHURN_REJOIN_BOB_STEP_INDEX]).toEqual({
            kind: "offlineRejoin",
            who: "bob",
        });

        for (
            let i = CHURN_REJOIN_BOB_STEP_INDEX + 1;
            i < CHURN_REJOIN_CAROL_STEP_INDEX;
            i++
        ) {
            const step = plan[i]!;
            if (step.kind === "groupSend" || step.kind === "dmSend") {
                expect(["alice", "bob"]).toContain(step.from);
            }
        }
        expect(
            CHURN_REJOIN_CAROL_STEP_INDEX - CHURN_REJOIN_BOB_STEP_INDEX - 1,
        ).toBe(CHURN_DUO_STEP_COUNT);

        expect(plan[CHURN_REJOIN_CAROL_STEP_INDEX]).toEqual({
            kind: "offlineRejoin",
            who: "carol",
        });

        expect(plan.some((s) => s.kind === "groupSend")).toBe(true);
        expect(plan.some((s) => s.kind === "dmSend")).toBe(true);

        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = prev;
    });

    it("legacy plan includes reselectGroup and optional offlineRejoin", () => {
        const prevLegacy = process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        const prevOffline = process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE;
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = "1";
        process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE = "1";
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan.some((s) => s.kind === "reselectGroup")).toBe(true);
        expect(plan.some((s) => s.kind === "offlineRejoin")).toBe(true);
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = prevLegacy;
        process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE = prevOffline;
    });

    it("parks after middle steps (VS-2 keeps park; strip realtime on groupSend)", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(shouldParkActorNoRealtime(0, plan)).toBe(true);
        expect(shouldParkActorNoRealtime(plan.length - 2, plan)).toBe(true);
        expect(shouldParkActorNoRealtime(plan.length - 1, plan)).toBe(false);
    });

    it("parseChurnLegacyPlan defaults off", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        expect(parseChurnLegacyPlan()).toBe(false);
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = "1";
        expect(parseChurnLegacyPlan()).toBe(true);
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = prev;
    });

    it("phased plan omits random offlineRejoin outside staged steps", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        const plan = buildChurnPlan(0xdecafbad, 0);
        const rejoins = plan
            .map((s, i) => (s.kind === "offlineRejoin" ? i : -1))
            .filter((i) => i >= 0);
        expect(rejoins).toEqual([
            CHURN_REJOIN_BOB_STEP_INDEX,
            CHURN_REJOIN_CAROL_STEP_INDEX,
        ]);
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = prev;
    });

    it("legacy omits offlineRejoin unless PSIBASE_E2E_RANDOM_CHURN_OFFLINE=1", () => {
        const prevLegacy = process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN;
        const prevOffline = process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE;
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = "1";
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE;
        expect(parseChurnOfflineEnabled()).toBe(false);
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan.some((s) => s.kind === "offlineRejoin")).toBe(false);
        process.env.PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN = prevLegacy;
        process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE = prevOffline;
    });
});
