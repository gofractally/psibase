import type { Page } from "@playwright/test";

import { gotoReliable } from "./churn-navigation";

/**
 * Wiping the chain restarts psinode and deletes chain state on disk; the Playwright
 * browser context (cookies, localStorage, account subdomain session) is unchanged.
 * Call before each iteration so Alice is not still bound to the previous chain's auth.
 */
export async function resetPageForFreshChain(
    page: Page,
    baseUrl: string,
): Promise<void> {
    await page.context().clearCookies();
    const navMs = Number(process.env.PSIBASE_E2E_LOGIN_NAV_MS ?? 60_000);
    await gotoReliable(page, baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: Number.isFinite(navMs) ? navMs : 60_000,
        maxAttempts: 3,
    });
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
}
