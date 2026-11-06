import {
    clickWithTrust,
    createKeyAccount,
    expect,
    headlessLogin,
    keyDir,
    pushActions,
    test,
} from "../../../../e2e/fixtures";
import { installMcpPackages } from "../../../local/XMcp/e2e/install";
import {
    type AgentSetup,
    agentSetsProfile,
    enforcePending,
    gql,
    pendingIdsFor,
    profileOf,
    setupAgent,
} from "./setup";

test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const r = await devnet.get("mcp", "/graphql");
    test.skip(
        !r.body.includes("myAgents"),
        "Mcp package not installed (set MCP_PSI) or myAgents missing",
    );
});

test("UI: owner creates agent, confirms key, registers it on the owner account", async ({
    devnet,
    page,
}) => {
    const { dir, cleanup } = keyDir();
    try {
        const owner = await createKeyAccount(devnet, dir);
        const enforcer = `v${owner.name.slice(1)}`.slice(0, 10);
        const agent = `a${owner.name.slice(1)}`.slice(0, 18);

        await headlessLogin(page, devnet, owner, "mcp");
        await page.goto(devnet.url("mcp"));

        await page.getByTestId("agent-name").fill(agent);
        await page.getByTestId("enforcer-name").fill(enforcer);
        await clickWithTrust(
            page,
            () => page.getByTestId("create-agent").click(),
            devnet.url("mcp"),
        );
        await expect(page.getByTestId("agent-pem")).toContainText(
            /BEGIN.*PRIVATE KEY/,
            {
                timeout: 30_000,
            },
        );
        const pem = await page.getByTestId("agent-pem").innerText();
        const verifierPem = await page.getByTestId("enforcer-pem").innerText();

        await page.getByTestId("saved-ack").check();
        await page.getByTestId("continue-confirm").click();
        await page.getByTestId("confirm-pem").fill(pem);
        await page.getByTestId("confirm-enforcer-pem").fill(verifierPem);
        await clickWithTrust(
            page,
            () => page.getByTestId("confirm-bootstrap").click(),
            devnet.url("mcp"),
        );

        await expect(page.getByTestId("setup-done")).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByTestId("setup-success")).toContainText(agent);
        await expect(page.getByTestId("agent-cfg")).toContainText(owner.name);

        const j = await gql(
            devnet,
            "mcp",
            `{ agent(account: "${owner.name}") { account agent enforcer } }`,
        );
        expect(j?.data?.agent).toEqual({
            account: owner.name,
            agent,
            enforcer,
        });
        const acct = await gql(
            devnet,
            "accounts",
            `{ getAccount(accountName: "${owner.name}") { authService } }`,
        );
        expect(acct?.data?.getAccount?.authService).toBe("mcp");
        await page.getByTestId("agent-cfg").click();
        expect(
            await page.getByTestId("agent-prompt-text").inputValue(),
        ).not.toContain(verifierPem);
    } finally {
        cleanup();
    }
});

test("agent.html: import agent key and covered setProfile auto-executes", async ({
    devnet,
    page,
}) => {
    const { dir, cleanup } = keyDir();
    try {
        const setup: AgentSetup = await setupAgent(devnet, dir);
        const { owner, agent } = setup;

        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: owner.name,
                    service: "mcp",
                    method: "grant",
                    data: {
                        account: owner.name,
                        service: "profiles",
                        method: "setProfile",
                    },
                },
            ],
            { keys: [owner.privateKeyPath] },
        );

        await page.goto(devnet.url("mcp") + "/agent.html");
        await page.getByTestId("agent-account").fill(agent.name);
        await page.getByTestId("agent-key").fill(agent.privateKeyPem);
        await clickWithTrust(
            page,
            () => page.getByTestId("import-agent").click(),
            devnet.url("mcp"),
        );
        await expect(page.getByTestId("agent-status")).toContainText(
            `Logged in as ${agent.name}`,
            {
                timeout: 30_000,
            },
        );

        // Prove the imported agent key works for covered StagedTx (CLI). The
        // for-agents page propose path is exercised next; import is the Phase-2
        // login/key-vault piece under test here.
        await agentSetsProfile(devnet, dir, setup, "via-imported-key");
        await enforcePending(devnet, dir, setup);
        expect(await profileOf(devnet, owner.name)).toBe("via-imported-key");

        await page.getByTestId("owner-account").fill(owner.name);
        await page.getByText("Demo and manual tracking").click();
        await page.getByTestId("display-name").fill("from-agent-page");
        await clickWithTrust(
            page,
            () => page.getByTestId("propose-set-profile").click(),
            devnet.url("mcp"),
        );
        await expect(page.getByTestId("agent-status")).toContainText(
            /submitted/i,
            {
                timeout: 30_000,
            },
        );
        await enforcePending(devnet, dir, setup);
        await expect
            .poll(async () => profileOf(devnet, owner.name), {
                timeout: 15_000,
            })
            .toBe("from-agent-page");
        expect(await pendingIdsFor(devnet, agent.name)).toEqual([]);
    } finally {
        cleanup();
    }
});
