import type { Page } from "@playwright/test";

import { recordPageChurnTrace } from "./churn-diag";

/** Drop an in-flight SPA navigation so the next goto is not ERR_ABORTED. */
export async function cancelInFlightNavigation(page: Page): Promise<void> {
    await page
        .goto("about:blank", { waitUntil: "commit", timeout: 8_000 })
        .catch(() => {});
}

/**
 * Navigate without relying on a responsive renderer (mesh churn can block
 * `page.evaluate`). Uses CDP `Page.navigate` first, then Playwright goto.
 */
function urlMatchesTarget(current: string, target: string): boolean {
    try {
        const c = new URL(current);
        const t = new URL(target);
        if (c.origin !== t.origin) return false;
        if (t.pathname && c.pathname !== t.pathname) return false;
        const space = t.searchParams.get("space");
        if (space && c.searchParams.get("space") !== space) return false;
        if (
            (t.searchParams.get("churnNoRealtime") ?? null) !==
            (c.searchParams.get("churnNoRealtime") ?? null)
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function fireCdpNavigation(
    page: Page,
    url: string,
): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.stopLoading").catch(() => {});
    void cdp.send("Page.navigate", { url }).catch(() => {});
    void cdp
        .send("Runtime.evaluate", {
            expression: `window.location.assign(${JSON.stringify(url)})`,
            awaitPromise: false,
        })
        .catch(() => {});
}

/** Poll until URL matches or timeout (does not use waitForURL — safer when renderer is wedged). */
async function pollUrlUntil(
    page: Page,
    predicate: (href: string) => boolean,
    timeoutMs: number,
): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate(page.url())) return true;
        await page.waitForTimeout(200);
    }
    return predicate(page.url());
}

/**
 * Leave /chat when the SPA router may be wedged: about:blank escape, then home.
 * Does not call window.stop() or synchronous renderer teardown.
 */
export async function forceLeaveChatToHome(
    page: Page,
    home: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 25_000;
    const blank = "about:blank";
    await recordPageChurnTrace(page, "forceLeaveChat:start", {
        url: page.url(),
        home,
    });

    if (!page.url().includes("/chat")) {
        if (urlMatchesTarget(page.url(), home)) return;
        await fireCdpNavigation(page, home);
        const ok = await pollUrlUntil(
            page,
            (href) => urlMatchesTarget(href, home),
            timeout,
        );
        if (!ok) {
            throw new Error(
                `forceLeaveChatToHome: not on chat but home nav failed ${page.url()} -> ${home}`,
            );
        }
        return;
    }

    await fireCdpNavigation(page, blank);
    const leftChat = await pollUrlUntil(
        page,
        (href) => href === blank || !href.includes("/chat"),
        Math.min(timeout, 12_000),
    );
    await recordPageChurnTrace(page, "forceLeaveChat:after-blank", {
        url: page.url(),
        leftChat,
    });
    if (!leftChat) {
        throw new Error(
            `forceLeaveChatToHome: stuck on chat after about:blank (${page.url()})`,
        );
    }

    await fireCdpNavigation(page, home);
    const atHome = await pollUrlUntil(
        page,
        (href) => urlMatchesTarget(href, home),
        timeout,
    );
    await recordPageChurnTrace(page, "forceLeaveChat:after-home", {
        url: page.url(),
        atHome,
    });
    if (!atHome) {
        throw new Error(
            `forceLeaveChatToHome: home nav failed ${page.url()} -> ${home}`,
        );
    }
}

export async function hardNavigate(
    page: Page,
    url: string,
    options?: { timeout?: number; skipPrepareOnRetry?: boolean },
): Promise<void> {
    const timeout = options?.timeout ?? 15_000;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0 && !options?.skipPrepareOnRetry) {
            await preparePageForNavigation(page);
        }
        try {
            const cdp = await page.context().newCDPSession(page);
            // Fire-and-forget: awaiting CDP navigate can wedge when the renderer is
            // busy with WebRTC teardown; poll URL from Playwright instead.
            void cdp.send("Page.navigate", { url }).catch(() => {});
            await page
                .waitForURL((u) => urlMatchesTarget(u.href, url), { timeout })
                .catch(() => {});
            if (urlMatchesTarget(page.url(), url)) {
                return;
            }
            await page.waitForLoadState("commit", { timeout }).catch(() => {});
            if (urlMatchesTarget(page.url(), url)) {
                return;
            }
            throw new Error("CDP navigate did not reach target URL");
        } catch (err) {
            lastError = err;
        }
    }
    if (!options?.skipPrepareOnRetry) {
        try {
            await gotoReliable(page, url, {
                timeout,
                waitUntil: "commit",
                maxAttempts: 2,
            });
            return;
        } catch (err) {
            throw lastError ?? err;
        }
    }
    throw lastError ?? new Error(`hardNavigate failed for ${url}`);
}

/** Stop hung SPA routers / fetch before a hard navigation (churn homeNav). */
export async function preparePageForNavigation(
    page: Page,
    traceLabel = "prepare-nav",
): Promise<void> {
    await recordPageChurnTrace(page, `${traceLabel}:before-stop`, {
        url: page.url(),
    });
    const skipStop = process.env.PSIBASE_E2E_SKIP_WINDOW_STOP === "1";
    const teardownExpr = skipStop
        ? "window.__chatChurnTeardown?.();"
        : "window.stop(); window.__chatChurnTeardown?.();";
    try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Page.stopLoading").catch(() => {});
        await Promise.race([
            cdp.send("Runtime.evaluate", {
                expression: teardownExpr,
                awaitPromise: false,
            }),
            page.waitForTimeout(3_000),
        ]);
    } catch {
        await page
            .evaluate((noStop: boolean) => {
                if (!noStop) window.stop();
                (
                    window as Window & { __chatChurnTeardown?: () => void }
                ).__chatChurnTeardown?.();
            }, skipStop, { timeout: 3_000 })
            .catch(() => {});
    }
    await recordPageChurnTrace(page, `${traceLabel}:after-teardown`, {
        url: page.url(),
    });
    await cancelInFlightNavigation(page);
    await recordPageChurnTrace(page, `${traceLabel}:after-cancel`, {
        url: page.url(),
    });
}

/**
 * Playwright navigation with cancel + retry for churn (aborted loads,
 * overlapping gotos from home/chat/DM steps).
 */
export async function gotoReliable(
    page: Page,
    url: string,
    options?: {
        timeout?: number;
        waitUntil?: "commit" | "domcontentloaded";
        /** Keep total nav under per-step budgets (default 2 × ~25s). */
        maxAttempts?: number;
    },
): Promise<void> {
    const timeout = options?.timeout ?? 25_000;
    const waitUntil = options?.waitUntil ?? "commit";
    const maxAttempts = options?.maxAttempts ?? 2;
    let lastError: unknown;
    const target = new URL(url);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
            await preparePageForNavigation(page);
            await page.waitForTimeout(400);
        }
        try {
            const current = page.url();
            let currentUrl: URL | undefined;
            try {
                currentUrl = new URL(current);
            } catch {
                currentUrl = undefined;
            }
            if (
                attempt > 0 &&
                currentUrl &&
                currentUrl.origin === target.origin &&
                current !== "about:blank"
            ) {
                await page.reload({ waitUntil, timeout });
            } else {
                await page.goto(url, { waitUntil, timeout });
            }
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
    throw lastError;
}
