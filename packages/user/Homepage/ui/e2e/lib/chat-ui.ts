import { expect, type Page } from "@playwright/test";

import {
    humanDiagPause,
    isHumanDiagStep,
    recordPageChurnTrace,
    readPageChurnProbe,
    type ChurnDiagConfig,
} from "./churn-diag";
import {
    cancelInFlightNavigation,
    forceLeaveChatToHome,
    gotoReliable,
    hardNavigate,
    preparePageForNavigation,
} from "./churn-navigation";

export function chatUrlForAccount(account: string, baseUrl: string): string {
    const port = new URL(
        baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    ).port;
    const host = port
        ? `${account}.psibase.localhost:${port}`
        : `${account}.psibase.localhost`;
    return `http://${host}/chat`;
}

/**
 * Chat is served from the network homepage (`baseUrl`), not per-account
 * subdomains — `https://{account}.psibase.localhost/chat` returns 404.
 * Auth/session for each browser context is already bound to the right user.
 */
export function chatUrlForPage(
    _page: Page,
    baseUrl: string,
    _account?: string,
): string {
    return baseUrl.endsWith("/") ? `${baseUrl}chat` : `${baseUrl}/chat`;
}

export function chatUrlWithSpace(
    baseUrl: string,
    spaceId: string,
    options?: { churnNoRealtime?: boolean },
): string {
    const chat = chatUrlForPage({} as Page, baseUrl);
    const url = new URL(chat);
    url.searchParams.set("space", spaceId);
    if (options?.churnNoRealtime) {
        url.searchParams.set("churnNoRealtime", "1");
    }
    return url.toString();
}

/** Read `?space=` from the Chat URL when present. */
export function groupSpaceIdFromPage(page: Page): string | undefined {
    try {
        return new URL(page.url()).searchParams.get("space") ?? undefined;
    } catch {
        return undefined;
    }
}

async function hasStaleChurnRealtime(page: Page): Promise<boolean> {
    const state = await Promise.race([
        page.evaluate(() => {
            const churnState = (
                window as Window & {
                    __chatChurnState?: () => Record<string, unknown>;
                }
            ).__chatChurnState?.();
            return churnState?.realtimeLastError ?? null;
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]).catch(() => null);
    return (
        typeof state === "string" &&
        state.includes("ws health watchdog")
    );
}

/** Last-open group space from Chat localStorage (same for all members). */
export async function readLastOpenGroupSpaceId(
    page: Page,
): Promise<string | undefined> {
    const id = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.includes("lastOpenChat")) continue;
            const value = localStorage.getItem(key);
            if (value?.startsWith("space:")) return value;
        }
        return null;
    });
    return id ?? undefined;
}

export async function openChat(
    page: Page,
    baseUrl: string,
    options?: { timeout?: number; account?: string; gotoTimeout?: number },
): Promise<void> {
    const navMs = options?.gotoTimeout ?? options?.timeout ?? 45_000;
    const url = chatUrlForPage(page, baseUrl, options?.account);
    await gotoReliable(page, url, {
        timeout: navMs,
        waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
        timeout: Math.min(navMs, 45_000),
    });
}

/** Leave Chat back to Homepage shell (simulates user exiting the Chat app). */
export async function leaveChatToHome(
    page: Page,
    baseUrl: string,
    options?: { timeout?: number },
): Promise<void> {
    const home = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const timeout = options?.timeout ?? 45_000;
    try {
        await preparePageForNavigation(page);
        await gotoReliable(page, home, {
            waitUntil: "domcontentloaded",
            timeout,
            maxAttempts: 2,
        });
    } catch {
        // Playwright goto can hang when the tab is busy with WebRTC work; assign
        // location directly and wait until we have left Chat.
        await page
            .evaluate((url) => {
                window.location.assign(url);
            }, home)
            .catch(() => {});
        await page
            .waitForURL((url) => !url.pathname.includes("/chat"), { timeout })
            .catch(() => {});
    }
}

/** Wait until Chat realtime websocket is connected (not "Reconnecting…"). */
export async function waitForChatConnected(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 120_000;
    const retry = page.getByRole("button", { name: "Retry connection" });
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await page.getByText("Connected").first().isVisible().catch(() => false)) {
            return;
        }
        if (await retry.isVisible().catch(() => false)) {
            await retry.click();
        }
        await page.waitForTimeout(2_000);
    }
    await expect(page.getByText("Connected").first()).toBeVisible({
        timeout,
    });
}

