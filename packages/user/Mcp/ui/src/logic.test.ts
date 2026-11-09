import { describe, expect, it } from "vitest";

import {
    accountNameError,
    setupNameErrors,
    setupNamesValid,
} from "./lib/account";
import {
    type PendingRow,
    agentHandOffPrompt,
    approveActions,
    approveAndGrantActions,
    summarize,
    visibleRows,
} from "./lib/logic";

const row: PendingRow = {
    pending: {
        id: 7,
        txid: "ab",
        account: "alice",
        proposer: "agent",
        actions: [{ sender: "alice", service: "nft", method: "mint" }],
    },
    missing: ["nft:mint"],
};

describe("mcp approval UI logic", () => {
    it("Approve = accept + untrack", () => {
        const a = approveActions("parent", row);
        expect(a.map((x) => `${x.service}.${x.method}`)).toEqual([
            "staged-tx.accept",
            "mcp.untrack",
        ]);
        expect(a.every((x) => x.sender === "parent")).toBe(true);
    });
    it("Approve and Grant = grant_missing + accept, one tx", () => {
        const a = approveAndGrantActions("parent", row);
        expect(a.map((x) => `${x.service}.${x.method}`)).toEqual([
            "mcp.grant_missing",
            "staged-tx.accept",
        ]);
        expect(a[1].data).toEqual({ id: 7, txid: "ab" });
    });
    it("hides rows whose staged tx is gone", () => {
        expect(visibleRows([row], [])).toEqual([]);
        expect(visibleRows([row], [7])).toEqual([row]);
    });
    it("summarizes actions", () => {
        expect(summarize(row)).toBe("alice → nft.mint");
    });
    it("hand-off prompt is setup context, not a task", () => {
        const p = agentHandOffPrompt({
            account: "not-prod7",
            agent: "agentprod7",
        }, { protocol: "https:", host: "mcp.example.org:9090" });
        expect(p).toContain("Psibase blockchain");
        expect(p).toContain("node at https://example.org:9090/");
        expect(p).toContain("agent account agentprod7");
        expect(p).toContain("user's own account not-prod7");
        expect(p).toContain("not-prod7 as the sender");
        expect(p).not.toMatch(/managed/i);
        expect(p).toContain(
            "Ask me for the private key you'll need to sign when you're ready to properly store a secret.",
        );
        expect(p).not.toMatch(/BEGIN PRIVATE KEY/);
        expect(p).not.toContain("<PASTE");
        expect(p).toContain("Model Context Protocol");
        expect(p).toContain("https://x-mcp.example.org:9090/");
        expect(p).not.toMatch(/Cursor/i);
        expect(p).not.toMatch(/Transfer/i);
    });
    it("hand-off prompt never embeds a PEM", () => {
        const p = agentHandOffPrompt(
            { account: "m1", agent: "a1" },
            { protocol: "http:", host: "mcp.psibase.localhost:8080" },
        );
        expect(p).toContain(
            "Ask me for the private key you'll need to sign when you're ready to properly store a secret.",
        );
        expect(p).not.toMatch(/BEGIN PRIVATE KEY/);
        expect(p).toContain("node at http://psibase.localhost:8080/");
        expect(p).toContain("http://x-mcp.psibase.localhost:8080/");
    });
});

describe("account name validation", () => {
    it("rejects empty, too long, bad charset", () => {
        expect(accountNameError("")).toMatch(/enter/i);
        expect(accountNameError("ThisIsBad")).toMatch(/lowercase|letter/i);
        expect(accountNameError("toolongname1")).toMatch(/longer|10/i);
        expect(accountNameError("x-secret")).toMatch(/x-/i);
        expect(accountNameError("bad--name")).toMatch(/consecutive/i);
        expect(accountNameError("trailing-")).toMatch(/hyphen/i);
    });
    it("accepts valid names and requires agent to differ from owner", () => {
        expect(accountNameError("myprodtx01")).toBeNull();
        expect(setupNamesValid("agentprod1", "myprodtx01")).toBe(true);
        expect(setupNameErrors("sameacct01", "sameacct01").form).toMatch(
            /differ/i,
        );
        expect(setupNamesValid("sameacct01", "sameacct01")).toBe(false);
    });
});
