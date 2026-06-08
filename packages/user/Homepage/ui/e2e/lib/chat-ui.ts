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
    const connected = page.getByText("Connected").locator("visible=true").first();
    const retry = page
        .getByRole("button", { name: "Retry connection" })
        .locator("visible=true")
        .last();
    await expect
        .poll(
            async () => {
                const churnConnected = await page
                    .evaluate(() => {
                        const churn = (
                            window as Window & {
                                __chatChurnState?: () => {
                                    realtimeState?: string;
                                    realtimeReady?: boolean;
                                };
                            }
                        ).__chatChurnState?.();
                        return (
                            churn?.realtimeReady === true ||
                            churn?.realtimeState === "connected"
                        );
                    })
                    .catch(() => false);
                if (churnConnected) return true;
                if (await connected.isVisible().catch(() => false)) {
                    return true;
                }
                if (await retry.isVisible().catch(() => false)) {
                    await retry.click({ timeout: 3_000, force: true }).catch(
                        () => {},
                    );
                }
                return false;
            },
            { timeout, intervals: [500, 1000, 2000] },
        )
        .toBe(true);
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
        await waitForSelectedGroupSpace(page, options.groupSpaceId, {
            timeout: composerMs,
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

/** Kick DM pair negotiation on one peer (same transport hook as group mesh bootstrap). */
export async function bootstrapDmPeer(
    page: Page,
    peerAccount: string,
): Promise<void> {
    await bootstrapGroupMeshPeers(page, [peerAccount]);
}

/** Wait until a single DM peer leg is `usable`. */
export async function waitForDmPeerReady(
    page: Page,
    peerAccount: string,
    options?: { timeout?: number },
): Promise<void> {
    await waitForGroupMeshReady(page, [peerAccount], options);
}

/** Wait until the DM peer's data channel shows `connected`. */
export async function waitForDmDataChannelReady(
    page: Page,
    peerAccount: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 180_000;
    await bootstrapDmPeer(page, peerAccount);
    try {
        await expect
            .poll(
                async () => {
                return page.evaluate((peer) => {
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                peerState?: (remote: string) => string;
                                started?: () => boolean;
                            };
                        }
                    ).__chatTransportV2Debug;
                    if (v2?.peerState) {
                        return v2.peerState(peer) === "usable";
                    }

                    const snap = (
                            window as unknown as {
                                __chatDataDebug?: {
                                    snapshot?: () => {
                                        peers?: {
                                            peerAccount: string;
                                            pc: {
                                                connectionState?: string;
                                            } | null;
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
    } catch (e) {
        const diag = await page.evaluate((peer) => {
            const v2 = (
                window as unknown as {
                    __chatTransportV2Debug?: {
                        peerState?: (remote: string) => string;
                    };
                }
            ).__chatTransportV2Debug;
            const v2State = v2?.peerState?.(peer) ?? null;
            const snap = (
                window as unknown as {
                    __chatDataDebug?: {
                        snapshot?: () => unknown;
                        events?: () => unknown;
                    };
                }
            ).__chatDataDebug;
            return {
                peer,
                v2State,
                chatDataSnapshot: snap?.snapshot?.() ?? null,
                chatDataEvents: snap?.events?.() ?? null,
                hasV2Debug: Boolean(v2),
            };
        }, peerAccount);
        throw new Error(
            `waitForDmDataChannelReady timed out for "${peerAccount}".\n\nDiagnostics:\n${JSON.stringify(
                diag,
                null,
                2,
            )}`,
            { cause: e as Error },
        );
    }
}

/** Ensure outbound WebRTC mesh legs to every peer are scheduled (polls until transport starts). */
export async function bootstrapGroupMeshPeers(
    page: Page,
    peerAccounts: readonly string[],
): Promise<void> {
    await expect
        .poll(
            async () => {
                return page.evaluate((peers) => {
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                started?: () => boolean;
                                ensurePeers?: (remotes: string[]) => void;
                                kickPeers?: (remotes: string[]) => void;
                            };
                        }
                    ).__chatTransportV2Debug;
                    if (!v2?.started?.()) return false;
                    v2.ensurePeers?.(peers);
                    v2.kickPeers?.(peers);
                    return true;
                }, [...peerAccounts]);
            },
            { timeout: 60_000, intervals: [250, 500, 1000] },
        )
        .toBe(true);
    await page.waitForTimeout(500);
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
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                peerState?: (remote: string) => string;
                            };
                        }
                    ).__chatTransportV2Debug;
                    if (v2?.peerState) {
                        return peers.every(
                            (p: string) => v2.peerState?.(p) === "usable",
                        );
                    }

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

/** Default wait for compose-first thread UI (enabled composer) after opening a thread. */
export const THREAD_COMPOSER_READY_MS = 8_000;

/** Default wait for per-peer WebRTC mesh to reach `usable` during churn. */
export const THREAD_MESH_LIVE_MS = 8_000;

/** Compose-first UX: enabled message box means the thread surface is active. */
export async function waitForThreadComposerReady(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? THREAD_COMPOSER_READY_MS;
    await expect(page.getByLabel("Message text")).toBeEnabled({ timeout });
}

/** Poll until v2 peer legs for every account are `usable`. */
export async function waitForThreadMeshLive(
    page: Page,
    peerAccounts: readonly string[],
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? THREAD_MESH_LIVE_MS;
    await expect
        .poll(
            async () => {
                return page.evaluate((peers) => {
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                peerState?: (remote: string) => string;
                            };
                        }
                    ).__chatTransportV2Debug;
                    if (!v2?.peerState) return false;
                    return peers.every(
                        (peer) => v2.peerState!(peer) === "usable",
                    );
                }, [...peerAccounts]);
            },
            { timeout, intervals: [200, 400, 800, 1500] },
        )
        .toBe(true);
}

