import {
    test,
    expect,
    keyDir,
    pushActions,
    headlessLogin,
    clickWithTrust,
} from "../../../../e2e/fixtures";
import { installMcpPackages } from "../../../local/XMcp/e2e/install";
import { setupAgent, agentSetsProfile, profileOf, pendingIdsFor } from "./setup";

// POC approval flow (mcp-server-on-chain-v2.md, "POC approval flow").
test.beforeEach(async ({ devnet }) => {
    await installMcpPackages(devnet);
    const r = await devnet.get("mcp", "/graphql");
    test.skip(!r.body.includes("needsApproval"), "Mcp package not installed on this devnet (set MCP_PSI)");
});

test("covered tx auto-executes", async ({ devnet }) => {
    const { dir, cleanup } = keyDir();
    try {
        const s = await setupAgent(devnet, dir);
        await pushActions(devnet, dir, [
            { sender: s.owner.name, service: "mcp", method: "grant", data: { account: s.owner.name, service: "profiles", method: "setProfile" } },
        ], { keys: [s.owner.privateKeyPath] });
        await agentSetsProfile(devnet, dir, s, "covered");
        expect(await profileOf(devnet, s.owner.name)).toBe("covered");
        expect(await pendingIdsFor(devnet, s.agent.name)).toEqual([]);
    } finally {
        cleanup();
    }
});

async function stageUncovered(devnet: any, dir: string, name: string) {
    const s = await setupAgent(devnet, dir);
    await agentSetsProfile(devnet, dir, s, name);
    const [id] = await pendingIdsFor(devnet, s.agent.name);
    expect(id, "uncovered tx should stay staged").toBeDefined();
    expect(await profileOf(devnet, s.owner.name)).toBeUndefined();
    // The agent records it for the owner's needs-approval list.
    await pushActions(devnet, dir, [{ sender: s.agent.name, service: "mcp", method: "track", data: { id } }], { keys: [s.agent.privateKeyPath] });
    return { s, id };
}

test("uncovered tx: owner clicks Approve in the mcp UI and it executes", async ({ devnet, page }) => {
    const { dir, cleanup } = keyDir();
    try {
        const { s, id } = await stageUncovered(devnet, dir, "approved");
        await headlessLogin(page, devnet, s.owner, "mcp");
        await page.goto(devnet.url("mcp"));
        const row = page.locator(`[data-testid=pending-row][data-id="${id}"]`);
        await expect(row).toContainText(/profiles\.setprofile/i);
        await expect(row).toContainText(/profiles:setprofile/i);
        await clickWithTrust(page, () => page.locator(`[data-testid=pending-row][data-id="${id}"]`).getByRole("button", { name: "Approve", exact: true }).click(), devnet.url("mcp"));
        await expect(page.getByTestId("empty")).toBeVisible();
        expect(await profileOf(devnet, s.owner.name)).toBe("approved");
    } finally {
        cleanup();
    }
});

test("Approve and Grant executes and grows the allowlist; a repeat auto-executes", async ({ devnet, page }) => {
    const { dir, cleanup } = keyDir();
    try {
        const { s, id } = await stageUncovered(devnet, dir, "granted");
        await headlessLogin(page, devnet, s.owner, "mcp");
        await page.goto(devnet.url("mcp"));
        await clickWithTrust(page, () => page.locator(`[data-testid=pending-row][data-id="${id}"]`).getByRole("button", { name: "Approve and Grant" }).click(), devnet.url("mcp"));
        await expect(page.getByTestId("empty")).toBeVisible();
        expect(await profileOf(devnet, s.owner.name)).toBe("granted");
        // Repeat: now covered, so the agent's proposal executes immediately.
        await agentSetsProfile(devnet, dir, s, "repeat");
        expect(await profileOf(devnet, s.owner.name)).toBe("repeat");
        expect(await pendingIdsFor(devnet, s.agent.name)).toEqual([]);
    } finally {
        cleanup();
    }
});
