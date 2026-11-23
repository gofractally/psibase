import { test, expect } from "./test.mjs";

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), "unhandled browser runtime errors").toEqual(
    [],
  );
  expect(
    await page.evaluate(() => window.__unexpectedNativeCalls || []),
    "unexpected native RPC calls",
  ).toEqual([]);
});

// These browser tests use production assets. Native wallet calls are deliberately
// mocked at the Common API boundary; no test connects to a chain or spends funds.
const transfer = {
  requestId: "18446744073709551615",
  operation: "credit",
  user: "alice",
  caller: "exchange",
  counterparty: "exchange",
  amount: "184467440737.09551615",
  tokenId: 4294967295,
  symbol: "usd",
  memo: '<img src=x onerror="steal()">',
};
const tokenPath = "/tokens/plugin/web/prompt/transfer/index.html";

async function tokensFixture(page, { context = transfer, error = null } = {}) {
  await page.route("**/wallet-assets/common-lib.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
            const context = ${JSON.stringify(context)};
            const decisionError = ${JSON.stringify(error)};
            window.__nativeCalls = [];
            window.__unexpectedNativeCalls = [];
            window.__promptFinished = 0;
            export const prompt = { finished() { window.__promptFinished++; } };
            export function getSupervisor() {
                return { async functionCall(args, options) {
                    window.__nativeCalls.push(structuredClone({ args, options }));
                    if (args.service !== "tokens" || (args.plugin || "plugin") !== "plugin" || args.intf !== "transfer-admin") {
                        window.__unexpectedNativeCalls.push(args);
                        throw new Error("Unexpected native Tokens RPC");
                    }
                    if (args.method === "getContext") return JSON.stringify(context);
                    if (!["approve", "deny"].includes(args.method)) {
                        window.__unexpectedNativeCalls.push(args);
                        throw new Error("Unexpected native Tokens RPC");
                    }
                    if (decisionError) throw new Error(decisionError);
                } };
            }
        `,
    }),
  );
  await page.goto(tokenPath);
}

async function favorDemo(page) {
  await page.goto("/favor/?demo=1");
  await expect(
    page.getByRole("heading", { name: "Good to see you, dan." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay someone", exact: true }),
  ).toBeEnabled();
}

test.describe("Tokens native transfer prompt — mocked wallet boundary", () => {
  test("renders exact amounts safely and sends one-time consent", async ({
    page,
  }) => {
    await tokensFixture(page);
    await expect(page.locator("#amount")).toHaveText(transfer.amount);
    await expect(page.locator("#token")).toHaveText("4294967295");
    await expect(page.locator("#symbol")).toHaveText("USD");
    await expect(page.locator("#memo")).toHaveText(transfer.memo);
    await expect(page.locator("#memo img")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: "Authorize transfer" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__promptFinished))
      .toBe(1);
    const calls = await page.evaluate(() => window.__nativeCalls);
    expect(calls[1]).toEqual({
      args: {
        service: "tokens",
        intf: "transfer-admin",
        method: "approve",
        params: [transfer.requestId, false],
      },
      options: { enabled: false, returnPath: "/" },
    });
    await expect(
      page.getByRole("button", { name: "Authorize transfer" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
  });

  test("trust requires an explicit checkbox choice", async ({ page }) => {
    await tokensFixture(page, { context: { ...transfer, remember: true } });
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Authorize transfer" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__promptFinished))
      .toBe(1);
    expect(
      await page.evaluate(() => window.__nativeCalls[1].args.params),
    ).toEqual([transfer.requestId, true]);
  });

  test("cancel denies the reviewed request without approving or trusting", async ({
    page,
  }) => {
    await tokensFixture(page);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.__promptFinished))
      .toBe(1);
    const calls = await page.evaluate(() => window.__nativeCalls);
    expect(calls[1].args).toEqual({
      service: "tokens",
      intf: "transfer-admin",
      method: "deny",
      params: [transfer.requestId],
    });
    expect(calls.some(({ args }) => args.method === "approve")).toBe(false);
  });

  test("native rejection displays an error without finishing or retrying", async ({
    page,
  }) => {
    await tokensFixture(page, { error: "Reviewed account changed" });
    await page.getByRole("button", { name: "Authorize transfer" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Reviewed account changed",
    );
    await expect(
      page.getByRole("button", { name: "Authorize transfer" }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.__promptFinished)).toBe(0);
    expect(await page.evaluate(() => window.__nativeCalls.length)).toBe(2);
  });

  test("invalid native context cannot expose transfer controls", async ({
    page,
  }) => {
    await tokensFixture(page, { context: { ...transfer, operation: "issue" } });
    await expect(page.getByRole("alert")).toHaveText(
      "Unknown native transfer operation",
    );
    await expect(
      page.getByRole("button", { name: "Authorize transfer" }),
    ).toBeHidden();
    expect(await page.evaluate(() => window.__nativeCalls.length)).toBe(1);
  });
});

test.describe("Favor production React UI — browser-local sample mode", () => {
  test("reviews and confirms an indirect payment with exact fees and persistent balances", async ({
    page,
  }) => {
    await favorDemo(page);
    await page
      .getByRole("button", { name: "Pay someone", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("To", { exact: true }).fill("jon");
    await dialog.getByLabel("Amount", { exact: true }).fill("20");
    await dialog.getByLabel(/Note/).fill("Browser regression payment");
    await dialog
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Review your payment" }),
    ).toBeVisible();
    await expect(dialog.locator(".payment-review")).toContainText("20.00 USD");
    await expect(dialog.locator(".payment-review")).toContainText("0.03 USD");
    await expect(
      dialog.getByRole("button", {
        name: "Confirm payment · 20.03 USD",
        exact: true,
      }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Confirm payment · 20.03 USD", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toContainText(
      "Payment sent to jon.",
    );
    await page.getByRole("button", { name: "People", exact: true }).click();
    await expect(
      page.locator(".person-row").filter({ hasText: "@mike" }),
    ).toContainText("14.97 owed to you");
    await page.reload();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(
      page.getByText("Browser regression payment", { exact: true }),
    ).toBeVisible();
  });

  test("invalid amounts stay in review and do not alter balances", async ({
    page,
  }) => {
    await favorDemo(page);
    const before = await page.evaluate(() =>
      localStorage.getItem("favor-demo-v1"),
    );
    await page
      .getByRole("button", { name: "Pay someone", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("To", { exact: true }).fill("jon");
    await dialog.getByLabel("Amount", { exact: true }).fill("0.000000001");
    await dialog
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /^Confirm payment/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("favor-demo-v1")),
    ).toBe(before);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("favor-pending-payment"),
      ),
    ).toBeNull();
  });

  test("creates a private one-use request link and revokes it through the UI", async ({
    page,
  }) => {
    await favorDemo(page);
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    await page.getByLabel(/Amount in USD/).fill("5.00000001");
    await page.getByLabel(/Only this payer/).fill("mike");
    await page
      .getByRole("button", { name: "Create payment link", exact: true })
      .click();
    const link = page.getByLabel("Payment request link", { exact: true });
    await expect(link).toBeVisible();
    const url = new URL(await link.inputValue());
    expect(url.search).toBe("?demo=1");
    expect(url.hash).toMatch(/^#pay\?/);
    const fragment = new URLSearchParams(url.hash.slice(5));
    expect(fragment.get("to")).toBe("dan");
    expect(fragment.get("amount")).toBe("5.00000001");
    expect(fragment.get("request")).toMatch(/^[a-f0-9]{64}$/);
    expect(url.search).not.toContain(fragment.get("request"));
    await expect(
      page.getByRole("img", {
        name: "QR code for your one-use payment request",
      }),
    ).toBeVisible();
    await expect(page.locator(".request-row")).toContainText("For @mike");
    await expect(page.locator(".request-row")).toContainText("Open");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.locator(".request-row")).toContainText("Revoked");
    await expect(
      page.getByRole("button", { name: "Revoke", exact: true }),
    ).toHaveCount(0);
  });
  test("records an acknowledged repayment and preserves separate token balances", async ({
    page,
  }) => {
    await favorDemo(page);
    await page.getByRole("button", { name: "People", exact: true }).click();
    const mike = page.locator(".person-row").filter({ hasText: "@mike" });
    await expect(mike).toContainText("35.00 owed to you");
    await mike.locator(".person-name").click();
    await page
      .getByRole("button", { name: "Record repayment received", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Amount received in USD", { exact: true })
      .fill("5");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Confirm repayment received", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(mike).toContainText("30.00 owed to you");
    await page
      .getByRole("combobox", { name: "Currency symbol", exact: true })
      .selectOption("BTC");
    await expect(mike).toContainText("0.001 owed to you");
  });
});

test("Favor live UI connects through Host and submits the reviewed payment — mocked wallet boundary", async ({
  page,
}) => {
  await page.route("**/common/common-lib.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
            window.__nativeCalls = [];
            window.__unexpectedNativeCalls = [];
            let user = null;
            const emptyPage = { nodes: [], endCursor: null, hasNextPage: false };
            const quote = { payee: "carol", symbol: "BTC", amount: "0.00000001", fee: "0.00000001", total: "0.00000002", encodedRoute: "reviewed-private-route", expiresAt: String(Math.floor(Date.now()/1000)+60), reference: "review-reference" };
            export function getSupervisor() {
                return { async functionCall(args) {
                    window.__nativeCalls.push(structuredClone(args));
                    const key = [args.service, args.plugin || "plugin", args.intf, args.method].join("/");
                    if (key === "accounts/query/api/getCurrentUser") throw new Error("Unrecognized call: api:get-current-user");
                    if (key === "host/accounts/api/getCurrentUser") return user;
                    if (key === "host/accounts/activeApp/connectAccount") { user = "alice"; return; }
                    if (key === "favor/plugin/authorized/graphql") {
                        const query = args.params[0];
                        if (query.includes("quote(")) return JSON.stringify({ data: { quote } });
                        if (query.includes("lines(")) return JSON.stringify({ data: { lines: emptyPage } });
                        if (query.includes("requests(")) return JSON.stringify({ data: { requests: emptyPage } });
                        if (query.includes("activity(") && query.includes("settings")) return JSON.stringify({ data: { activity: emptyPage, settings: { requestOnly: false, routingReady: true, serverTime: String(Math.floor(Date.now()/1000)) } } });
                    }
                    if (key === "favor/plugin/api/pay") return;
                    window.__unexpectedNativeCalls.push(args);
                    throw new Error("Unexpected native Favor RPC: " + JSON.stringify(args));
                } };
            }
        `,
    }),
  );
  await page.goto("/favor/");
  await page
    .getByRole("button", { name: "Connect your psibase account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, alice." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pay someone", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("To", { exact: true }).fill("carol");
  await dialog.getByLabel("Amount", { exact: true }).fill("0.00000001");
  await dialog.getByLabel("Symbol", { exact: true }).fill("BTC");
  await dialog
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: "Confirm payment · 0.00000002 BTC",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(() => window.__nativeCalls);
  expect(calls.find(({ method }) => method === "connectAccount")).toEqual({
    service: "host",
    plugin: "accounts",
    intf: "activeApp",
    method: "connectAccount",
    params: [],
  });
  expect(calls.find(({ method }) => method === "pay")).toEqual({
    service: "favor",
    intf: "api",
    method: "pay",
    params: [
      "carol",
      "BTC",
      "0.00000001",
      "0.00000002",
      "reviewed-private-route",
      "review-reference",
      "",
    ],
  });
});