/** Drop group `?space=` before opening a DM so URL-sync cannot clobber selection. */
export async function stripGroupDeepLinkForDmOpen(
    page: Page,
    baseUrl: string,
    groupSpaceId: string,
    options?: { navMs?: number },
): Promise<void> {
    if (groupSpaceIdFromPage(page) !== groupSpaceId) {
        return;
    }
    const navMs = options?.navMs ?? 25_000;
    await assignNavigate(page, chatUrlForPage(page, baseUrl), {
        timeout: navMs,
    });
    await waitForThreadComposerReady(page, {
        timeout: Math.min(navMs, 15_000),
    }).catch(() => {});
}

/** Open a DM during pending flush (strip group URL first, longer nav budget). */
export async function openDmThreadForFlush(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    groupSpaceId: string,
    timeoutMs: number,
): Promise<void> {
    await stripGroupDeepLinkForDmOpen(page, baseUrl, groupSpaceId, {
        navMs: Math.min(timeoutMs, 30_000),
    });

    const listWaitMs = Math.min(timeoutMs, 30_000);
    await expect
        .poll(
            async () => {
                if (await isDmThreadActive(page, peerAccount, groupSpaceId)) {
                    return true;
                }
                return page.evaluate((peer) => {
                    const churn = (
                        window as Window & {
                            __chatChurnState?: () => {
                                conversationListSummary?: { dm?: number };
                                composePendingDmPeer?: string | null;
                                pendingDmMember?: string | null;
                            };
                        }
                    ).__chatChurnState?.();
                    return (
                        (churn?.conversationListSummary?.dm ?? 0) > 0 ||
                        churn?.composePendingDmPeer === peer ||
                        churn?.pendingDmMember === peer
                    );
                }, peerAccount);
            },
            { timeout: listWaitMs, intervals: [500, 1000, 2000] },
        )
        .toBe(true)
        .catch(() => {});

    if (await isDmThreadActive(page, peerAccount, groupSpaceId)) {
        await waitForDmThreadWithPeer(page, peerAccount, {
            timeout: Math.min(timeoutMs, 20_000),
            groupSpaceId,
        });
        return;
    }

    const openMs = Math.min(timeoutMs, 45_000);
    try {
        await openDmThread(page, baseUrl, peerAccount, {
            groupSpaceId,
            gotoTimeout: openMs,
        });
        return;
    } catch {
        /* compose-first recipient may not have a DM row yet */
    }

    await clickOpenDmTarget(page, peerAccount);
    await page.waitForTimeout(1_000);
    await pushSelectedDmUrl(
        page,
        baseUrl,
        Math.min(timeoutMs, 30_000),
        groupSpaceId,
    );
    await waitForDmThreadWithPeer(page, peerAccount, {
        timeout: timeoutMs,
        groupSpaceId,
    });
}

