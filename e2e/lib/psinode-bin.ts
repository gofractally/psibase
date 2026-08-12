import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function resolveFromPath(command: string): string | undefined {
    try {
        return execFileSync("which", [command], { encoding: "utf8" }).trim();
    } catch {
        return undefined;
    }
}

export function resolveBin(envVar: string, command: string): string {
    const configured = process.env[envVar];
    if (configured !== undefined) {
        const abs = path.isAbsolute(configured)
            ? configured
            : path.resolve(repoRoot, configured);
        if (!existsSync(abs)) {
            throw new Error(`${envVar} does not exist: ${abs}`);
        }
        return abs;
    }

    const fromPath = resolveFromPath(command);
    if (fromPath !== undefined && existsSync(fromPath)) {
        return fromPath;
    }

    throw new Error(
        `${envVar} is unset and '${command}' was not found on PATH`,
    );
}

export function resolvePsinodeBin(): string {
    const psinodeBin = resolveBin("PSINODE_BIN", "psinode");
    const binDir = path.dirname(psinodeBin);
    const prefix =
        path.basename(binDir) === "bin" ? path.dirname(binDir) : binDir;
    const packagesDir = path.join(prefix, "share/psibase/packages");
    if (!existsSync(packagesDir)) {
        throw new Error(
            `PSINODE_BIN install tree missing share/psibase/packages: ${packagesDir}`,
        );
    }
    return psinodeBin;
}

export function assertE2ePrerequisites(): void {
    resolvePsinodeBin();
    resolveBin("PSIBASE_BIN", "psibase");
}
