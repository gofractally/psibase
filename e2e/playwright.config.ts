import { defineConfig, devices } from "@playwright/test";

// Local-development-only harness. Not wired into CI (see README.md).
//
// Each browser is its own Playwright project. Projects run in parallel
// (one worker each), and every worker boots its OWN devnet (psinode +
// delay/echo proxy) on its own ports, so nothing is shared between jobs.
export default defineConfig({
    // Shared root config + fixtures; per-package specs are globbed in from
    // specs/<package>/**/*.spec.ts.
    testDir: "./specs",
    testMatch: "**/*.spec.ts",
    // One worker per project (project-level `workers: 1`), so each browser
    // boots one chain and its spec files run serially on it; with the global
    // limit of 2 the two browser jobs run side by side.
    fullyParallel: false,
    workers: 2,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    forbidOnly: true,
    retries: 0,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            workers: 1,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "webkit",
            workers: 1,
            use: { ...devices["Desktop Safari"] },
        },
    ],
});