/** Deep-link the browser URL to match the app's selected conversation (DM sync). */
async function syncChatUrlToSelectedConversation(
    page: Page,
    baseUrl: string,
    navMs: number,
): Promise<void> {
    const spaceId = await page
        .evaluate(() => {
            const churn = (
                window as Window & {
                    __chatChurnState?: () => {
                        selectedConversationId?: string;
                        composePendingDmPeer?: string | null;
                        pendingDmMember?: string | null;
                        selectedConversationKind?: string | null;
                    };
                }
            ).__chatChurnState?.();
            if (
                churn?.composePendingDmPeer ||
                churn?.pendingDmMember
            ) {
                return null;
            }
            if (churn?.selectedConversationKind === "dm") {
                return churn.selectedConversationId ?? null;
            }
            return churn?.selectedConversationId ?? null;
        })
        .catch(() => null);
    if (!spaceId) return;

    const want = chatUrlWithSpace(baseUrl, spaceId);
    let current = "";
    try {
        current = page.url();
    } catch {
        return;
    }
    if (
        current === want ||
        groupSpaceIdFromPage(page) === spaceId
    ) {
        return;
    }

    await assignNavigate(page, want, { timeout: navMs });
    await page
        .waitForFunction(
            () =>
                document.querySelector('[aria-label="Message text"]') !== null,
            null,
            { timeout: Math.min(navMs, 20_000) },
        )
        .catch(() => {});
}

export type ChatSelectionState = {
    selectedConversationId: string | null;
    composePendingDmPeer: string | null;
    pendingDmMember: string | null;
    selectedConversationKind: string | null;
    urlSpaceId: string | null;
    threadHeader: string | null;
};

/** Read UI selection + thread header for e2e routing diagnostics. */
export async function readChatSelectionState(
    page: Page,
): Promise<ChatSelectionState> {
    return page.evaluate(() => {
        const churn = (
            window as Window & {
                __chatChurnState?: () => Record<string, unknown>;
            }
        ).__chatChurnState?.();
        const raw = new URL(location.href).searchParams.get("space");
        let urlSpaceId = raw;
        if (urlSpaceId) {
            try {
                urlSpaceId = decodeURIComponent(urlSpaceId);
            } catch {
                /* keep encoded */
            }
        }
        const threadHeader =
            document.querySelector("main p.font-medium")?.textContent?.trim() ??
            null;
        return {
            selectedConversationId:
                (churn?.selectedConversationId as string | null) ?? null,
            composePendingDmPeer:
                (churn?.composePendingDmPeer as string | null) ?? null,
            pendingDmMember:
                (churn?.pendingDmMember as string | null) ?? null,
            selectedConversationKind:
                (churn?.selectedConversationKind as string | null) ?? null,
            urlSpaceId,
            threadHeader,
        };
    });
}

/** Poll until the app selected conversation matches the canonical group space. */
export async function waitForSelectedGroupSpace(
    page: Page,
    groupSpaceId: string,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 30_000;
    await expect
        .poll(
            async () => {
                const state = await readChatSelectionState(page);
                return state.selectedConversationId === groupSpaceId;
            },
            { timeout, intervals: [200, 500, 1000] },
        )
        .toBe(true);
}

/** Poll until DM compose surface is active (compose-first: enabled composer). */
export async function waitForDmThreadWithPeer(
    page: Page,
    peerAccount: string,
    options?: { timeout?: number; groupSpaceId?: string },
): Promise<void> {
    const timeout = options?.timeout ?? THREAD_COMPOSER_READY_MS;
    await waitForThreadComposerReady(page, { timeout });
    await expect
        .poll(
            async () => {
                const state = await readChatSelectionState(page);
                if (state.composePendingDmPeer === peerAccount) return true;
                if (state.pendingDmMember === peerAccount) return true;
                if (
                    options?.groupSpaceId &&
                    state.selectedConversationId &&
                    state.selectedConversationId !== options.groupSpaceId
                ) {
                    return true;
                }
                if (
                    state.selectedConversationKind === "dm" &&
                    (state.threadHeader?.includes(peerAccount) ?? false)
                ) {
                    return true;
                }
                return false;
            },
            { timeout, intervals: [200, 500, 1000] },
        )
        .toBe(true);
}