/** Hard reload Chat after mesh churn (bounded waits for stress runs). */
export async function reloadChatPage(
    page: Page,
    baseUrl: string,
    options?: {
        gotoTimeout?: number;
        connectedTimeout?: number;
        waitConnected?: boolean;
        account?: string;
    },
): Promise<void> {
    const url = chatUrlForPage(page, baseUrl, options?.account);
    const connectedTimeout = options?.connectedTimeout ?? 60_000;
    const attempts = options?.waitConnected === false ? 1 : 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
            await leaveChatToHome(page, baseUrl).catch(() => {});
            await page.waitForTimeout(1_000);
        }
        await gotoReliable(page, url, {
            waitUntil: "domcontentloaded",
            timeout: options?.gotoTimeout ?? 45_000,
        });
        await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
            timeout: 15_000,
        });
        if (options?.waitConnected === false) {
            return;
        }
        try {
            await waitForChatConnected(page, { timeout: connectedTimeout });
            return;
        } catch (err) {
            lastError = err;
            if (attempt + 1 >= attempts) break;
            await page.waitForTimeout(2_000);
        }
    }
    throw lastError;
}

function urlMatchesAssignTarget(current: string, target: string): boolean {
    try {
        const t = new URL(target);
        const c = new URL(current);
        if (c.origin !== t.origin) return false;
        if (t.pathname && c.pathname !== t.pathname) return false;
        if (
            t.searchParams.get("space") &&
            c.searchParams.get("space") !== t.searchParams.get("space")
        ) {
            return false;
        }
        // VS-2: must match churnNoRealtime or strip-to-realtime assign never completes.
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

/** Assign `url` without Playwright goto (mesh tabs can wedge on commit navigation). */
async function assignNavigate(
    page: Page,
    url: string,
    options?: { timeout?: number; skipPrepare?: boolean },
): Promise<void> {
    const timeout = options?.timeout ?? 20_000;
    if (!options?.skipPrepare) {
        await preparePageForNavigation(page);
        await cancelInFlightNavigation(page);
    }
    await recordPageChurnTrace(page, "assignNavigate:start", {
        target: url,
        current: page.url(),
    });
    await page
        .evaluate((target) => {
            window.location.assign(target);
        }, url)
        .catch(() => {});
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const current = page.url();
        if (urlMatchesAssignTarget(current, url)) {
            await recordPageChurnTrace(page, "assignNavigate:done", {
                target: url,
                current,
                elapsedMs: Date.now() - started,
            });
            return;
        }
        const churnState = await page
            .evaluate(() => {
                const w = window as Window & {
                    __chatChurnState?: () => Record<string, unknown>;
                };
                return w.__chatChurnState?.() ?? null;
            })
            .catch(() => null);
        await recordPageChurnTrace(page, "assignNavigate:poll", {
            target: url,
            current,
            churnState,
            elapsedMs: Date.now() - started,
        });
        await page.waitForTimeout(2_000);
    }
    await recordPageChurnTrace(page, "assignNavigate:timeout", {
        target: url,
        current: page.url(),
        elapsedMs: Date.now() - started,
    });
    throw new Error(
        `assignNavigate timed out after ${timeout}ms: ${page.url()} -> ${url}`,
    );
}

/**
 * Open the group thread with WebRTC enabled (strip `churnNoRealtime` when present).
 * Use before `groupSend` when the actor may have been parked without realtime (VS-2).
 */
export async function ensureGroupThreadRealtime(
    page: Page,
    baseUrl: string,
    _otherMemberAccounts: string[],
    options: {
        groupSpaceId: string;
        composerTimeout?: number;
        gotoTimeout?: number;
    },
): Promise<void> {
    if (!page.url().includes("churnNoRealtime=1")) {
        return;
    }
    const chatUrl = chatUrlWithSpace(baseUrl, options.groupSpaceId, {
        churnNoRealtime: false,
    });
    const composerMs = Math.min(options.composerTimeout ?? 30_000, 45_000);
    const navMs = options.gotoTimeout ?? 25_000;
    // Do not use about:blank or preparePageForNavigation — wedges after homeNav (VS-2).
    try {
        await assignNavigate(page, chatUrl, {
            timeout: navMs,
            skipPrepare: true,
        });
    } catch {
        await hardNavigate(page, chatUrl, {
            timeout: navMs,
            skipPrepareOnRetry: true,
        });
    }
    await page
        .waitForFunction(
            () =>
                document.querySelector('[aria-label="Message text"]') !== null,
            null,
            { timeout: composerMs },
        )
        .catch(() => {});
}

/** Focus the shared group thread during churn (deep-link when space id known). */
export async function focusChurnGroupThread(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: {
        groupSpaceId?: string;
        composerTimeout?: number;
        sidebarTimeout?: number;
        gotoTimeout?: number;
        churnNoRealtime?: boolean;
    },
): Promise<void> {
    const composerMs = Math.min(options?.composerTimeout ?? 30_000, 45_000);
    const navMs = options?.gotoTimeout ?? 20_000;
    if (options?.groupSpaceId) {
        const chatUrl = chatUrlWithSpace(baseUrl, options.groupSpaceId, {
            churnNoRealtime: options.churnNoRealtime,
        });
        const wantNoRealtime = options.churnNoRealtime === true;
        const stripNoRealtime =
            new URL(page.url()).searchParams.get("churnNoRealtime") === "1" &&
            !wantNoRealtime;
        const staleRealtime =
            !wantNoRealtime && (await hasStaleChurnRealtime(page));
        const onGroup =
            !staleRealtime &&
            page.url().includes("/chat") &&
            groupSpaceIdFromPage(page) === options.groupSpaceId &&
            new URL(page.url()).searchParams.get("churnNoRealtime") ===
                (wantNoRealtime ? "1" : null);
        if (!onGroup) {
            if (stripNoRealtime) {
                // VS-2: enable realtime for groupSend after homeNav re-enter (VS-1 path).
                await preparePageForNavigation(page);
                await hardNavigate(page, chatUrl, {
                    timeout: navMs,
                    skipPrepareOnRetry: true,
                });
            } else {
                await assignNavigate(page, "about:blank", {
                    timeout: 8_000,
                }).catch(() => {});
                await assignNavigate(page, chatUrl, { timeout: navMs });
            }
        }
        await page
            .waitForFunction(
                () =>
                    document.querySelector('[aria-label="Message text"]') !==
                    null,
                null,
                { timeout: composerMs },
            )
            .catch(async () => {
                await assignNavigate(page, chatUrl, { timeout: navMs });
                await page.waitForFunction(
                    () =>
                        document.querySelector(
                            '[aria-label="Message text"]',
                        ) !== null,
                    null,
                    { timeout: Math.min(composerMs, 30_000) },
                );
            });
        return;
    }
    await openExistingGroupChatQuick(page, baseUrl, otherMemberAccounts, {
        sidebarTimeout: options?.sidebarTimeout ?? 20_000,
        gotoTimeout: navMs,
    });
}

/**
 * Send in the group thread during random churn: minimal open, reload + full
 * open if the composer stays disabled after home/DM churn.
 */
export async function sendChurnGroupMessage(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    body: string,
    options?: {
        composerTimeout?: number;
        account?: string;
        groupSpaceId?: string;
    },
): Promise<void> {
    const composerMs = Math.min(options?.composerTimeout ?? 30_000, 30_000);
    const groupButton = groupConversationButton(page, otherMemberAccounts);

    if (options?.groupSpaceId) {
        if (await hasStaleChurnRealtime(page)) {
            const chatUrl = chatUrlWithSpace(baseUrl, options.groupSpaceId);
            console.log(
                `[churn] stale realtime before group send; refreshing ${page.url()} -> ${chatUrl}`,
            );
            await assignNavigate(page, "about:blank", { timeout: 8_000 }).catch(
                () => {},
            );
            await assignNavigate(page, chatUrl, { timeout: 20_000 });
        }
        await focusChurnGroupThread(page, baseUrl, otherMemberAccounts, {
            groupSpaceId: options.groupSpaceId,
            composerTimeout: composerMs,
        });
    } else if (!page.url().includes("/chat")) {
        const chatUrl = chatUrlForPage(page, baseUrl);
        await gotoReliable(page, chatUrl, {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
        });
        await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
            timeout: 15_000,
        });
        if (await groupButton.first().isVisible().catch(() => false)) {
            await groupButton.first().click({ timeout: 8_000 });
        } else {
            await openExistingGroupChatQuick(page, baseUrl, otherMemberAccounts, {
                sidebarTimeout: 20_000,
            });
        }
    } else if (await groupButton.first().isVisible().catch(() => false)) {
        await groupButton.first().click({ timeout: 8_000 });
    } else {
        await openExistingGroupChatQuick(page, baseUrl, otherMemberAccounts, {
            sidebarTimeout: 20_000,
        });
    }
    try {
        await sendChatMessage(page, body, { composerTimeout: composerMs });
    } catch {
        await focusChurnGroupThread(page, baseUrl, otherMemberAccounts, {
            groupSpaceId: options?.groupSpaceId,
            composerTimeout: composerMs,
            sidebarTimeout: 15_000,
            gotoTimeout: 20_000,
        });
        await sendChatMessage(page, body, { composerTimeout: composerMs });
    }
}

