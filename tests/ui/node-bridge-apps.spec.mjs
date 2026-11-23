import { test, expect } from "./test.mjs";
import { appUrl, sharedNative } from "./shared-native.mjs";

// Production bundles with explicit read-only service fixtures. No fixture
// authorizes a chain transaction, node configuration change, or Bitcoin write.
async function jsonRoute(page, url, data, method = "GET") {
  await page.route(url, (route) => {
    expect(route.request().method()).toBe(method);
    return route.fulfill({ json: data });
  });
}

test("BTC Bridge loads current Host wallet API, disables guest spending, and browses public reserves", async ({
  page,
}) => {
  const native = await sharedNative(page);
  const timestamp = 1700000000;
  const timeHex = Buffer.alloc(4);
  timeHex.writeUInt32LE(timestamp);
  const snapshot = {
    config: { token: 3, reserve: 100000000, paused: false },
    policy: {
      network: "regtest",
      xpubs: [],
      min_deposit: 1000,
      service_fee: 100,
      batch_seconds: 60,
      batch_size: 10,
    },
    relay: {
      height: 100,
      required: 7,
      paused: false,
      checkpoint: "0".repeat(64),
    },
    tip_header: {
      raw: "0".repeat(136) + timeHex.toString("hex") + "0".repeat(16),
    },
    now: timestamp + 5,
    block_num: 123,
    commit_num: 122,
    token: { issued_supply: { value: 100000000 }, burned_supply: { value: 0 } },
    addresses: [],
    batches: [],
    revisions: [],
    deposit_fee_terms: { fee_bps: 25, publisher_bps: 1000 },
  };
  await jsonRoute(page, appUrl("btcbridge", "/config.json"), {});
  await jsonRoute(page, appUrl("btcbridge", "/snapshot*"), snapshot);
  await jsonRoute(page, appUrl("btcbridge", "/explorer/batches?*"), {
    rows: [],
    next: null,
  });
  await jsonRoute(page, appUrl("btcbridge", "/explorer/utxos?*"), {
    rows: [
      {
        utxo: {
          txid: "a".repeat(64),
          vout: 0,
          value: 100000000,
          status: 0,
          branch: 0,
          index: 0,
          height: 100,
          block: "b".repeat(64),
        },
        address: null,
      },
    ],
    next: null,
  });
  await page.goto(appUrl("btcbridge"));
  await expect(
    page.getByRole("heading", { name: "Deposit. Use. Withdraw." }),
  ).toBeVisible();
  await expect(page.locator("#network")).toHaveText("REGTEST · TEST BTC");
  await expect(page.locator("#updated")).toContainText("Psibase block 123");
  await expect
    .poll(
      () =>
        native.calls.filter((call) => call.method === "getCurrentUser").length,
    )
    .toBeGreaterThan(0);
  expect(
    native.calls.find((call) => call.method === "getCurrentUser"),
  ).toMatchObject({ service: "host", plugin: "accounts", intf: "api" });
  await expect(
    page.getByRole("button", {
      name: "Connect account to deposit",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Withdraw", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Withdraw to Bitcoin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request withdrawal", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect
    .poll(() =>
      native.calls.some(
        (call) =>
          call.service === "host" &&
          call.plugin === "accounts" &&
          call.intf === "activeApp" &&
          call.method === "connectAccount",
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Explorer", exact: true }).click();
  await expect(page.locator("#explorer-results")).toContainText(
    "No pending transactions",
  );
  await page.getByRole("link", { name: "UTXOs", exact: true }).click();
  await expect(page.locator("#explorer-results")).toContainText(
    "1.00000000 BTC",
  );
  await expect(page.locator("#explorer-results")).toContainText("Available");
  await expect(page.locator("#relay-status")).toHaveText("Synchronized");
  expect(native.calls.some((call) => call.method === "submit")).toBe(false);
  await native.clean();
});

test("XAdmin dashboard renders native memory and transaction data without node writes", async ({
  page,
}) => {
  const native = await sharedNative(page);
  await jsonRoute(page, appUrl("x-admin", "/native/admin/status"), []);
  await jsonRoute(page, appUrl("x-admin", "/config"), {
    p2p: true,
    peers: [],
    pkcs11_modules: [],
    tls: { certificate: "", key: "", trustfiles: [] },
    producer: "",
    hosts: ["localhost"],
    listen: [],
    loggers: {},
  });
  await jsonRoute(page, appUrl("x-admin", "/native/admin/keys/devices"), []);
  await jsonRoute(page, appUrl("x-admin", "/native/admin/keys"), []);
  await jsonRoute(page, appUrl("x-admin", "/admin_login"), {
    access_token: "isolated-admin-fixture",
    token_type: "bearer",
  });
  await jsonRoute(page, appUrl("x-admin", "/native/admin/perf"), {
    timestamp: "2026-11-23T00:00:00Z",
    memory: {
      database: 1048576,
      databaseAttribution: "file-backed",
      code: 1048576,
      data: 0,
      wasmMemory: 0,
      wasmCode: 0,
      unclassified: 0,
    },
    tasks: [],
  });
  await jsonRoute(page, appUrl("transact", "/stats"), {
    unprocessed: 2,
    total: 15,
    failed: 1,
    succeeded: 11,
    expired: 1,
  });
  await jsonRoute(
    page,
    appUrl("x-peers", "/graphql"),
    { data: { peers: { edges: [] } } },
    "POST",
  );
  await page.goto(appUrl("x-admin"));
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("RAM usage", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Counts reported by the transact service.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Succeeded", { exact: true }).locator(".."),
  ).toContainText("11");
  await expect(
    page.getByText("Failed", { exact: true }).locator(".."),
  ).toContainText("1");
  await expect(
    page.getByRole("link", { name: "Peers", exact: true }),
  ).toBeVisible();
  await native.clean();
});

test("XProxy loads configured origins and edits an unsaved row entirely in the browser", async ({
  page,
}) => {
  const native = await sharedNative(page);
  await page.route(appUrl("x-proxy", "/graphql"), (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON().query).toContain("originServers");
    return route.fulfill({
      json: {
        data: {
          originServers: [
            {
              subdomain: "tokens",
              host: "example.org:9000/path",
              tls: {},
              bypassPrefixes: ["/common", "/plugin.wasm"],
            },
          ],
        },
      },
    });
  });
  await page.goto(appUrl("x-proxy"));
  await expect(
    page.getByRole("heading", { name: "Reverse proxy", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue(
    "tokens",
  );
  await expect(page.getByLabel("Subdomain", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Upstream host", { exact: true })).toHaveValue(
    "example.org:9000",
  );
  await page.getByRole("button", { name: "Add origin", exact: true }).click();
  await page.getByLabel("Subdomain", { exact: true }).nth(1).fill("prices");
  await page
    .getByLabel("Upstream host", { exact: true })
    .nth(1)
    .fill("localhost:9001");
  await page
    .getByPlaceholder("/path-prefix", { exact: true })
    .nth(1)
    .fill("rpc");
  await page
    .getByRole("button", { name: "Add path", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByRole("button", { name: "Remove /rpc", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove proxy routing for prices",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Subdomain", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await native.clean();
});
