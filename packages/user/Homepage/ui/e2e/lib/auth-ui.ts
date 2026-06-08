import { expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chatUrlWithSpace } from "./chat-ui";
import { gotoReliable } from "./churn-navigation";
import { snapshotStep } from "./diagnostics";

/** Logged-in Homepage shell for an account (not the network portal). */
export function accountHomeUrl(accountName: string, baseUrl: string): string {
    const u = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const host = u.port
        ? `${accountName}.psibase.localhost:${u.port}`
        : `${accountName}.psibase.localhost`;
    return `http://${host}/`;
}

export type TestAccount = {
    name: string;
    privateKeyB64: string;
};

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
export async function openLoginPrompt(
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

/** Wait for the Supervisor prompt shell and the Accounts plugin frame. */
export async function waitForAccountsPrompt(page: Page): Promise<void> {
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

/** Open the nav-user menu (bottom-left) for the logged-in account. */
async function openNavUserMenu(page: Page, accountName: string): Promise<void> {
    await waitForLoggedInShell(page, accountName);
    await page.getByRole("button").filter({ hasText: accountName }).click();
}

/**
 * Generate an invite link while logged in as `producerName`.
 * Uses Homepage → nav menu → "Create invite".
 */
export async function createInviteUrl(
    page: Page,
    producerName = PRODUCER_ACCOUNT,
): Promise<string> {
    const { assertE2eChainHealthy } = await import("./chain-boot");
    await assertE2eChainHealthy();

    await openNavUserMenu(page, producerName);
    await page.getByRole("menuitem", { name: "Create invite" }).click();

    const linkInput = page.locator("#link");
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const value = await linkInput.inputValue().catch(() => "");
        if (value && value !== "Loading" && /token=/.test(value)) {
            break;
        }
        try {
            await assertE2eChainHealthy(2_000);
        } catch (err) {
            throw new Error(
                `Create invite stalled (${value === "Loading" ? "Loading" : value || "empty"}): ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        await page.waitForTimeout(500);
    }
    const inviteUrl = (await linkInput.inputValue()).trim();
    if (!inviteUrl || inviteUrl === "Loading" || !/token=/.test(inviteUrl)) {
        await expect(linkInput).toHaveValue(/token=/, { timeout: 10_000 });
    }
    const resolvedUrl = (await linkInput.inputValue()).trim();
    expect(resolvedUrl).toMatch(/invite\?token=/);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 5_000 });
    return resolvedUrl;
}

/** Accounts create-prompt requires >= 10 characters (see create-prompt.tsx). */
export const MIN_E2E_CREATE_ACCOUNT_NAME_LENGTH = 10;

/** Pre-verified via `e2e/scripts/generate-verified-account-names.sh` (round-trip compression). */
const VERIFIED_E2E_ACCOUNT_NAMES: readonly string[] = JSON.parse(
    readFileSync(
        join(process.cwd(), "e2e/lib/verified-e2e-account-names.json"),
        "utf8",
    ),
) as string[];

export const e2eAccountNameIndexFile = (): string =>
    process.env.PSIBASE_E2E_NAME_INDEX_FILE ??
    join(tmpdir(), "psibase-e2e-account-name-index");

function readE2eNameIndex(): number {
    try {
        const n = parseInt(readFileSync(e2eAccountNameIndexFile(), "utf8"), 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
        return 0;
    }
}

/** Reset at global-setup so each suite run starts from the first verified name. */
export function resetE2eAccountNameIndex(): void {
    writeFileSync(e2eAccountNameIndexFile(), "0");
}

/**
 * Next Psibase account name (10 chars, compressible on-chain), unique within this test run.
 * Names come from verified-e2e-account-names.json; call from test bodies, not module scope.
 * Index is file-backed so it survives Playwright per-file module reloads and worker respawns.
 */
export function uniqueE2eAccountName(prefix: string): string {
    void prefix;
    const idx = readE2eNameIndex();
    if (idx >= VERIFIED_E2E_ACCOUNT_NAMES.length) {
        throw new Error(
            `Ran out of verified e2e account names (${VERIFIED_E2E_ACCOUNT_NAMES.length}). ` +
                "Regenerate with e2e/scripts/generate-verified-account-names.sh",
        );
    }
    const name = VERIFIED_E2E_ACCOUNT_NAMES[idx]!;
    writeFileSync(e2eAccountNameIndexFile(), String(idx + 1));
    return name;
}

/**
 * Create a new account by opening an invite link in a fresh browser context.
 * Returns credentials for later re-login (rejoin scenarios).
 */
export async function createAccountViaInviteUrl(
    page: Page,
    inviteUrl: string,
    accountName: string,
): Promise<TestAccount> {
    await page.goto(inviteUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({
        timeout: 60_000,
    });
    await page.getByRole("button", { name: "Continue" }).click();

    await waitForAccountsPrompt(page);

    const frame = accountsFrame(page);
    await openImportFromConnect(frame);
    await frame.getByRole("button", { name: "Create account" }).click();

    let finalName = accountName;
    if (finalName.length < MIN_E2E_CREATE_ACCOUNT_NAME_LENGTH) {
        throw new Error(
            `Account name "${finalName}" must be at least ${MIN_E2E_CREATE_ACCOUNT_NAME_LENGTH} characters (Accounts create-prompt validation).`,
        );
    }

    const validationError = frame.getByText(
        /Account must be at least|This account name is not available|An unknown error occurred/i,
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
        await frame.getByPlaceholder("Account name").fill(finalName);
        await expect(
            frame.getByRole("button", { name: "Create", exact: true }),
        ).toBeEnabled({ timeout: 30_000 });
        await frame.getByRole("button", { name: "Create", exact: true }).click();

        try {
            await expect(frame.getByText("Secure your")).toBeVisible({
                timeout: 60_000,
            });
            break;
        } catch (e) {
            const detail = (await validationError.textContent())?.trim() ?? "";
            const isNameTaken = /not available/i.test(detail);
            const isInvalidName =
                /invalid account name|unknown error occurred/i.test(detail);
            if ((isNameTaken || isInvalidName) && attempt < 5) {
                finalName = uniqueE2eAccountName(accountName);
                continue;
            }
            if (await validationError.isVisible().catch(() => false)) {
                throw new Error(
                    `Account create validation failed for "${finalName}": ${detail || "unknown"}`,
                );
            }
            await snapshotStep(page, `auth-${finalName}-after-create-click`);
            throw e;
        }
    }
    const readonlyInputs = frame.locator("input[readonly]");
    await expect(readonlyInputs).toHaveCount(2, { timeout: 10_000 });
    const privateKeyB64 = (await readonlyInputs.nth(1).inputValue()).trim();
    expect(privateKeyB64.length).toBeGreaterThan(10);

    await frame.getByRole("checkbox").click();
    await frame.getByRole("button", { name: "Continue" }).click();

    await frame.getByPlaceholder("Account name").last().fill(finalName);
    await frame.getByPlaceholder("Private key").fill(privateKeyB64);
    await frame.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Accepted invite")).toBeVisible({
        timeout: 60_000,
    });

    const homeUrl = inviteUrl.replace(/invite\?.*$/, "");
    await page.goto(homeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });
    await waitForLoggedInShell(page, finalName);

    return { name: finalName, privateKeyB64 };
}

/**
 * After browser-context recycle, reuse Playwright storageState on the network
 * portal so we can skip the import-key flow when the session is still valid.
 */
export async function restoreLoggedInSessionAfterRecycle(
    page: Page,
    account: TestAccount,
    baseUrl = DEFAULT_HOME_URL,
    options?: { groupSpaceId?: string },
): Promise<void> {
    const timeout = Number(process.env.PSIBASE_E2E_LOGIN_NAV_MS ?? 60_000);
    const loginNavMs = Number.isFinite(timeout) ? timeout : 60_000;
    const maxAttempts = process.env.PSIBASE_E2E_LOGIN_NAV_MS ? 4 : 2;
    const quickMs = Math.min(loginNavMs, 25_000);
    if (options?.groupSpaceId) {
        try {
            await gotoReliable(
                page,
                chatUrlWithSpace(baseUrl, options.groupSpaceId),
                {
                    waitUntil: "domcontentloaded",
                    timeout: quickMs,
                    maxAttempts: 2,
                },
            );
            await expect(
                page.getByRole("heading", { name: "Chat" }),
            ).toBeVisible({ timeout: 30_000 });
            return;
        } catch {
            // Fall through
        }
    }
    await gotoReliable(page, baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: quickMs,
        maxAttempts: 2,
    });
    try {
        await waitForLoggedInShell(page, account.name);
        return;
    } catch {
        // Session not restored via network portal
    }
    try {
        await connectExistingAccountViaUi(page, account.name, baseUrl);
        return;
    } catch {
        // No saved account in Accounts plugin
    }
    await loginExistingAccountViaUi(page, account, baseUrl);
}

/** Import an existing account key and connect (used when reopening Chat). */
export async function loginExistingAccountViaUi(
    page: Page,
    account: TestAccount,
    baseUrl = DEFAULT_HOME_URL,
): Promise<void> {
    await openLoginPrompt(page, baseUrl);

    const frame = accountsFrame(page);
    await openImportFromConnect(frame);

    await frame.getByPlaceholder("Account name").fill(account.name);
    await frame.getByPlaceholder("Private key").fill(account.privateKeyB64);
    await frame.getByRole("button", { name: "Import" }).click();

    await expect(page).toHaveURL(/\.psibase\.localhost:\d+\/?$/, {
        timeout: 60_000,
    });
    await waitForLoggedInShell(page, account.name);
}

/** Log in when the account already exists in browser storage (connect prompt). */
export async function connectExistingAccountViaUi(
    page: Page,
    accountName: string,
    baseUrl = DEFAULT_HOME_URL,
): Promise<void> {
    await openLoginPrompt(page, baseUrl);

    const frame = accountsFrame(page);
    await frame.getByRole("button", { name: accountName }).click();

    await expect(page).toHaveURL(/\.psibase\.localhost:\d+\/?$/, {
        timeout: 60_000,
    });
    await waitForLoggedInShell(page, accountName);
}
