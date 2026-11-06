import { describe, expect, it } from "vitest";

import { normalizeActions, prefillFromSearch } from "./lib/agent-actions";

const credit = {
    sender: "m",
    service: "tokens",
    method: "credit",
    data: {},
    rawData: "00",
};

describe("agent page input normalization", () => {
    it("accepts a bare actions array", () => {
        expect(normalizeActions(JSON.stringify([credit]))).toEqual([
            { service: "tokens", method: "credit", rawData: "00" },
        ]);
    });
    it("accepts an X-MCP build_transaction result", () => {
        const built = { transaction: { actions: [credit] }, packed: "" };
        expect(normalizeActions(JSON.stringify(built))).toHaveLength(1);
    });
    it("unwraps a propose-wrapped build", () => {
        const built = {
            transaction: {
                actions: [
                    {
                        sender: "agent",
                        service: "staged-tx",
                        method: "propose",
                        data: { actions: [credit], auto_exec: true },
                        rawData: "ff",
                    },
                ],
            },
        };
        expect(normalizeActions(JSON.stringify(built))).toEqual([
            { service: "tokens", method: "credit", rawData: "00" },
        ]);
    });
    it("rejects actions without rawData", () => {
        expect(() =>
            normalizeActions(JSON.stringify([{ service: "a", method: "b" }])),
        ).toThrow(/rawData/);
    });
    it("prefills from query params without a key", () => {
        expect(
            prefillFromSearch("?agent=a1&managed=m1&actions=%5B%5D"),
        ).toEqual({ agent: "a1", managed: "m1", actions: "[]" });
    });
});
