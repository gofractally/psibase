import type { Page } from "@playwright/test";

const INCOMING_DIALOG = "Incoming Meet call";

function meetCallSection(page: Page) {
    return page.locator("section").filter({
        hasText: "Meet (av-call)",
    });
}

/** Best-effort: decline an incoming Meet ring if the dialog is open. */
export async function bestEffortDismissIncomingMeet(
    page: Page,
): Promise<void> {
    if (page.isClosed()) return;
    const dialog = page.getByRole("dialog", { name: INCOMING_DIALOG });
    if ((await dialog.count()) === 0) return;
    const decline = dialog.getByRole("button", { name: "Decline" });
    if ((await decline.count()) === 0) return;
    await decline.first().click({ timeout: 5_000 }).catch(() => {});
}

/** Best-effort: hang up or cancel an in-progress Meet call UI. */
export async function bestEffortEndActiveMeet(page: Page): Promise<void> {
    if (page.isClosed()) return;
    const section = meetCallSection(page);
    if ((await section.count()) === 0) return;
    const endButton = section.getByRole("button", {
        name: /Leave call|Cancel call/,
    });
    if ((await endButton.count()) === 0) return;
    await endButton.first().click({ timeout: 5_000 }).catch(() => {});
}

/**
 * Tear down Meet UI on every page used by a spec so the shared chain does not
 * inherit stale rings or in-call panels from a prior spec.
 */
export async function bestEffortMeetTeardown(
    pages: readonly Page[],
): Promise<void> {
    for (const page of pages) {
        try {
            await bestEffortDismissIncomingMeet(page);
            await bestEffortEndActiveMeet(page);
        } catch {
            // Best-effort only — spec afterEach must not mask the real failure.
        }
    }
}
