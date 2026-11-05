import { test, expect, headlessLogin } from "../../../../e2e/fixtures";
import { installMcpPackages } from "../../../local/XMcp/e2e/install";
import { raw } from "../../../local/XMcp/e2e/client";

// The needs-approval list on the objective `mcp` service is gated by the query
// token: only the owning (parent) account can read it.
const Q = (owner: string) => ({ query: `{ needsApproval(owner: "${owner}") { pending { id account } missing } }` });

test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const r = await devnet.get("mcp", "/graphql");
    test.skip(!r.body.includes("needsApproval"), "Mcp package not installed on this devnet (set MCP_PSI)");
});

test("no query token: needsApproval is denied", async ({ devnet, throwawayAccount }) => {
    const r = await raw(devnet, "mcp", "POST", "/graphql", JSON.stringify(Q(throwawayAccount.name)), { "Content-Type": "application/json" });
    const body = JSON.parse(r.text);
    expect(body.errors?.[0]?.message).toMatch(/permission denied/);
});

test("another account's query token is denied; owner's token is allowed", async ({ devnet, page, throwawayAccount }) => {
    // Log the Supervisor in as `throwawayAccount` and capture the query token
    // the mcp plugin sends to r-mcp when the approval UI loads.
    await headlessLogin(page, devnet, throwawayAccount, "mcp");
    const token = new Promise<string>((resolve) =>
        page.on("request", (req) => {
            const auth = req.headers()["authorization"];
            if (auth?.startsWith("Bearer ") && new URL(req.url()).hostname.startsWith("mcp.")) resolve(auth.slice(7));
        }),
    );
    await page.goto(devnet.url("mcp"));
    await expect(page.getByTestId("empty")).toBeVisible();
    const bearer = { "Content-Type": "application/json", Authorization: `Bearer ${await token}` };
    const post = async (owner: string) =>
        JSON.parse((await raw(devnet, "mcp", "POST", "/graphql", JSON.stringify(Q(owner)), bearer)).text);

    const other = await post("root");
    expect(other.errors?.[0]?.message).toMatch(/permission denied/);
    const own = await post(throwawayAccount.name);
    expect(own.errors).toBeUndefined();
    expect(own.data.needsApproval).toEqual([]);
});
