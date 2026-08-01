import { type Page, expect } from "@playwright/test";

import { gotoReliable } from "./navigation";

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
