import { expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gotoReliable } from "./navigation";

/** Producer account created by `psibase boot -p myprod`. */
export const PRODUCER_ACCOUNT =
    process.env.PSIBASE_E2E_PRODUCER ?? "myprod";

function accountsFrame(page: Page) {
    // The supervisor prompt page hosts BOTH the accounts plugin iframe (in
    // #root) and the supervisor's own hidden iframe (#iframe-supervisor).
    return page.frameLocator("#root iframe");
}

const DEFAULT_HOME_URL =
    process.env.PSIBASE_E2E_BASE_URL ?? "http://network.psibase.localhost:8080/";

async function ensureOnHomepage(
    page: Page,
    baseUrl = DEFAULT_HOME_URL,
): Promise<void> {
    if (/network\.psibase\.localhost/.test(page.url())) {
        return;
    }
    const timeout = Number(process.env.PSIBASE_E2E_LOGIN_NAV_MS ?? 60_000);
    const loginNavMs = Number.isFinite(timeout) ? timeout : 60_000;
    await gotoReliable(page, baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: loginNavMs,
        maxAttempts: process.env.PSIBASE_E2E_LOGIN_NAV_MS ? 4 : 2,
    });
}

/** Wait until Homepage auth UI is ready (supervisor init + current-user query settled). */
async function waitForLoginEntryPoint(page: Page): Promise<void> {
    await expect(page.locator("#iframe-supervisor")).toBeAttached({
        timeout: 60_000,
    });
    await expect(
        page
            .getByRole("button", { name: "Log in" })
            .or(page.getByText("Not logged in")),
    ).toBeVisible({ timeout: 120_000 });
}

/** Wait until Homepage shows a logged-in user in the bottom-left nav. */
async function waitForLoggedInShell(
    page: Page,
    accountName: string,
): Promise<void> {
    await expect(page.locator("#iframe-supervisor")).toBeAttached({
        timeout: 60_000,
    });
    await expect(page.getByText(accountName, { exact: true })).toBeVisible({
        timeout: 120_000,
    });
}

/** Trigger connectAccount via Homepage UI (opens Supervisor prompt with active session). */
async function openLoginPrompt(
    page: Page,
    baseUrl = DEFAULT_HOME_URL,
): Promise<void> {
    await ensureOnHomepage(page, baseUrl);
    await waitForLoginEntryPoint(page);

    const splashLogin = page.getByRole("button", { name: "Log in" });
    if (await splashLogin.isVisible().catch(() => false)) {
        await splashLogin.click();
    } else {
        await page.getByRole("button", { name: "Not logged in" }).click();
        await page.getByRole("menuitem", { name: "Log in" }).click();
    }

    await waitForAccountsPrompt(page);
}

async function waitForAccountsPrompt(page: Page): Promise<void> {
    await expect(page).toHaveURL(/supervisor\.psibase\.localhost.*prompt\.html/, {
        timeout: 60_000,
    });
    await expect(
        accountsFrame(page)
            .getByText(/Choose an account|Create a|Sign in|Import|Use another account/i)
            .first(),
    ).toBeVisible({ timeout: 60_000 });
}

async function openImportFromConnect(frame: ReturnType<typeof accountsFrame>) {
    const createOnImport = frame.getByRole("button", { name: "Create account" });
    if (await createOnImport.isVisible().catch(() => false)) {
        return;
    }
    const useAnother = frame.getByText("Use another account");
    if (await useAnother.isVisible().catch(() => false)) {
        await useAnother.click();
        await expect(createOnImport).toBeVisible({ timeout: 15_000 });
        return;
    }
    await expect(createOnImport).toBeVisible({ timeout: 15_000 });
}

async function waitForAccountNameValidated(
    frame: ReturnType<typeof accountsFrame>,
): Promise<void> {
    await expect(
        frame.locator('img[alt="Recipient avatar"]'),
    ).toBeVisible({ timeout: 30_000 });
}

/**
 * Log in as the boot producer (auth-any on a fresh dev boot — no private key).
 * Matches manual flow: Log in → enter producer name → wait for account lookup → Import.
 */
export async function loginProducerViaUi(
    page: Page,
    producerName = PRODUCER_ACCOUNT,
    baseUrl = DEFAULT_HOME_URL,
): Promise<void> {
    await openLoginPrompt(page, baseUrl);

    const frame = accountsFrame(page);
    const connectAccount = frame.getByRole("button", { name: producerName });
    if (await connectAccount.isVisible().catch(() => false)) {
        await connectAccount.click();
    } else {
        await openImportFromConnect(frame);
        await frame.getByPlaceholder("Account name").fill(producerName);
        await waitForAccountNameValidated(frame);
        await frame.getByRole("button", { name: "Import" }).click();
    }

    await expect(page).toHaveURL(/\.psibase\.localhost:\d+\/?$/, {
        timeout: 60_000,
    });
    await waitForLoggedInShell(page, producerName);
}

const e2eAccountNameIndexFile = (): string =>
    process.env.PSIBASE_E2E_NAME_INDEX_FILE ??
    join(tmpdir(), "psibase-e2e-account-name-index");

/** Reset at global-setup so each suite run starts clean (later PRs grow account helpers). */
export function resetE2eAccountNameIndex(): void {
    writeFileSync(e2eAccountNameIndexFile(), "0");
}
