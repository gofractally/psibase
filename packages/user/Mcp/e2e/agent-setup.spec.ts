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
    gql,
    pendingIdsFor,
    profileOf,
} from "./setup";

test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const r = await devnet.get("mcp", "/graphql");
    test.skip(
        !r.body.includes("myAgents"),
        "Mcp package not installed (set MCP_PSI) or myAgents missing",
    );
});

test("UI: parent creates agent, confirms key, bootstraps AuthDyn managed account", async ({
    devnet,
    page,
}) => {
    const { dir, cleanup } = keyDir();
    try {
        const parent = await createKeyAccount(devnet, dir);
        const managed = `m${parent.name.slice(1)}`.slice(0, 18);
        const agent = `a${parent.name.slice(1)}`.slice(0, 18);

        await headlessLogin(page, devnet, parent, "mcp");
        await page.goto(devnet.url("mcp"));

        await page.getByTestId("managed-name").fill(managed);
        await page.getByTestId("agent-name").fill(agent);
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

        await page.getByTestId("saved-ack").check();
        await page.getByTestId("continue-confirm").click();
        await page.getByTestId("confirm-pem").fill(pem);
        await clickWithTrust(
            page,
            () => page.getByTestId("confirm-bootstrap").click(),
            devnet.url("mcp"),
        );

        await expect(page.getByTestId("setup-done")).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByTestId("setup-success")).toContainText(managed);
        await expect(page.getByTestId("agent-cfg")).toContainText(managed);

        const j = await gql(
            devnet,
            "mcp",
            `{ agent(account: "${managed}") { account agent parent } }`,
        );
        expect(j?.data?.agent).toEqual({
            account: managed,
            agent,
            parent: parent.name,
        });
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
        const parent = await createKeyAccount(devnet, dir);
        const agent = await createKeyAccount(devnet, dir);
        const managed = `m${parent.name.slice(1)}`.slice(0, 18);

        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: parent.name,
                    service: "mcp",
                    method: "bootstrap",
                    data: { account: managed, agent: agent.name },
                },
            ],
            { keys: [parent.privateKeyPath] },
        );
        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: parent.name,
                    service: "mcp",
                    method: "grant",
                    data: {
                        account: managed,
                        service: "profiles",
                        method: "setProfile",
                    },
                },
            ],
            { keys: [parent.privateKeyPath] },
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
        const setup: AgentSetup = {
            managed: {
                name: managed,
                publicKeyPem: "",
                privateKeyPem: "",
                privateKeyPath: "",
            },
            agent,
            parent,
        };
        await agentSetsProfile(devnet, dir, setup, "via-imported-key");
        expect(await profileOf(devnet, managed)).toBe("via-imported-key");

        await page.getByTestId("managed-account").fill(managed);
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
        await expect
            .poll(async () => profileOf(devnet, managed), { timeout: 15_000 })
            .toBe("from-agent-page");
        expect(await pendingIdsFor(devnet, agent.name)).toEqual([]);
    } finally {
        cleanup();
    }
});
