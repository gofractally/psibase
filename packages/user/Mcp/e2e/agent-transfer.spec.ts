import {
    clickWithTrust,
    createKeyAccount,
    expect,
    keyDir,
    pushActions,
    test,
} from "../../../../e2e/fixtures";
import { callTool, raw } from "../../../local/XMcp/e2e/client";
import { installMcpPackages } from "../../../local/XMcp/e2e/install";
import {
    bootstrapAgent,
    gql,
    issueAndCredit,
    pendingIdsFor,
    stagedByProposer,
} from "./setup";

/**
 * End-to-end path for a browser-only agent: bootstrap a managed account, fund
 * it without its key, discover/build a tokens.credit via X-MCP, submit it
 * through agent.html (signed in-page), parent Approve-and-Grant, then a
 * covered repeat that executes.
 */
test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const mcp = await devnet.get("mcp", "/graphql");
    test.skip(
        !mcp.body.includes("myAgents"),
        "Mcp package not installed (set MCP_PSI)",
    );
    const ping = await raw(
        devnet,
        "x-mcp",
        "POST",
        "/",
        JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
    );
    test.skip(
        !(ping.status === 200 && ping.text.includes('"jsonrpc"')),
        "XMcp package not installed (set XMCP_PSI)",
    );
});

test("X-MCP agent credit: fund managed without its key, propose, grant, auto-exec", async ({
    devnet,
    page,
}) => {
    test.setTimeout(120_000);
    const { dir, cleanup } = keyDir();
    try {
        const s = await bootstrapAgent(devnet, dir);
        const recipient = await createKeyAccount(devnet, dir);

        const cfg = await gql(
            devnet,
            "mcp",
            `{ agent(account: "${s.managed}") { account agent parent } }`,
        );
        expect(cfg?.data?.agent).toEqual({
            account: s.managed,
            agent: s.agent.name,
            parent: s.parent.name,
        });

        // Managed has no key; parent credits land because bootstrap set AUTO_DEBIT.
        const tid = await issueAndCredit(devnet, dir, s.parent, s.managed);
        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: recipient.name,
                    service: "tokens",
                    method: "setUserConf",
                    data: { index: 0, enabled: true },
                },
            ],
            { keys: [recipient.privateKeyPath] },
        );

        const tokens = await callTool(devnet, "describe_service", {
            service: "tokens",
        });
        expect(tokens.tools.map((t: { name: string }) => t.name)).toContain(
            "tokens.credit",
        );

        const head = JSON.parse(
            (await devnet.get("network", "/common/tapos/head")).body,
        );
        const tapos = {
            ...head,
            expiration: new Date(Date.now() + 60_000)
                .toISOString()
                .replace(/\.\d+Z$/, ".000Z"),
        };
        const credit = {
            sender: s.managed,
            service: "tokens",
            method: "credit",
            data: {
                token_id: tid,
                debitor: recipient.name,
                amount: { value: "10000" },
                memo: "agent transfer",
            },
        };
        const built = await callTool(devnet, "build_transaction", {
            actions: [credit],
            tapos,
            propose: { proposer: s.agent.name, autoExec: true },
        });
        expect(built.transaction.actions[0].service).toBe("staged-tx");
        expect(built.transaction.actions[0].method).toBe("propose");

        // Submit the way a browser-only agent does: agent.html with the
        // build_transaction result pasted as-is; signing stays in the page.
        const q = new URLSearchParams({
            agent: s.agent.name,
            managed: s.managed,
            actions: JSON.stringify(built),
        });
        await page.goto(`${devnet.url("mcp")}/agent.html?${q}`);
        await expect(page.locator("#agent-account")).toHaveValue(s.agent.name);
        await expect(page.locator("#managed-account")).toHaveValue(s.managed);
        await page.locator("#agent-key").fill(s.agent.privateKeyPem);
        await clickWithTrust(
            page,
            () => page.locator("#btn-import").click(),
            devnet.url("mcp"),
        );
        await expect(page.locator("#status")).toContainText(
            `Logged in as ${s.agent.name}`,
            { timeout: 30_000 },
        );
        await clickWithTrust(
            page,
            () => page.locator("#btn-propose").click(),
            devnet.url("mcp"),
        );
        await expect(page.locator("#result")).toContainText('"ok":true', {
            timeout: 30_000,
        });
        const first = JSON.parse(await page.locator("#result").innerText());
        expect(first).toMatchObject({
            ok: true,
            executed: false,
            tracked: true,
        });
        const staged = await stagedByProposer(devnet, s.agent.name);
        expect(staged.map((x) => x.id)).toEqual([first.stagedId]);

        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: s.parent.name,
                    service: "mcp",
                    method: "grant_missing",
                    data: { account: s.managed, id: staged[0].id },
                },
                {
                    sender: s.parent.name,
                    service: "staged-tx",
                    method: "accept",
                    data: { id: staged[0].id, txid: staged[0].txid },
                },
            ],
            { keys: [s.parent.privateKeyPath] },
        );
        expect(await pendingIdsFor(devnet, s.agent.name)).toEqual([]);

        // Recipient can spend what the managed account credited (auto-debit on).
        await pushActions(
            devnet,
            dir,
            [
                {
                    sender: recipient.name,
                    service: "tokens",
                    method: "credit",
                    data: {
                        token_id: tid,
                        debitor: s.parent.name,
                        amount: { value: "1" },
                        memo: "prove receipt",
                    },
                },
            ],
            { keys: [recipient.privateKeyPath] },
        );

        // Covered repeat through the same page now reports executed.
        const again = await callTool(devnet, "build_transaction", {
            actions: [
                {
                    ...credit,
                    data: {
                        ...credit.data,
                        amount: { value: "2" },
                        memo: "agent transfer again",
                    },
                },
            ],
            tapos,
            propose: { proposer: s.agent.name, autoExec: true },
        });
        await page.locator("#actions-json").fill(JSON.stringify(again));
        await clickWithTrust(
            page,
            () => page.locator("#btn-propose").click(),
            devnet.url("mcp"),
        );
        await expect(page.locator("#result")).toContainText('"executed":true', {
            timeout: 30_000,
        });
        expect(await pendingIdsFor(devnet, s.agent.name)).toEqual([]);
    } finally {
        cleanup();
    }
});
