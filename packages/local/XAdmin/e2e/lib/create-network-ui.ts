import { expect, type Page } from "@playwright/test";

export const SOFTHSM_PIN = process.env.E2E_SOFTHSM_PIN ?? "Ch4ng#Me!";

async function completeSigningKeySetup(
    page: Page,
    producer: string,
): Promise<void> {
    await expect(
        page.getByText("Secure your block producer account"),
    ).toBeVisible({ timeout: 180_000 });

    const privateKey = await page.locator("input[readonly]").nth(1).inputValue();
    expect(privateKey.length).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: /do not lose this/i }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByPlaceholder("Account name").fill(producer);
    await page.getByPlaceholder("Private key").fill(privateKey);
    await page.getByRole("button", { name: "Continue" }).click();
}

export async function createNetworkThroughUi(
    page: Page,
    adminUrl: string,
    producer: string,
    templateButton: string,
): Promise<void> {
    await page.goto(`${adminUrl}/`);
    await page.getByRole("button", { name: "Create network" }).click();
    await page.getByRole("button", { name: templateButton }).click();

    await page.getByPlaceholder("Block producer name").fill(producer);
    await page.getByRole("button", { name: "Continue" }).click();

    if (templateButton !== "Development") {
        const device = page.getByRole("radio").first();
        await expect(device).toBeVisible({ timeout: 15_000 });
        await device.check();
        const pin = page.getByLabel(/pin/i);
        if (await pin.count()) {
            await pin.fill(SOFTHSM_PIN);
        }
        await page.getByRole("button", { name: "Continue" }).click();
    }

    await page.getByRole("button", { name: "Boot" }).click();

    if (templateButton !== "Development") {
        await completeSigningKeySetup(page, producer);
    }

    await expect(page.getByText("All done!")).toBeVisible({
        timeout: 180_000,
    });
}
