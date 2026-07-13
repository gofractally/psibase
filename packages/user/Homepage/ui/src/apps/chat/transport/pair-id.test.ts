import { describe, expect, it } from "vitest";

import {
    canonicalPairAccounts,
    isLexInitiator,
    pairSessionId,
    parsePairSessionId,
} from "./pair-id";

describe("pair-id", () => {
    it("canonicalPairAccounts orders lexicographically", () => {
        expect(canonicalPairAccounts("bob", "alice")).toEqual(["alice", "bob"]);
        expect(canonicalPairAccounts("alice", "bob")).toEqual(["alice", "bob"]);
    });

    it("pairSessionId is stable regardless of argument order", () => {
        expect(pairSessionId("bob", "alice")).toBe("wrtc:pair:alice:bob");
        expect(pairSessionId("alice", "bob")).toBe("wrtc:pair:alice:bob");
    });

    it("parsePairSessionId round-trips", () => {
        const id = pairSessionId("alice", "bob");
        expect(parsePairSessionId(id)).toEqual(["alice", "bob"]);
        expect(parsePairSessionId("wrtc:space:abc")).toBeNull();
    });

    it("isLexInitiator follows lex order", () => {
        expect(isLexInitiator("alice", "bob")).toBe(true);
        expect(isLexInitiator("bob", "alice")).toBe(false);
    });

    it("lex initiator is antisymmetric (glare-safe late join)", () => {
        // Late joiner does not become initiator — both sides always agree
        // on who is impolite regardless of join order.
        const pairs: Array<[string, string]> = [
            ["alice", "bob"],
            ["carol", "alice"],
            ["bob", "zack"],
        ];
        for (const [a, b] of pairs) {
            expect(isLexInitiator(a, b)).not.toBe(isLexInitiator(b, a));
            expect(isLexInitiator(a, b)).toBe(a.localeCompare(b) <= 0);
        }
    });
});
