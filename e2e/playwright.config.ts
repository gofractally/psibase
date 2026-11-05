import { defineConfig, devices } from "@playwright/test";
import { assertE2ePrerequisites } from "./lib/psinode-bin";

assertE2ePrerequisites();

export default defineConfig({
    // Package suites: packages/<...>/e2e (Yarn-portaled into this harness).
    // Harness-owned specs that predate colocation stay under e2e/specs/.
    testDir: "..",
    testMatch: ["packages/**/e2e/**/*.spec.ts", "e2e/specs/**/*.spec.ts"],
    // One worker per browser project; each worker boots one devnet and runs
    // its spec files serially on it, with the two browsers side by side.
    fullyParallel: false,
    workers: 2,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    outputDir: "./test-results/artifacts",
    forbidOnly: true,
    retries: 0,
    reporter: [["list"], ["html", { outputFolder: "./test-results/html-report", open: "never" }]],
    use: {
        trace: "retain-on-failure",
        video: "retain-on-failure",
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
