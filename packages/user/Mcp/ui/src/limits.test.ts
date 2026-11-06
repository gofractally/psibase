import { describe, expect, it } from "vitest";

import { enforcerNameError } from "./lib/account";
import { displayedParameters } from "./lib/limits";
import { type InspectedAction, parameters, standingRules } from "./lib/limits";
import { agentHandOffPrompt } from "./lib/logic";

describe("standing parameter rules", () => {
    it("requires three distinct valid accounts", () => {
        expect(enforcerNameError("owner", "agent", "owner")).toMatch(/differ/);
        expect(enforcerNameError("agent", "agent", "owner")).toMatch(/differ/);
        expect(enforcerNameError("", "agent", "owner")).toBeTruthy();
        expect(enforcerNameError("verifier", "agent", "owner")).toBeNull();
    });
    it("displays nested parameters with escaped JSON pointers", () => {
        expect(
            parameters({
                amount: { value: "18446744073709551615" },
                "a/b": true,
            }).map(([p]) => p),
        ).toEqual(["/amount", "/amount/value", "/a~1b"]);
    });
    const action: InspectedAction = {
        service: "tokens",
        method: "credit",
        parameters: {},
        failures: [],
        limits: [
            { parameter: "/amount/value", lt: '"100"', gt: null, eq: null },
        ],
    };
    it("keeps missing standing-rule parameters visible and editable", () => {
        expect(displayedParameters(action)).toEqual([
            ["/amount/value", undefined],
        ]);
    });
    it("saves enabled limits and preserves disabled comparisons", () => {
        expect(standingRules([action, action])).toEqual([
            { service: "tokens", method: "credit", limits: action.limits },
        ]);
    });
    it("refuses malformed JSON and conflicting rules rather than dropping a limit", () => {
        expect(() =>
            standingRules([
                {
                    ...action,
                    limits: [{ ...action.limits[0], lt: "not json" }],
                },
            ]),
        ).toThrow();
        expect(() =>
            standingRules([action, { ...action, limits: [] }]),
        ).toThrow(/Conflicting/);
    });
    it("hand-off never serializes the enforcer or any extra credential fields", () => {
        const cfg = {
            account: "owner",
            agent: "agent",
            enforcer: "verifier",
            enforcerKey: "OWNER-ONLY-SECRET",
        };
        const prompt = agentHandOffPrompt(
            cfg,
            { protocol: "https:", host: "mcp.example.com" },
            { pem: "AGENT-KEY" },
        );
        expect(prompt).toContain("AGENT-KEY");
        expect(prompt).not.toContain("OWNER-ONLY-SECRET");
        expect(prompt).not.toContain("verifier");
    });
});
