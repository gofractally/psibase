// Standalone npm workspace: dependencies stay local to Favor's UI.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL(".", import.meta.url));
const lock = createHash("sha256")
    .update(readFileSync(new URL("package-lock.json", import.meta.url)))
    .digest("hex");
const marker = new URL("node_modules/.favor-lock", import.meta.url);
function run(args) {
    const result = spawnSync("npm", args, { cwd: directory, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(marker) || readFileSync(marker, "utf8") !== lock) {
    run(["ci", "--no-audit", "--no-fund"]);
    writeFileSync(marker, lock);
}
run(["run", "build"]);