export async function assertChatThreadHeaderContains(
    page: Page,
    text: string,
    options?: { timeout?: number },
): Promise<void> {
    const header = page.locator("main p.font-medium").first();
    await expect(header).toContainText(text, {
        timeout: options?.timeout ?? 15_000,
    });
}

/** Fail fast when a DM ledger entry was enqueued against the group space. */
export async function assertOutboundDmRouting(
    page: Page,
    body: string,
    groupSpaceId: string,
): Promise<void> {
    const routing = await page.evaluate(
        ({ body, groupSpaceId }) => {
            const v2 = (
                window as unknown as {
                    __chatTransportV2Debug?: {
                        routingSnapshot?: () => {
                            pendingRows?: {
                                bodyPreview: string;
                                conversationId: string;
                                recipientCount: number;
                            }[];
                        };
                        getOutbox?: () => {
                            body: string;
                            conversationId: string;
                            recipients: string[];
                        }[];
                    };
                }
            ).__chatTransportV2Debug;
            const snap = v2?.routingSnapshot?.() ?? null;
            const rows = (v2?.getOutbox?.() ?? []).filter((r) => r.body === body);
            const groupTail = groupSpaceId.replace(/^space:/, "");
            const onGroup = rows.some(
                (r) =>
                    r.recipients.length > 1 ||
                    r.conversationId.includes(groupTail) ||
                    r.conversationId === groupSpaceId,
            );
            return { rows, snap, onGroup };
        },
        { body, groupSpaceId },
    );
    if (routing.onGroup) {
        throw new Error(
            `DM send used group routing: ${JSON.stringify(routing)}`,
        );
    }
}

export async function resyncOnlineActorsToGroup(
    pages: {
        alice: Page;
        bob: Page | null;
        carol: Page | null;
    },
    online: Set<"alice" | "bob" | "carol">,
    baseUrl: string,
    groupSpaceId: string,
    peersFor: (who: "alice" | "bob" | "carol") => string[],
): Promise<void> {
    for (const who of ["alice", "bob", "carol"] as const) {
        if (!online.has(who)) continue;
        const page = pages[who];
        if (!page) continue;
        console.log(
            `[random-churn] resync ${who} -> group ${groupSpaceId.slice(0, 24)}…`,
        );
        await focusChurnGroupThread(page, baseUrl, peersFor(who), {
            groupSpaceId,
            churnNoRealtime: false,
            composerTimeout: 45_000,
        });
        await waitForSelectedGroupSpace(page, groupSpaceId);
    }
}

/** Expand a Chat sidebar section (Direct Messages, Contacts, …). */
async function ensureSidebarSectionExpanded(
    page: Page,
    sectionName: string,
): Promise<void> {
    const toggle = page
        .getByRole("button", { name: sectionName, exact: true })
        .locator("visible=true")
        .last();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
    }
}

function dmRowNamePattern(peerAccount: string): RegExp {
    const escaped = peerAccount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // aria-label is peer title plus optional ", N undelivered" / ", N new messages"
    return new RegExp(`\\(${escaped}\\)|^${escaped}(?:$|[,])`, "i");
}

async function isDmThreadActive(
    page: Page,
    peerAccount: string,
    groupSpaceId?: string,
): Promise<boolean> {
    const state = await readChatSelectionState(page);
    if (state.composePendingDmPeer === peerAccount) return true;
    if (state.pendingDmMember === peerAccount) return true;
    if (
        state.selectedConversationKind === "dm" &&
        (state.threadHeader?.includes(peerAccount) ?? false)
    ) {
        return true;
    }
    if (
        groupSpaceId &&
        state.selectedConversationId &&
        state.selectedConversationId !== groupSpaceId
    ) {
        return true;
    }
    return false;
}

