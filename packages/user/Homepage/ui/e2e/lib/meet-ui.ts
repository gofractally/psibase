import { expect, type Page } from "@playwright/test";

const INCOMING_DIALOG = "Incoming Meet call";

const FSM_IGNORED_PATTERNS = [
    "mediaConnected without session",
    "joinedSignaling unexpected phase",
] as const;

function meetCallSection(page: Page) {
    return page.locator("section").filter({
        hasText: "Meet (av-call)",
    });
}

/** Call-level status badge in CallView header (not participant tile/chip badges). */
function meetCallHeaderStatusBadge(
    page: Page,
    status: "Ringing" | "Connected" | "Ended",
) {
    return meetCallSection(page)
        .locator("span.rounded-full.px-2.py-0\\.5.text-xs.font-medium")
        .filter({ hasText: new RegExp(`^${status}$`) });
}

function meetGroupParticipantRingingTiles(page: Page) {
    return meetCallSection(page)
        .locator("span.rounded-full.text-\\[10px\\].font-medium")
        .filter({ hasText: /^Ringing$/ });
}

async function isMeetOutboundRinging(page: Page): Promise<boolean> {
    const headerRinging = meetCallHeaderStatusBadge(page, "Ringing");
    if ((await headerRinging.count()) === 1) {
        return headerRinging.isVisible();
    }
    // Group re-start may show Connected in the header while remotes are still ringing in the grid.
    if (!(await meetCallHeaderStatusBadge(page, "Connected").isVisible())) {
        return false;
    }
    return (await meetGroupParticipantRingingTiles(page).count()) > 0;
}

export function installMeetFsmGuard(page: Page, who: string): void {
    page.on("console", (msg) => {
        const text = msg.text();
        if (!text.includes("[av-call] av-call run event ignored")) return;
        for (const pattern of FSM_IGNORED_PATTERNS) {
            if (text.includes(pattern)) {
                throw new Error(
                    `[${who}] Meet FSM ignored event: ${text.slice(0, 400)}`,
                );
            }
        }
    });
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

/** Incoming ring dialog, or already in a connected group call (e.g. fast mesh re-start). */
export async function waitForIncomingMeetRingOrConnected(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 90_000;
    await expect
        .poll(
            async () => {
                if (
                    await page
                        .getByRole("dialog", { name: INCOMING_DIALOG })
                        .isVisible()
                        .catch(() => false)
                ) {
                    return true;
                }
                return meetCallHeaderStatusBadge(page, "Connected")
                    .isVisible()
                    .catch(() => false);
            },
            { timeout },
        )
        .toBe(true);
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
    const timeout = options?.timeout ?? 180_000;
    if (status === "Ringing") {
        await expect
            .poll(async () => isMeetOutboundRinging(page), { timeout })
            .toBe(true);
        return;
    }
    await expect(meetCallHeaderStatusBadge(page, status)).toBeVisible({
        timeout,
    });
}

export async function waitForMeetFullyConnected(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 180_000;
    await waitForMeetCallStatus(page, "Connected", { timeout });
    const section = meetCallSection(page);
    await expect(section.getByText("Connecting…")).toHaveCount(0, {
        timeout,
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
                return (
                    (await meetCallHeaderStatusBadge(page, "Ended").count()) > 0
                );
            },
            { timeout },
        )
        .toBe(true);
}

export async function leaveMeetCall(page: Page): Promise<void> {
    await page.bringToFront();
    const section = meetCallSection(page);
    await expect(section).toBeVisible({ timeout: 60_000 });
    const leaveButton = section
        .getByRole("button", { name: /Leave call|Cancel call/ })
        .first();
    await expect(leaveButton).toBeVisible({ timeout: 10_000 });
    await leaveButton.click({ force: true });
    await waitForMeetCallPanelHidden(page);
}

/** After leaving, the in-call Connected panel should dismiss (rejoin banner may show). */
export async function waitForMeetCallPanelHidden(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const timeout = options?.timeout ?? 30_000;
    await expect
        .poll(
            async () => {
                if (
                    await page
                        .getByText("Meet call in progress")
                        .isVisible()
                        .catch(() => false)
                ) {
                    return true;
                }
                if ((await meetCallSection(page).count()) === 0) return true;
                return !(await meetCallHeaderStatusBadge(page, "Connected")
                    .isVisible()
                    .catch(() => false));
            },
            { timeout },
        )
        .toBe(true);
}

/** @deprecated use leaveMeetCall */
export const endMeetCall = leaveMeetCall;

export async function waitForGroupMeetRejoinBanner(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    await expect(page.getByText("Meet call in progress")).toBeVisible({
        timeout: options?.timeout ?? 60_000,
    });
    await expect(
        page.getByRole("button", { name: "Rejoin" }),
    ).toBeVisible({ timeout: options?.timeout ?? 60_000 });
}

export async function clickRejoinGroupMeet(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Rejoin" }).click();
}

/** Best-effort: fake media devices should surface at least minCount <video> in-call. */
export async function waitForMeetVideoElements(
    page: Page,
    minCount: number,
    options?: { timeout?: number },
): Promise<void> {
    await expect
        .poll(async () => meetCallSection(page).locator("video").count(), {
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

export async function expectMeetNotConnecting(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const section = meetCallSection(page);
    await expect(section.getByText("Connecting…")).toHaveCount(0, {
        timeout: options?.timeout ?? 30_000,
    });
}
