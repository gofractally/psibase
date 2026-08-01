import type { Page } from "@playwright/test";

/**
 * Playwright navigation with cancel + retry for aborted loads / overlapping
 * gotos. PR3-minimal: no mesh-churn CDP / `__chatChurnTeardown` paths.
 */
export async function gotoReliable(
    page: Page,
    url: string,
    options?: {
        timeout?: number;
        waitUntil?: "commit" | "domcontentloaded";
        maxAttempts?: number;
    },
): Promise<void> {
    const timeout = options?.timeout ?? 25_000;
    const waitUntil = options?.waitUntil ?? "commit";
    const maxAttempts = options?.maxAttempts ?? 2;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
            await page
                .goto("about:blank", { waitUntil: "commit", timeout: 8_000 })
                .catch(() => {});
            await page.waitForTimeout(400);
        }
        try {
            await page.goto(url, { waitUntil, timeout });
            return;
        } catch (err) {
            lastError = err;
            const msg = String(err);
            const retryable =
                msg.includes("ERR_ABORTED") ||
                msg.includes("Timeout") ||
                msg.includes("net::");
            if (!retryable || attempt === maxAttempts - 1) break;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`gotoReliable failed for ${url}: ${String(lastError)}`);
}
