import { describe, expect, it } from "vitest";

import {
    createPendingLedger,
    type PendingLedgerEntry,
} from "./churn-pending-ledger";

describe("createPendingLedger", () => {
    it("records and flushes per recipient", () => {
        const ledger = createPendingLedger();
        const entry: PendingLedgerEntry = {
            body: "msg-1",
            from: "alice",
            to: "bob",
            channel: "dm",
        };
        ledger.record(entry);
        expect(ledger.forRecipient("bob")).toHaveLength(1);
        expect(ledger.forRecipient("carol")).toHaveLength(0);
        ledger.remove(entry);
        expect(ledger.forRecipient("bob")).toHaveLength(0);
    });
});