const DEFAULT_CHURN_HOME_DELAY_MS = 1_000;

/** Home → Chat → group thread with bounded waits for random churn. */
export async function churnHomeNav(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: {
        groupSpaceId?: string;
        diag?: ChurnDiagConfig;
        diagStepIndex?: number;
    },
): Promise<void> {
    const diag = options?.diag;
    const human =
        diag &&
        options?.diagStepIndex !== undefined &&
        isHumanDiagStep(options.diagStepIndex, diag);
    const pause = async (label: string): Promise<void> => {
        if (human && diag) await humanDiagPause(diag, label);
    };

    const homeDelayMs = Number(
        process.env.PSIBASE_E2E_CHURN_HOME_DELAY_MS ??
            String(DEFAULT_CHURN_HOME_DELAY_MS),
    );
    const navMs = 25_000;
    const home = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const chatUrl = options?.groupSpaceId
        ? chatUrlWithSpace(baseUrl, options.groupSpaceId)
        : chatUrlForPage(page, baseUrl);

    if (options?.groupSpaceId) {
        await pause("homeNav:before-leave-chat");
        await recordPageChurnTrace(page, "homeNav:leave-chat-start", {
            home,
            url: page.url(),
            humanDiag: Boolean(human),
        });
        console.log(
            `[churn-probe] before-suspend ${JSON.stringify(await readPageChurnProbe(page))}`,
        );
        try {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Page.stopLoading").catch(() => {});
            void cdp
                .send("Runtime.evaluate", {
                    expression: "window.__chatChurnSuspend?.();",
                    awaitPromise: false,
                })
                .catch(() => {});
        } catch {
            /* CDP optional */
        }
        // CDP suspend is fire-and-forget; fallback evaluate only if still not suspended (VS-1).
        await page.waitForTimeout(150);
        const probeAfterCdp = await readPageChurnProbe(page).catch(() => null);
        const suspendedAfterCdp =
            probeAfterCdp?.state &&
            typeof probeAfterCdp.state === "object" &&
            (probeAfterCdp.state as { navigationSuspended?: boolean })
                .navigationSuspended === true;
        if (!suspendedAfterCdp) {
            await page
                .evaluate(() => {
                    (
                        window as Window & { __chatChurnSuspend?: () => void }
                    ).__chatChurnSuspend?.();
                }, { timeout: 5_000 })
                .catch(() => {});
            await page.waitForTimeout(50);
        }
        console.log(
            `[churn-probe] after-suspend ${JSON.stringify(await readPageChurnProbe(page))}`,
        );
        try {
            await forceLeaveChatToHome(page, home, { timeout: navMs });
        } catch (leaveErr) {
            console.log(
                `[churn-probe] forceLeave-failed ${String(leaveErr)} ${JSON.stringify(await readPageChurnProbe(page))}`,
            );
            try {
                await hardNavigate(page, home, {
                    timeout: navMs,
                    skipPrepareOnRetry: true,
                });
            } catch {
                await assignNavigate(page, home, {
                    timeout: navMs,
                    skipPrepare: true,
                });
            }
        }
        await recordPageChurnTrace(page, "homeNav:after-leave-chat", {
            url: page.url(),
        });
        await pause("homeNav:after-leave-chat");
        if (Number.isFinite(homeDelayMs) && homeDelayMs > 0) {
            await page.waitForTimeout(Math.min(homeDelayMs, 2_000));
        }
        await pause("homeNav:before-reenter-chat");
        await recordPageChurnTrace(page, "homeNav:before-focus-group", {
            groupSpaceId: options.groupSpaceId,
        });
        await focusChurnGroupThread(page, baseUrl, otherMemberAccounts, {
            groupSpaceId: options.groupSpaceId,
            composerTimeout: 35_000,
            gotoTimeout: navMs,
            churnNoRealtime: true,
        });
        await recordPageChurnTrace(page, "homeNav:after-focus-group", {
            url: page.url(),
        });
        // Let signaling welcome/joinSession finish before the next back-to-back homeNav.
        await page.waitForTimeout(3_000);
        await pause("homeNav:after-reenter-chat");
        return;
    }
    await leaveChatToHome(page, baseUrl, { timeout: navMs });
    if (Number.isFinite(homeDelayMs) && homeDelayMs > 0) {
        await page.waitForTimeout(Math.min(homeDelayMs, 2_000));
    }
    await cancelInFlightNavigation(page);
    await hardNavigate(page, chatUrl, { timeout: navMs });
    await page
        .waitForURL((url) => url.pathname.includes("/chat"), { timeout: navMs })
        .catch(() => {});
    const composer = page.getByLabel("Message text");
    if (await composer.isVisible().catch(() => false)) {
        return;
    }
    // Objective spaces can load slowly after CDP shell churn; poll sidebar.
    await openExistingGroupChatMinimal(page, baseUrl, otherMemberAccounts, {
        sidebarTimeout: 30_000,
        gotoTimeout: navMs,
    });
}

