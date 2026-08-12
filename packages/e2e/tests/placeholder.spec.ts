const { expect, test } = require("@playwright/test");

test("placeholder loads a data URL", async ({ page }) => {
    await page.goto("data:text/html,<h1>psibase e2e</h1>");
    await expect(page.locator("h1")).toHaveText("psibase e2e");
});
