import { test, expect } from "../../fixtures";

// Proves the harness boots: chain up, Supervisor loaded, one plugin call succeeds.
test("harness boots: chain up, Supervisor loaded, plugin call succeeds", async ({ devnet, supervisor, throwawayAccount }) => {
    // Chain is up and producing.
    const head = JSON.parse((await devnet.get("network", "/common/tapos/head")).body);
    expect(head.refBlockIndex).toBeGreaterThan(0);

    // Throwaway account exists on this worker's chain (Accounts exposes GraphQL,
    // not a REST /api/accounts/:name route).
    const gql = await devnet.post(
        "accounts",
        "/graphql",
        `query { getAccount(accountName: "${throwawayAccount.name}") { accountNum authService } }`,
        { "Content-Type": "application/graphql" },
    );
    expect(gql.status, `account ${throwawayAccount.name}: ${gql.body}`).toBe(200);
    const acct = JSON.parse(gql.body);
    expect(acct.data?.getAccount?.accountNum).toBe(throwawayAccount.name);

    // Supervisor loaded (fixture waited for SUPERVISOR_INITIALIZED) and a
    // plugin can be loaded + called end to end.
    await supervisor.loadPlugins([{ service: "host", plugin: "http" }]);
    const res = await supervisor.call({
        service: "host",
        plugin: "http",
        intf: "api",
        method: "getJson",
        params: ["/common/tapos/head"],
    });
    expect(JSON.parse(res as string).refBlockIndex).toBeGreaterThan(0);
});
