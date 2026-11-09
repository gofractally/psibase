import { describe, expect, it } from "vitest";

import { enforcerNameError } from "./lib/account";
import {
    type InspectedAction,
    displayedParameters,
    parameters,
    setComparison,
    standingRules,
} from "./lib/limits";
import { agentHandOffPrompt } from "./lib/logic";

describe("standing parameter rules", () => {
    it("requires three distinct valid accounts", () => {
        expect(enforcerNameError("owner", "agent", "owner")).toMatch(/differ/);
        expect(enforcerNameError("agent", "agent", "owner")).toMatch(/differ/);
        expect(enforcerNameError("", "agent", "owner")).toBeTruthy();
        expect(enforcerNameError("verifier", "agent", "owner")).toBeNull();
    });
    it("lists leaf parameters with escaped JSON pointers", () => {
        expect(
            parameters({
                amount: { value: "18446744073709551615" },
                "a/b": true,
            }).map(([p]) => p),
        ).toEqual(["/amount/value", "/a~1b"]);
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
    it("saves a single comparison and clears empty thresholds", () => {
        expect(
            setComparison([], "/amount/value", "gt", "100000"),
        ).toEqual([
            {
                parameter: "/amount/value",
                lt: null,
                gt: "100000",
                eq: null,
            },
        ]);
        expect(
            setComparison(action.limits, "/amount/value", "lt", "   "),
        ).toEqual([]);
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
    it("hand-off never serializes agent, enforcer, or other credential fields", () => {
        const cfg = {
            account: "owner",
            agent: "agent",
            enforcer: "verifier",
            enforcerKey: "OWNER-ONLY-SECRET",
        };
        const prompt = agentHandOffPrompt(cfg, {
            protocol: "https:",
            host: "mcp.example.com",
        });
        expect(prompt).not.toContain("AGENT-KEY");
        expect(prompt).not.toContain("OWNER-ONLY-SECRET");
        expect(prompt).not.toContain("verifier");
        expect(prompt).toContain(
            "Ask me for the private key you'll need to sign when you're ready to properly store a secret.",
        );
    });
});