/** Click an existing DM row, or expand Contacts and click the contact row. */
async function clickOpenDmTarget(
    page: Page,
    peerAccount: string,
): Promise<void> {
    await ensureSidebarSectionExpanded(page, "Direct Messages");
    const dmRow = page
        .getByRole("button", {
            name: dmRowNamePattern(peerAccount),
        })
        .locator("visible=true")
        .last();
    if (await dmRow.isVisible().catch(() => false)) {
        await dmRow.click();
        return;
    }

    await ensureSidebarSectionExpanded(page, "Contacts");
    const contactsToggle = page
        .getByRole("button", { name: "Contacts", exact: true })
        .locator("visible=true")
        .last();
    const contactButton = contactsToggle
        .locator("xpath=following-sibling::div[1]")
        .getByRole("button")
        .filter({ hasText: peerAccount })
        .first();
    await expect(contactButton).toBeVisible({ timeout: 30_000 });
    await contactButton.click();
}

/** Push `?space=` to match the selected DM before inbound URL-sync can re-apply group. */
async function pushSelectedDmUrl(
    page: Page,
    baseUrl: string,
    navMs: number,
    groupSpaceId?: string,
): Promise<void> {
    const spaceId = await page
        .evaluate((groupId) => {
            const churn = (
                window as Window & {
                    __chatChurnState?: () => {
                        selectedConversationId?: string | null;
                        selectedConversationKind?: string | null;
                        composePendingDmPeer?: string | null;
                        pendingDmMember?: string | null;
                    };
                }
            ).__chatChurnState?.();
            if (
                churn?.composePendingDmPeer ||
                churn?.pendingDmMember
            ) {
                return null;
            }
            if (churn?.selectedConversationKind === "dm") {
                return churn.selectedConversationId ?? null;
            }
            if (
                groupId &&
                churn?.selectedConversationId &&
                churn.selectedConversationId !== groupId
            ) {
                return churn.selectedConversationId;
            }
            return null;
        }, groupSpaceId ?? null)
        .catch(() => null);
    if (!spaceId) return;

    const want = chatUrlWithSpace(baseUrl, spaceId);
    if (page.url() === want || groupSpaceIdFromPage(page) === spaceId) {
        return;
    }
    await assignNavigate(page, want, { timeout: navMs });
}

/** Open a DM thread from the chat sidebar (no WebRTC / composer readiness wait). */
export async function openDmThread(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    options?: { gotoTimeout?: number; groupSpaceId?: string },
): Promise<void> {
    const chatUrl = chatUrlForPage(page, baseUrl);
    const navMs = options?.gotoTimeout ?? 45_000;
    if (
        await isDmThreadActive(page, peerAccount, options?.groupSpaceId)
    ) {
        await pushSelectedDmUrl(
            page,
            baseUrl,
            navMs,
            options?.groupSpaceId,
        );
        await waitForDmThreadWithPeer(page, peerAccount, {
            timeout: navMs,
            groupSpaceId: options?.groupSpaceId,
        });
        return;
    }

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

    for (let attempt = 0; attempt < 3; attempt++) {
        if (
            attempt > 0 &&
            options?.groupSpaceId &&
            groupSpaceIdFromPage(page) === options.groupSpaceId
        ) {
            await assignNavigate(page, chatUrl, { timeout: navMs });
            await waitForThreadComposerReady(page, { timeout: navMs });
        }
        await clickOpenDmTarget(page, peerAccount);
        await page.waitForTimeout(attempt === 0 ? 1_500 : 1_000);
        await pushSelectedDmUrl(
            page,
            baseUrl,
            navMs,
            options?.groupSpaceId,
        );
        if (
            await isDmThreadActive(
                page,
                peerAccount,
                options?.groupSpaceId,
            )
        ) {
            break;
        }
    }

    await waitForThreadComposerReady(page, { timeout: navMs });
    await pushSelectedDmUrl(
        page,
        baseUrl,
        navMs,
        options?.groupSpaceId,
    );
    await waitForDmThreadWithPeer(page, peerAccount, {
        timeout: navMs,
        groupSpaceId: options?.groupSpaceId,
    });
    await syncChatUrlToSelectedConversation(page, baseUrl, navMs);
    await waitForDmThreadWithPeer(page, peerAccount, {
        timeout: Math.min(navMs, 15_000),
        groupSpaceId: options?.groupSpaceId,
    });
}

