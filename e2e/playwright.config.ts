import { defineConfig, devices } from "@playwright/test";
import { assertE2ePrerequisites } from "./lib/psinode-bin";

assertE2ePrerequisites();

export default defineConfig({
    // Shared root config + fixtures; per-package specs under specs/<package>/.
    testDir: "./specs",
    testMatch: "**/*.spec.ts",
    outputDir: "./test-results/artifacts",
    // One worker per project so each browser boots one chain; with workers: 2
    // the chromium and webkit jobs run side by side.
    fullyParallel: false,
    workers: 2,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    forbidOnly: true,
    retries: 0,
    reporter: [
        ["list"],
        ["html", { outputFolder: "./test-results/html-report", open: "never" }],
    ],
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
