import { describe, expect, it } from "vitest";

import {
    getChurnTimingConfig,
    pacingDelayAfterStep,
    parseChurnSpeedMode,
    stepNeedsMeshSettle,
} from "./churn-timing";

describe("churn-timing", () => {
    it("defaults to stress mode", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED;
        delete process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED;
        expect(parseChurnSpeedMode()).toBe("stress");
        process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED = prev;
    });

    it("mesh mode applies settle after groupSend", () => {
        const prev = process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED;
        process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED = "mesh";
        const cfg = getChurnTimingConfig();
        expect(cfg.mode).toBe("mesh");
        expect(
            pacingDelayAfterStep(
                { kind: "groupSend", from: "alice", body: "x" },
                cfg,
            ),
        ).toBeGreaterThanOrEqual(3_000);
        expect(stepNeedsMeshSettle({ kind: "homeNav", who: "bob" })).toBe(true);
        process.env.PSIBASE_E2E_RANDOM_CHURN_SPEED = prev;
    });
});