/**
 * Open the group thread, then click the same group row again (immediate
 * re-select). Product code should no-op when the conversation is already
 * selected; this step fails fast if the UI thread is wedged.
 */
export async function churnReselectGroup(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: { groupSpaceId?: string },
): Promise<void> {
    await focusChurnGroupThread(page, baseUrl, otherMemberAccounts, {
        groupSpaceId: options?.groupSpaceId,
        composerTimeout: 30_000,
        sidebarTimeout: 20_000,
    });
    const groupButton = groupConversationButton(page, otherMemberAccounts);
    if (await groupButton.first().isVisible().catch(() => false)) {
        await groupButton.first().click({ timeout: 3_000 });
    }
}

export async function ensureContact(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    nickname?: string,
): Promise<void> {
    const contactsUrl = baseUrl.endsWith("/")
        ? `${baseUrl}contacts`
        : `${baseUrl}/contacts`;
    await page.goto(contactsUrl);
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible({
        timeout: 30_000,
    });

    const existing = page.getByText(peerAccount, { exact: false });
    if (await existing.first().isVisible().catch(() => false)) {
        return;
    }

    await page
        .locator("header")
        .filter({ has: page.getByRole("heading", { name: "Contacts" }) })
        .getByRole("button")
        .click();
    await expect(page.getByRole("heading", { name: "Create contact" })).toBeVisible();

    await page.getByPlaceholder("Account name").fill(peerAccount);
    if (nickname) {
        await page.getByPlaceholder("Johnny").fill(nickname);
    }
    await page.getByRole("button", { name: /^Submit$/ }).click();
    await expect(page.getByText(/Saved contact/i)).toBeVisible({
        timeout: 30_000,
    });
}

