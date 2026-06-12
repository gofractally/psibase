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

/** Status badge in CallView (Ringing / Connected / Ended), not lastFrame detail text. */
function meetStatusBadge(page: Page, status: "Ringing" | "Connected" | "Ended") {
    return meetCallSection(page)
        .locator("span.rounded-full")
        .filter({ hasText: new RegExp(`^${status}$`) });
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
                return (await meetStatusBadge(page, "Ended").count()) > 0;
            },
            { timeout },
        )
        .toBe(true);
}

export async function leaveMeetCall(page: Page): Promise<void> {
    const section = meetCallSection(page);
    await expect(section).toBeVisible({ timeout: 60_000 });
    const leaveButton = section.getByRole("button", {
        name: /Leave call|Cancel call/,
    });
    await expect(leaveButton.first()).toBeVisible({ timeout: 60_000 });
    await leaveButton.first().click();
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

export async function expectMeetNotConnecting(
    page: Page,
    options?: { timeout?: number },
): Promise<void> {
    const section = meetCallSection(page);
    await expect(section.getByText("Connecting…")).toHaveCount(0, {
        timeout: options?.timeout ?? 30_000,
    });
}