export async function startDmWithContact(
    page: Page,
    baseUrl: string,
    peerAccount: string,
    options?: { groupSpaceId?: string },
): Promise<void> {
    await openDmThread(page, baseUrl, peerAccount, {
        groupSpaceId: options?.groupSpaceId,
    });
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
    await ensureSidebarSectionExpanded(page, "Contacts");
    const contactsToggle = page
        .getByRole("button", { name: "Contacts", exact: true })
        .locator("visible=true")
        .last();
    const contactButton = contactsToggle
        .locator("xpath=following-sibling::div[1]")
        .getByRole("button")
        .filter({ hasText: peerAccount })
        .first();
    await expect(contactButton).toBeVisible({ timeout: 30_000 });
    await contactButton.click();
    const composer = await activeMessageComposer(page, 30_000);
    await composer.fill(body);
    const sendButton = composer
        .locator('xpath=ancestor::div[contains(@class,"items-end")][1]')
        .getByRole("button", { name: "Send" });
    await expect(sendButton).toBeEnabled({ timeout: 5_000 });
    await sendButton.click();
}

export async function sendChatMessage(
    page: Page,
    body: string,
    options?: { composerTimeout?: number },
): Promise<void> {
    const timeoutMs = options?.composerTimeout ?? 60_000;
    const composer = await activeMessageComposer(page, timeoutMs);
    await composer.fill(body);
    const sendButton = composer
        .locator('xpath=ancestor::div[contains(@class,"items-end")][1]')
        .getByRole("button", { name: "Send" });
    await expect(sendButton).toBeEnabled({ timeout: timeoutMs });
    await sendButton.click();
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
    try {
        await expect(message).toBeVisible({ timeout });
    } catch (e) {
        const diag = await dumpChatTransportDebug(page);
        throw new Error(
            `expectThreadMessage failed for "${body}".\n\nDiagnostics:\n${JSON.stringify(
                diag,
                null,
                2,
            )}`,
            { cause: e as Error },
        );
    }
}

async function dumpChatTransportDebug(page: Page): Promise<unknown> {
    return page.evaluate(() => {
        const v2 = (
            window as unknown as {
                __chatTransportV2Debug?: Record<string, unknown>;
            }
        ).__chatTransportV2Debug;
        const msg = (
            window as unknown as {
                __chatMessagingDebug?: Record<string, unknown>;
            }
        ).__chatMessagingDebug;
        const legacy = (
            window as unknown as {
                __chatDataDebug?: { snapshot?: () => unknown; events?: () => unknown };
            }
        ).__chatDataDebug;
        return {
            v2: v2
                ? {
                      started: v2.started,
                      events: typeof v2.events === "function" ? v2.events() : null,
                      outbox:
                          typeof v2.getOutbox === "function"
                              ? v2.getOutbox()
                              : null,
                  }
                : null,
            messaging: msg
                ? {
                      events: typeof msg.events === "function" ? msg.events() : null,
                      outbox:
                          typeof msg.getOutbox === "function"
                              ? msg.getOutbox()
                              : null,
                  }
                : null,
            chatDataSnapshot: legacy?.snapshot?.() ?? null,
        };
    });
}