/** Wait until a contact/DM row shows the peer as online (presence dot title). */
export async function waitForPeerOnline(
    page: Page,
    peerAccount: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 120_000;
    const peerContainers = page.locator("div").filter({
        has: page.getByRole("button").filter({ hasText: peerAccount }),
    });
    await expect(
        peerContainers.locator('span[title="Online"]').first(),
    ).toBeVisible({ timeout });
}

/** Wait until the DM peer's data channel shows `connected`. */
export async function waitForDmDataChannelReady(
    page: Page,
    peerAccount: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 180_000;
    await expect
        .poll(
            async () => {
                return page.evaluate((peer) => {
                    const snap = (
                        window as unknown as {
                            __chatDataDebug?: {
                                snapshot?: () => {
                                    peers?: {
                                        peerAccount: string;
                                        pc: { connectionState?: string } | null;
                                    }[];
                                };
                            };
                        }
                    ).__chatDataDebug?.snapshot?.();
                    const leg = snap?.peers?.find(
                        (p) => p.peerAccount === peer,
                    );
                    return leg?.pc?.connectionState === "connected";
                }, peerAccount);
            },
            { timeout, intervals: [500, 1000, 2000] },
        )
        .toBe(true);
}

/** Wait until outbound WebRTC mesh legs to every peer show `connected`. */
export async function waitForGroupMeshReady(
    page: Page,
    peerAccounts: readonly string[],
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 180_000;
    await expect
        .poll(
            async () => {
                return page.evaluate((peers) => {
                    const snap = (
                        window as unknown as {
                            __chatDataDebug?: {
                                snapshot?: () => {
                                    peers?: {
                                        peerAccount: string;
                                        pc: { connectionState?: string } | null;
                                    }[];
                                };
                            };
                        }
                    ).__chatDataDebug?.snapshot?.();
                    if (!snap?.peers?.length) return false;
                    const connected = new Set(
                        snap.peers
                            .filter(
                                (p) => p.pc?.connectionState === "connected",
                            )
                            .map((p) => p.peerAccount),
                    );
                    return peers.every((account) => connected.has(account));
                }, [...peerAccounts]);
            },
            { timeout, intervals: [1000, 2000, 3000] },
        )
        .toBe(true);
}

