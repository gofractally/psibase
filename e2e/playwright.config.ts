import { defineConfig, devices } from "@playwright/test";
import { assertE2ePrerequisites } from "./lib/psinode-bin";

assertE2ePrerequisites();

export default defineConfig({
    // Package suites live at packages/<...>/e2e and are portaled into this
    // harness for Yarn PnP. One config discovers all of them.
    testDir: "../packages",
    testMatch: "**/e2e/**/*.spec.ts",
    outputDir: "./test-results/artifacts",
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
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
        },
    ],
});
