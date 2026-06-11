import { expect, type Page } from "@playwright/test";

const INCOMING_DIALOG = "Incoming Meet call";

function meetCallSection(page: Page) {
    return page.locator("section").filter({
        hasText: "Meet (av-call)",
    });
}

/** Status badge in CallView (Ringing / Connected / Ended), not lastFrame detail text. */
function meetStatusBadge(page: Page, status: "Ringing" | "Connected" | "Ended") {
    return meetCallSection(page)
        .locator("span.rounded-full")
        .filter({ hasText: new RegExp(`^${status}$`) });
}

export async function clickStartMeet(page: Page): Promise<void> {
    const meetButton = page.getByRole("button", { name: "Meet" });
    await expect(meetButton).toBeVisible({ timeout: 30_000 });
    await meetButton.click();
}

export async function waitForIncomingMeetRing(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    await expect(
        page.getByRole("dialog", { name: INCOMING_DIALOG }),
    ).toBeVisible({ timeout: options?.timeout ?? 90_000 });
}

export async function acceptIncomingMeet(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog", { name: INCOMING_DIALOG });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await dialog.getByRole("button", { name: "Accept" }).click();
}

export async function declineIncomingMeet(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog", { name: INCOMING_DIALOG });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await dialog.getByRole("button", { name: "Decline" }).click();
}

/** Outgoing ring or in-call Connected badge in CallView. */
export async function waitForMeetCallStatus(
    page: Page,
    status: "Ringing" | "Connected",
    options?: { timeout?: number },
): Promise<void> {
    await expect(meetStatusBadge(page, status)).toBeVisible({
        timeout: options?.timeout ?? 180_000,
    });
}

export async function waitForMeetEnded(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 120_000;
    await expect
        .poll(
            async () => {
                const callSection = meetCallSection(page);
                if ((await callSection.count()) === 0) return true;
                return (await meetStatusBadge(page, "Ended").count()) > 0;
            },
            { timeout },
        )
        .toBe(true);
}

export async function endMeetCall(page: Page): Promise<void> {
    const section = meetCallSection(page);
    await expect(section).toBeVisible({ timeout: 60_000 });
    const endButton = section.getByRole("button", {
        name: /End call|Cancel call/,
    });
    await expect(endButton.first()).toBeVisible({ timeout: 60_000 });
    await endButton.first().click();
}

/** Best-effort: fake media devices should surface at least one <video> in-call. */
export async function waitForMeetVideoElements(
    page: Page,
    minCount: number,
    options?: { timeout?: number },
): Promise<void> {
    await expect
        .poll(async () => page.locator("video").count(), {
            timeout: options?.timeout ?? 180_000,
        })
        .toBeGreaterThanOrEqual(minCount);
}

export async function expectNoIncomingMeetRing(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    await expect(
        page.getByRole("dialog", { name: INCOMING_DIALOG }),
    ).toBeHidden({ timeout: options?.timeout ?? 5_000 });
}