/** Open a DM thread from the chat sidebar (no WebRTC / composer readiness wait). */
export async function openDmThread(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    options?: { gotoTimeout?: number },
): Promise<void> {
    const chatUrl = chatUrlForPage(page, baseUrl);
    const navMs = options?.gotoTimeout ?? 25_000;
    if (!page.url().includes("/chat")) {
        await gotoReliable(page, chatUrl, {
            timeout: navMs,
            waitUntil: "domcontentloaded",
            maxAttempts: 2,
        });
        await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
            timeout: 15_000,
        });
    }
    const dmRow = page.getByRole("button", {
        name: new RegExp(`^${peerAccount}(?:,|$)`, "i"),
    });
    if (await dmRow.first().isVisible().catch(() => false)) {
        await dmRow.first().click();
    } else {
        const contactButton = page
            .getByRole("button")
            .filter({ hasText: peerAccount })
            .last();
        await expect(contactButton).toBeVisible({ timeout: 30_000 });
        await contactButton.click();
    }
}

export async function startDmWithContact(
    page: Page,
    baseUrl: string,
    peerAccount: string,
): Promise<void> {
    await openDmThread(page, baseUrl, peerAccount);
    await waitForChatConnected(page);
    await expect(page.getByLabel("Message text")).toBeEnabled({
        timeout: 90_000,
    });
}

/**
 * Open a DM from Contacts and send immediately — reproduces first-message-before-ensureDm.
 */
/** Enabled, visible composer (avoids strict-mode collisions with hidden route stacks). */
async function activeMessageComposer(
    page: Page,
    timeoutMs: number,
): Promise<ReturnType<Page["getByLabel"]>> {
    const composer = page.getByLabel("Message text");
    await expect(composer.first()).toBeEnabled({ timeout: timeoutMs });
    return composer.locator("visible=true").and(page.locator(":enabled")).last();
}

async function clickSendBesideComposer(
    composer: ReturnType<Page["getByLabel"]>,
): Promise<void> {
    await composer
        .locator('xpath=ancestor::div[contains(@class,"items-end")][1]')
        .getByRole("button", { name: "Send" })
        .click();
}

export async function sendFirstDmBeforeSpaceReady(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    body: string,
): Promise<void> {
    await openChat(page, baseUrl);
    await waitForChatConnected(page);
    const contactButton = page
        .getByRole("button")
        .filter({ hasText: peerAccount })
        .first();
    await expect(contactButton).toBeVisible({ timeout: 30_000 });
    await contactButton.click();
    const composer = await activeMessageComposer(page, 30_000);
    await composer.fill(body);
    await clickSendBesideComposer(composer);
}

export async function sendChatMessage(
    page: Page,
    body: string,
    options?: { composerTimeout?: number },
): Promise<void> {
    const timeoutMs = options?.composerTimeout ?? 60_000;
    const composer = await activeMessageComposer(page, timeoutMs);
    await composer.fill(body);
    await clickSendBesideComposer(composer);
}

export async function expectThreadMessage(
    page: Page,
    body: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 60_000;
    const message = page.getByText(body, { exact: true });
    if (!(await message.isVisible().catch(() => false))) {
        const unreadDm = page
            .getByRole("button", { name: /new messages/i })
            .first();
        if (await unreadDm.isVisible().catch(() => false)) {
            await unreadDm.click();
        }
    }
    await expect(message).toBeVisible({ timeout });
}