export async function expectPendingOutboundMessage(
    page: Page,
    body: string,
): Promise<void> {
    await expect(page.getByText(body, { exact: true })).toBeVisible({
        timeout: 15_000,
    });
    try {
        await expect(page.getByText("Pending").first()).toBeVisible({
            timeout: 5_000,
        });
        return;
    } catch {
        /* UI badge can lag behind transport outbox while recipient is offline */
    }
    await expect
        .poll(
            async () =>
                page.evaluate((msg) => {
                    const v2 = (
                        window as unknown as {
                            __chatTransportV2Debug?: {
                                getOutbox?: () => unknown;
                                deliverySnapshot?: () => {
                                    pending?: { body?: string }[];
                                };
                            };
                        }
                    ).__chatTransportV2Debug;
                    const outbox = v2?.getOutbox?.();
                    if (
                        Array.isArray(outbox) &&
                        outbox.some((e) => JSON.stringify(e).includes(msg))
                    ) {
                        return true;
                    }
                    const pending = v2?.deliverySnapshot?.()?.pending;
                    return (
                        Array.isArray(pending) &&
                        pending.some((e) => e.body === msg)
                    );
                }, body),
            { timeout: 15_000, intervals: [300, 600, 1200] },
        )
        .toBe(true);
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
 * Strip `churnNoRealtime=1` and wait for websocket Connected before delivery asserts.
 * Used when a recipient was parked without realtime (e.g. after homeNav).
 */
export async function wakeActorFromChurnNoRealtime(
    page: Page,
    baseUrl: string,
    groupSpaceId: string,
    groupPeers: string[],
    options?: { composerTimeout?: number; gotoTimeout?: number },
): Promise<void> {
    if (new URL(page.url()).searchParams.get("churnNoRealtime") !== "1") {
        return;
    }
    const composerMs = options?.composerTimeout ?? 45_000;
    await focusChurnGroupThread(page, baseUrl, groupPeers, {
        groupSpaceId,
        churnNoRealtime: false,
        composerTimeout: composerMs,
        gotoTimeout: options?.gotoTimeout ?? 25_000,
    });
    await waitForChatConnected(page, { timeout: composerMs });
}

/**
 * Re-enable realtime without deep-linking the group thread — avoids URL-sync
 * clobbering a subsequent DM sidebar selection.
 */
export async function wakeForDmInteraction(
    page: Page,
    baseUrl: string,
    options?: { composerTimeout?: number; gotoTimeout?: number },
): Promise<void> {
    if (new URL(page.url()).searchParams.get("churnNoRealtime") !== "1") {
        return;
    }
    const composerMs = options?.composerTimeout ?? 45_000;
    const navMs = options?.gotoTimeout ?? 25_000;
    const chatUrl = chatUrlForPage(page, baseUrl);
    await preparePageForNavigation(page);
    await hardNavigate(page, chatUrl, {
        timeout: navMs,
        skipPrepareOnRetry: true,
    });
    await waitForChatConnected(page, { timeout: composerMs });
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
        baseUrl: string;
        groupSpaceId?: string;
        senderGroupPeers?: string[];
        recipientGroupPeers?: string[];
    },
): Promise<void> {
    const timeout = options.timeout ?? 180_000;
    const wakeMs = Math.min(timeout, 45_000);
    if (options.groupSpaceId) {
        if (options.senderGroupPeers) {
            if (options.kind === "dm") {
                await wakeForDmInteraction(senderPage, options.baseUrl, {
                    composerTimeout: wakeMs,
                });
            } else {
                await wakeActorFromChurnNoRealtime(
                    senderPage,
                    options.baseUrl,
                    options.groupSpaceId,
                    options.senderGroupPeers,
                    { composerTimeout: wakeMs },
                );
            }
        }
        if (options.recipientGroupPeers) {
            if (options.kind === "dm") {
                await wakeForDmInteraction(recipientPage, options.baseUrl, {
                    composerTimeout: wakeMs,
                });
            } else {
                await wakeActorFromChurnNoRealtime(
                    recipientPage,
                    options.baseUrl,
                    options.groupSpaceId,
                    options.recipientGroupPeers,
                    { composerTimeout: wakeMs },
                );
            }
        }
    }
    await waitForPeerOnline(senderPage, recipientAccount, { timeout });
    await waitForPeerOnline(recipientPage, senderAccount, { timeout });
    await bootstrapGroupMeshPeers(senderPage, [recipientAccount]);
    await bootstrapGroupMeshPeers(recipientPage, [senderAccount]);
    if (options.kind === "dm") {
        if (options.groupSpaceId) {
            await openDmThreadForFlush(
                senderPage,
                options.baseUrl,
                recipientAccount,
                options.groupSpaceId,
                timeout,
            );
            await openDmThreadForFlush(
                recipientPage,
                options.baseUrl,
                senderAccount,
                options.groupSpaceId,
                timeout,
            );
        } else {
            await openDmThread(recipientPage, options.baseUrl, senderAccount);
            await openDmThread(senderPage, options.baseUrl, recipientAccount);
        }
        await waitForDmDataChannelReady(senderPage, recipientAccount, {
            timeout,
        });
        await waitForDmDataChannelReady(recipientPage, senderAccount, {
            timeout,
        });
    } else {
        await waitForGroupMeshReady(senderPage, [recipientAccount], {
            timeout,
        });
        await waitForGroupMeshReady(recipientPage, [senderAccount], {
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
