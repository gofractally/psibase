import { expect, type Page } from "@playwright/test";

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
            await pin.fill(process.env.E2E_SOFTHSM_PIN ?? "Ch4ng#Me!");
        }
        await page.getByRole("button", { name: "Continue" }).click();
    }

    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("All done!")).toBeVisible({
        timeout: 180_000,
    });
}
