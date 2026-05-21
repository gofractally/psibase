import { describe, expect, it } from "vitest";

import {
    buildChurnPlan,
    CHURN_PLAN_STEP_COUNT,
    parseChurnOfflineEnabled,
    shouldParkActorNoRealtime,
} from "./random-three-party-churn";

describe("buildChurnPlan", () => {
    it("returns 30 steps with a final groupSend", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan).toHaveLength(CHURN_PLAN_STEP_COUNT);
        expect(plan[plan.length - 1]?.kind).toBe("groupSend");
    });

    it("includes reselectGroup and allows consecutive steps of the same kind", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan.some((s) => s.kind === "reselectGroup")).toBe(true);
        let hasConsecutiveSameKind = false;
        for (let i = 1; i < plan.length; i++) {
            if (plan[i]!.kind === plan[i - 1]!.kind) {
                hasConsecutiveSameKind = true;
                break;
            }
        }
        expect(hasConsecutiveSameKind).toBe(true);
    });

    it("decaf seed logs homeNav actors at late steps", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        const counts = { alice: 0, bob: 0, carol: 0 };
        for (let i = 0; i < plan.length; i++) {
            const s = plan[i]!;
            if (s.kind !== "homeNav") continue;
            counts[s.who]++;
            if (i >= 11) {
                console.log(`step ${i} homeNav who=${s.who} count=${counts[s.who]}`);
            }
        }
        expect(plan.length).toBeGreaterThan(13);
    });

    it("parks after middle steps (VS-2 keeps park; strip realtime on groupSend)", () => {
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(shouldParkActorNoRealtime(0, plan)).toBe(true);
        expect(shouldParkActorNoRealtime(plan.length - 2, plan)).toBe(true);
        expect(shouldParkActorNoRealtime(plan.length - 1, plan)).toBe(false);
    });

    it("omits offlineRejoin unless PSIBASE_E2E_RANDOM_CHURN_OFFLINE=1", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE;
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE;
        expect(parseChurnOfflineEnabled()).toBe(false);
        const plan = buildChurnPlan(0xdecafbad, 0);
        expect(plan.some((s) => s.kind === "offlineRejoin")).toBe(false);
        process.env.PSIBASE_E2E_RANDOM_CHURN_OFFLINE = prev;
    });
});