export async function expectPendingOutboundMessage(
    page: Page,
    body: string,
): Promise<void> {
    await expect(page.getByText(body, { exact: true })).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByText("Pending").first()).toBeVisible({
        timeout: 15_000,
    });
}

export function groupConversationButton(
    page: Page,
    otherMemberAccounts: string[],
) {
    let button = page.getByRole("button");
    for (const account of otherMemberAccounts) {
        button = button.filter({ hasText: account });
    }
    return button;
}
export async function startGroupPickMode(page: Page, baseUrl: string): Promise<void> {
    await openChat(page, baseUrl);
    await waitForChatConnected(page);
    await page.getByRole("button", { name: "New group chat" }).click();
    await expect(
        page.getByText("Select members in Contact section below."),
    ).toBeVisible({ timeout: 15_000 });
}

/** Toggle a contact into the group candidate set (group-pick mode must be active). */
export async function includeContactInGroup(
    page: Page,
    peerAccount: string,
): Promise<void> {
    const checkbox = page.getByRole("checkbox", {
        name: new RegExp(`Include .*${peerAccount}.* in group`, "i"),
    });
    await expect(checkbox).toBeVisible({ timeout: 30_000 });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
}

/**
 * Create a new group chat with at least two other members.
 * Caller must already be on Chat with contacts loaded.
 */
export async function createGroupChat(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
): Promise<string> {
    if (otherMemberAccounts.length < 2) {
        throw new Error("createGroupChat requires at least two other members");
    }
    await startGroupPickMode(page, baseUrl);
    for (const account of otherMemberAccounts) {
        await includeContactInGroup(page, account);
    }
    await page
        .getByRole("button", {
            name: new RegExp(
                `Start group \\(${otherMemberAccounts.length} picked\\)`,
            ),
        })
        .click();
    await waitForChatConnected(page);
    const groupButton = groupConversationButton(page, otherMemberAccounts);
    await expect(groupButton.first()).toBeVisible({ timeout: 60_000 });
    await groupButton.first().click();
    await waitForChatConnected(page);
    await expect(page.getByLabel("Message text")).toBeEnabled({
        timeout: 90_000,
    });
    const spaceId =
        groupSpaceIdFromPage(page) ?? (await readLastOpenGroupSpaceId(page));
    if (!spaceId?.startsWith("space:")) {
        throw new Error("createGroupChat: could not resolve group space id");
    }
    return spaceId;
}

/**
 * Open an existing group thread from the sidebar.
 * `otherMemberAccounts` is every participant except the current user.
 */
export async function openExistingGroupChat(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: { composerTimeout?: number },
): Promise<void> {
    await openChat(page, baseUrl);
    await waitForChatConnected(page);
    const groupButton = groupConversationButton(page, otherMemberAccounts);
    await expect(groupButton.first()).toBeVisible({ timeout: 60_000 });
    await groupButton.first().click();
    await waitForChatConnected(page);
    await expect(page.getByLabel("Message text")).toBeEnabled({
        timeout: options?.composerTimeout ?? 90_000,
    });
}

/**
 * Open the group thread without waiting for composer enable (stress / churn).
 */
export async function openExistingGroupChatQuick(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: {
        sidebarTimeout?: number;
        gotoTimeout?: number;
        waitConnected?: boolean;
        clickTimeout?: number;
        /** Click even when the row is obscured (shell churn / mesh busy). */
        forceClick?: boolean;
    },
): Promise<void> {
    const chatUrl = chatUrlForPage(page, baseUrl);
    const navMs = options?.gotoTimeout ?? 25_000;
    if (!page.url().includes("/chat")) {
        await gotoReliable(page, chatUrl, {
            timeout: navMs,
            waitUntil: "domcontentloaded",
            maxAttempts: 2,
        });
        await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
            timeout: 15_000,
        });
    }
    if (options?.waitConnected) {
        await waitForChatConnected(page, { timeout: 25_000 });
    }
    const groupButton = groupConversationButton(page, otherMemberAccounts);
    await expect(groupButton.first()).toBeVisible({
        timeout: options?.sidebarTimeout ?? 60_000,
    });
    await groupButton.first().click({
        timeout: options?.clickTimeout ?? 8_000,
        force: options?.forceClick ?? false,
    });
}

