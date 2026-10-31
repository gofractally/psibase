import type { Page } from "@playwright/test";
import type { Devnet } from "./devnet";

const isErr = (r: any) => r && typeof r === "object" && typeof r.name === "string" && /ErrorObject$/.test(r.name);

async function harness(page: Page, devnet: Devnet, app: string) {
    await page.goto(`${devnet.url(app)}/__e2e/harness.html`);
    await page.evaluate(() => (window as any).e2e.ready);
    return (args: Record<string, unknown>) => page.evaluate((a) => (window as any).e2e.call(a), args) as Promise<any>;
}

/**
 * Headless signing (V2 doc, "POC signing path: headless UI").
 *
 * 1. Import the account and its private key into this browser's Supervisor
 *    key vault (from the accounts app, which owns that function).
 * 2. Connect + log the account into `app` through the real login prompt UI:
 *    the app asks to connect an account, the Supervisor answers with a
 *    `user_prompt_request` redirect, and we click the account in the prompt.
 *
 * Afterwards every transaction `app` builds through its plugins is signed by
 * the Supervisor/auth-sig with that key. The test itself never signs.
 *
 * Works with the current branch's `host:accounts` interfaces and with the
 * v0.29.0-pre psidk the harness boots (`accounts:plugin`).
 */
export async function headlessLogin(page: Page, devnet: Devnet, account: { name: string; privateKeyPem: string }, app: string) {
    const cred = [{ account: account.name, key: account.privateKeyPem }];
    // Branch builds have host:accounts; the v0.29.0-pre psidk has accounts:plugin.
    // Probe once instead of trying both (a failed plugin load poisons the page).
    const headApi = (await devnet.get("host", "/accounts.wasm")).status === 200;

    // 1. Key vault import.
    let call = await harness(page, devnet, headApi ? "homepage" : "accounts");
    const r = headApi
        ? await call({ service: "host", plugin: "accounts", intf: "admin", method: "import-existing", params: [cred] })
        : await call({ service: "accounts", intf: "prompt", method: "import-existing", params: [cred] });
    if (isErr(r) || r?.name === "Error") throw new Error(`import-existing: ${JSON.stringify(r)}`);

    // 2. Connect + login via the prompt UI.
    call = await harness(page, devnet, app);
    const c = headApi
        ? await call({ service: "host", plugin: "accounts", intf: "active-app", method: "connect-account", params: [] })
        : await call({ service: "accounts", intf: "active-app", method: "connect-account", params: [] });
    if (!(isErr(c) && /user_prompt_request/.test(c.message))) throw new Error(`connect-account: ${JSON.stringify(c)}`);
    await page.goto(`${devnet.url("supervisor")}/prompt.html?returnPath=${encodeURIComponent("/")}`);
    const prompt = page.frameLocator('iframe[src*="accounts."]').first();
    await prompt.getByText(account.name, { exact: true }).click();
    await page.waitForURL((u) => u.hostname.startsWith(`${app}.`), { timeout: 30_000 });
}

/**
 * Clicks `action` in the app; if the Supervisor redirects to a permissions
 * prompt ("Trust <app> app"), accepts it for the session, waits to return to
 * the app and clicks `action` again (the prompted call was abandoned).
 */
export async function clickWithTrust(page: Page, action: () => Promise<void>, appUrlPrefix: string) {
    await action();
    const trust = page.getByRole("button", { name: /^Trust .* app$/ });
    const prompted = await page
        .waitForURL((u) => !u.toString().startsWith(appUrlPrefix), { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    if (!prompted) return;
    let btn = trust;
    for (let i = 0; i < 50; i++) {
        const f = page.frames().find((fr) => fr.url().includes("/prompt/permissions"));
        if (f) {
            btn = f.getByRole("button", { name: /^Trust .* app$/ });
            if (await btn.count()) break;
        }
        await page.waitForTimeout(200);
    }
    await btn.click();
    await page.waitForURL((u) => u.toString().startsWith(appUrlPrefix), { timeout: 20000 });
    await action();
}
