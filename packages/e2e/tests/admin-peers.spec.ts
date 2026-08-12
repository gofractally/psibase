import { expect, test } from "../fixtures/admin-browser";

test("admin peers page loads over non-loopback without console errors", async ({
    startPsinode,
    bootChain,
    openAdmin,
    browser,
}) => {
    const producer = "prod";
    const node = await startPsinode({ nodeIndex: 0, producer });
    await bootChain({ socketPath: node.socketPath, producer });

    const adminUrl = `http://x-admin.psibase.localhost:${node.port}`;
    const { page, errors } = await openAdmin(node);
    const response = await page.goto(`${adminUrl}/#/peers`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Psibase Admin Panel");
    await expect(
        page.getByRole("heading", { name: "No connections" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    errors.assertEmpty();

    // Same browser (same host-resolver-rules) without Basic credentials — proves
    // the connection is non-loopback and isAdminSocket does not short-circuit.
    // Issue the probe as a same-origin fetch from a page on the admin host so a
    // bare 401 (no ACAO) is visible to the page rather than CORS-blocked.
    const anon = await browser.newContext();
    try {
        const anonPage = await anon.newPage();
        await anonPage.goto(`${adminUrl}/`);
        const status = await anonPage.evaluate(async () => {
            const res = await fetch("/native/admin/status");
            return res.status;
        });
        expect(status).toBe(401);
    } finally {
        await anon.close();
    }
});
