import { test, expect } from "../../../../e2e/fixtures";
import { mcpPost, raw, v2026, callTool, V2026 } from "./client";
import { installMcpPackages } from "./install";

// Requires the XMcp local package in the boot set (PSIBASE_PACKAGES pointing
// at a build that includes XMcp.psi). Skips cleanly otherwise.
test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const r = await raw(devnet, "x-mcp", "POST", "/", JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }));
    const ok = r.status === 200 && r.text.includes('"jsonrpc"');
    test.skip(!ok, "XMcp package not installed on this devnet (set XMCP_PSI)");
});

test("GET is 405 (no SSE stream) and foreign Origin is 403", async ({ devnet }) => {
    const get = await raw(devnet, "x-mcp", "GET", "/");
    expect(get.status).toBe(405);
    const bad = await mcpPost(devnet, { jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://evil.example" });
    expect(bad.status).toBe(403);
});

test("2025 initialize handshake still works", async ({ devnet }) => {
    const r = await mcpPost(devnet, {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
    });
    expect(r.status).toBe(200);
    expect(r.json.result.protocolVersion).toBe("2025-06-18");
    const n = await mcpPost(devnet, { jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-06-18" });
    expect(n.status).toBe(202);
});

test("2026-07-28: server/discover, header validation, tools/list", async ({ devnet }) => {
        const d = await v2026(devnet, 1, "server/discover");
    expect(d.json.result.supportedVersions).toContain(V2026);
    const mismatch = await mcpPost(devnet, { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: { protocolVersion: V2026 } } },
        { "MCP-Protocol-Version": V2026, "Mcp-Method": "tools/call" });
    expect(mismatch.status).toBe(400);
    const list = await v2026(devnet, 3, "tools/list");
    expect(list.json.result.tools.map((t: any) => t.name)).toEqual(["list_services", "describe_service", "build_transaction"]);
});

test("discovery from live service schemas", async ({ devnet }) => {
        const svcs = await callTool(devnet, "list_services", {});
    expect(svcs.packages.some((p: any) => p.services.includes("tokens"))).toBe(true);
    const tokens = await callTool(devnet, "describe_service", { service: "tokens" });
    const names = tokens.tools.map((t: any) => t.name);
    const credit = tokens.tools.find((t: any) => t.name === "tokens.credit");
    expect(credit.inputSchema.properties.debitor.type).toBe("string");
    expect(names).toContain("tokens.credit");
    expect(names).not.toContain("tokens.serveSys");
});

test("build_transaction: JSON and packed bytes describe the same tx; never pushes", async ({ devnet, throwawayAccount }) => {
        const head = JSON.parse((await devnet.get("network", "/common/tapos/head")).body);
    const tapos = { ...head, expiration: new Date(Date.now() + 60_000).toISOString().replace(/\.\d+Z$/, ".000Z") };
    const action = { sender: throwawayAccount.name, service: "tokens", method: "credit",
        data: { token_id: 1, debitor: "alice", amount: { value: "1" }, memo: "e2e" } };
    const r1 = await callTool(devnet, "build_transaction", { actions: [action], tapos });
    const r2 = await callTool(devnet, "build_transaction", { actions: r1.transaction.actions, tapos });
    // Repacking the returned JSON yields identical bytes.
    expect(r2.packed).toBe(r1.packed);
    expect(r1.transaction.actions[0].sender).toBe(throwawayAccount.name);
    const wrapped = await callTool(devnet, "build_transaction", { actions: [action], tapos, propose: { proposer: throwawayAccount.name } });
    expect(wrapped.transaction.actions[0].service).toBe("staged-tx");
});
