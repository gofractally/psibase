import { test, expect } from "../fixtures/chain";

test.describe("e2e chain fixture", () => {
    test("global-setup booted a chain reachable from the browser", async ({
        chain,
        alicePage,
    }) => {
        expect(chain.baseUrl).toMatch(/^http:\/\//);
        const response = await alicePage.goto(chain.baseUrl, {
            waitUntil: "domcontentloaded",
        });
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });
});
