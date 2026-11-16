import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../../../..");

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

/**
 * Directory of .psi packages to boot from. PSIBASE_PACKAGES wins (e.g. a
 * build dir with locally built packages); otherwise the install tree next to
 * PSINODE_BIN (<prefix>/share/psibase/packages).
 */
export function resolvePackagesDir(): string {
    const configured = process.env.PSIBASE_PACKAGES;
    if (configured !== undefined && configured !== "") {
        const abs = path.isAbsolute(configured)
            ? configured
            : path.resolve(repoRoot, configured);
        if (!existsSync(abs)) {
            throw new Error(`PSIBASE_PACKAGES does not exist: ${abs}`);
        }
        return abs;
    }
    const psinodeBin = resolveBin("PSINODE_BIN", "psinode");
    const binDir = path.dirname(psinodeBin);
    const prefix =
        path.basename(binDir) === "bin" ? path.dirname(binDir) : binDir;
    const packagesDir = path.join(prefix, "share/psibase/packages");
    if (!existsSync(packagesDir)) {
        throw new Error(
            `PSINODE_BIN install tree missing share/psibase/packages: ${packagesDir} (set PSIBASE_PACKAGES to override)`,
        );
    }
    return packagesDir;
}

export function resolvePsinodeBin(): string {
    const psinodeBin = resolveBin("PSINODE_BIN", "psinode");
    resolvePackagesDir();
    return psinodeBin;
}

export function assertE2ePrerequisites(): void {
    resolvePsinodeBin();
    resolveBin("PSIBASE_BIN", "psibase");
}