/** Fail if chat-data debug ring buffer contains a not-joined WS error. */
export async function assertChatDataHealthy(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 5_000;
    await expect
        .poll(
            async () => {
                return page.evaluate(() => {
                    const events = (
                        window as unknown as {
                            __chatDataDebug?: {
                                events?: () => Array<{
                                    event: string;
                                    detail?: Record<string, unknown>;
                                }>;
                            };
                        }
                    ).__chatDataDebug?.events?.();
                    if (!events?.length) return true;
                    return !events.some((e) => {
                        const code = e.detail?.code;
                        return (
                            code === "not-joined" ||
                            (typeof e.event === "string" &&
                                e.event.includes("error") &&
                                code === "not-joined")
                        );
                    });
                });
            },
            { timeout, intervals: [500, 1000] },
        )
        .toBe(true);
}

/**
 * When sender and recipient are both online, pending content for that pair
 * must appear on the recipient thread (and sender pending leg clears).
 */
export async function assertPendingDeliveredForPair(
    senderPage: Page,
    recipientPage: Page,
    senderAccount: string,
    recipientAccount: string,
    body: string,
    options: {
        kind: "dm" | "group";
        timeout?: number;
    },
): Promise<void> {
    const timeout = options.timeout ?? 180_000;
    await waitForPeerOnline(senderPage, recipientAccount, { timeout });
    await waitForPeerOnline(recipientPage, senderAccount, { timeout });
    if (options.kind === "dm") {
        await waitForDmDataChannelReady(senderPage, recipientAccount, {
            timeout,
        });
    } else {
        await waitForGroupMeshReady(senderPage, [recipientAccount], {
            timeout,
        });
    }
    await expectThreadMessage(recipientPage, body, { timeout });
    await expectOutboundMessageDelivered(senderPage, body, { timeout });
}

/** Outbound message cleared from pending delivery state. */
export async function expectOutboundMessageDelivered(
    page: Page,
    body: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 120_000;
    const message = page.getByText(body, { exact: true });
    await expect(message).toBeVisible({ timeout });
    const row = page.locator("div").filter({ has: message });
    await expect(row.locator("span").filter({ hasText: /^Pending/ })).toHaveCount(
        0,
        { timeout },
    );
}

/**
 * Poll until a group row appears in the sidebar (objective spaces may load async).
 */
export async function waitForGroupInSidebar(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: {
        timeout?: number;
        skipConnected?: boolean;
        account?: string;
        gotoTimeout?: number;
    },
): Promise<void> {
    if (!page.url().includes("/chat")) {
        await openChat(page, baseUrl, {
            account: options?.account,
            gotoTimeout: options?.gotoTimeout,
        });
    } else {
        await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible({
            timeout: options?.gotoTimeout ?? 15_000,
        });
    }
    if (!options?.skipConnected) {
        await waitForChatConnected(page);
    }
    const groupButton = groupConversationButton(page, otherMemberAccounts);
    await expect(groupButton.first()).toBeVisible({
        timeout: options?.timeout ?? 120_000,
    });
}

/** Churn helper: open group thread without waiting for Connected/composer. */
export async function openExistingGroupChatMinimal(
    page: Page,
    baseUrl: string,
    otherMemberAccounts: string[],
    options?: {
        sidebarTimeout?: number;
        account?: string;
        gotoTimeout?: number;
    },
): Promise<void> {
    const sidebarTimeout = options?.sidebarTimeout ?? 25_000;
    const gotoTimeout = options?.gotoTimeout;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        const pollMs =
            attempt === 0 ? sidebarTimeout : sidebarTimeout + 15_000;
        try {
            if (attempt > 0 && !page.url().includes("/chat")) {
                const chatUrl = chatUrlForPage(
                    page,
                    baseUrl,
                    options?.account,
                );
                await hardNavigate(page, chatUrl, {
                    timeout: gotoTimeout ?? 25_000,
                });
            } else if (attempt > 0) {
                await page.waitForTimeout(2_000);
            }
            await waitForGroupInSidebar(page, baseUrl, otherMemberAccounts, {
                timeout: pollMs,
                skipConnected: true,
                account: options?.account,
                gotoTimeout,
            });
            const groupButton = groupConversationButton(
                page,
                otherMemberAccounts,
            );
            await groupButton.first().click({ timeout: 8_000, force: true });
            return;
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}
