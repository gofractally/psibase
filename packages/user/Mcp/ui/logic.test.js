import { describe, expect, it } from "vitest";
import { approveActions, approveAndGrantActions, renderRows, renderMyAgents, visibleRows, summarize } from "./static/logic.js";

const row = {
    pending: { id: 7, txid: "ab", account: "alice", proposer: "agent",
        actions: [{ sender: "alice", service: "nft", method: "mint" }] },
    missing: ["nft:mint"],
};

describe("mcp approval UI logic", () => {
    it("Approve = accept + untrack", () => {
        const a = approveActions("parent", row);
        expect(a.map((x) => `${x.service}.${x.method}`)).toEqual(["staged-tx.accept", "mcp.untrack"]);
        expect(a.every((x) => x.sender === "parent")).toBe(true);
    });
    it("Approve and Grant = grant_missing + accept, one tx", () => {
        const a = approveAndGrantActions("parent", row);
        expect(a.map((x) => `${x.service}.${x.method}`)).toEqual(["mcp.grant_missing", "staged-tx.accept"]);
        expect(a[1].data).toEqual({ id: 7, txid: "ab" });
    });
    it("hides rows whose staged tx is gone", () => {
        expect(visibleRows([row], [])).toEqual([]);
        expect(visibleRows([row], [7])).toEqual([row]);
    });
    it("renders both buttons and escapes names", () => {
        const html = renderRows([{ ...row, pending: { ...row.pending, proposer: "<x>" } }]);
        expect(html).toContain("Approve and Grant");
        expect(html).toContain("&lt;x&gt;");
        expect(renderRows([])).toContain("Nothing needs approval");
        expect(summarize(row)).toBe("alice → nft.mint");
    });
    it("renders my agents list", () => {
        expect(renderMyAgents([])).toContain("No agents wired yet");
        expect(
            renderMyAgents([{ account: "m", agent: "a", parent: "p" }]),
        ).toContain("data-testid=\"agent-cfg\"");
    });
});
