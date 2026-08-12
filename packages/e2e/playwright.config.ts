const { defineConfig, devices } = require("@playwright/test");
const { existsSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");

function resolveBin(envVar: string, defaultRel: string): string {
    const rel = process.env[envVar] ?? defaultRel;
    const abs = path.resolve(repoRoot, rel);
    if (!existsSync(abs)) {
        throw new Error(`${envVar} does not exist: ${abs}`);
    }
    return abs;
}

function assertPsibasePackages(psinodeBin: string): void {
    const binDir = path.dirname(psinodeBin);
    const prefix =
        path.basename(binDir) === "bin" ? path.dirname(binDir) : binDir;
    const packagesDir = path.join(prefix, "share/psibase/packages");
    if (!existsSync(packagesDir)) {
        throw new Error(
            `PSINODE_BIN install tree missing share/psibase/packages: ${packagesDir}`,
        );
    }
}

const psinodeBin = resolveBin("PSINODE_BIN", "build/psinode");
resolveBin("PSIBASE_BIN", "build/rust/release/psibase");
assertPsibasePackages(psinodeBin);

module.exports = defineConfig({
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
