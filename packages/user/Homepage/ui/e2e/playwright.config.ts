import { defineConfig, devices } from "@playwright/test";

const HOMEPAGE_URL =
    process.env.PSIBASE_E2E_BASE_URL ?? "http://network.psibase.localhost:8080/";

/**
 * Single-worker config: every spec talks to the same on-machine psibase chain,
 * so parallelism across files would race on db state, ports, and accounts.
 * `globalSetup` boots a fresh chain (or aborts if one is already running);
 * `globalTeardown` stops it.
 */
export default defineConfig({
    testDir: "./tests",
    timeout: 300_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
    globalSetup: "./global-setup.ts",
    globalTeardown: "./global-teardown.ts",
    use: {
        baseURL: HOMEPAGE_URL,
        trace: "retain-on-failure",
        video: "retain-on-failure",
        ignoreHTTPSErrors: true,
        permissions: ["microphone", "camera"],
        launchOptions: {
            args: [
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--disable-features=WebRtcHideLocalIpsWithMdns",
                // Map every psibase.localhost subdomain (and the bare root)
                // back to the boot fixture's loopback psinode so DNS lookups
                // inside Chromium resolve without /etc/hosts edits.
                "--host-resolver-rules=MAP *.psibase.localhost 127.0.0.1, MAP psibase.localhost 127.0.0.1",
            ],
        },
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
