import type { Page } from "@playwright/test";

import { test as chainTest } from "../fixtures/chain";

import { bestEffortMeetTeardown } from "./meet-cleanup";

const trackedPages = new Set<Page>();

/** Register a browser page for Meet teardown after the spec finishes. */
export function trackMeetPage(page: Page): void {
    trackedPages.add(page);
}

/**
 * Tear down Meet UI on every page the spec used. Call from `finally` before
 * closing browser contexts so leaveSession runs while pages are still open.
 */
export async function meetSpecTeardownBeforeClose(
    pages: readonly Page[],
): Promise<void> {
    for (const page of pages) {
        trackedPages.delete(page);
    }
    await bestEffortMeetTeardown(pages);
}

/**
 * Install afterEach cleanup for Meet e2e specs on the shared chain fixture.
 * Prefer meetSpecTeardownBeforeClose in `finally` for pages closed there;
 * afterEach catches tracked pages (e.g. alice fixture) if `finally` did not run.
 */
export function installMeetSpecCleanup(test: typeof chainTest): void {
    test.afterEach(async () => {
        const pages = [...trackedPages];
        trackedPages.clear();
        await bestEffortMeetTeardown(pages);
    });
}
