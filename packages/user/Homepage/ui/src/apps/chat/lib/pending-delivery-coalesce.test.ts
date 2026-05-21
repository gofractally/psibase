import { describe, expect, it } from "vitest";

import {
    pendingSkipLogKey,
    resetPendingSkipLogDedupe,
    shouldLogPendingSkip,
} from "./pending-delivery-coalesce";

describe("pending-delivery-coalesce", () => {
    it("dedupes skip logs by key within the window", () => {
        resetPendingSkipLogDedupe();
        const key = pendingSkipLogKey(
            "group-mesh-peer-not-ready",
            "space:abc",
            "bob",
        );
        expect(shouldLogPendingSkip(key)).toBe(true);
        expect(shouldLogPendingSkip(key)).toBe(false);
    });
});
