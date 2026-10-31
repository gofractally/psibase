import { defineConfig, devices } from "@playwright/test";
import { assertE2ePrerequisites } from "./lib/psinode-bin";

assertE2ePrerequisites();

export default defineConfig({
    testDir: "./tests",
    outputDir: "./test-results/artifacts",
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [["list"], ["html", { outputFolder: "./test-results/html-report" }]],
    use: {
        trace: "retain-on-failure",
        video: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
