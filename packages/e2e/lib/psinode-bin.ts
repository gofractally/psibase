import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");

export function resolveBin(envVar: string, defaultRel: string): string {
    const rel = process.env[envVar] ?? defaultRel;
    const abs = path.resolve(repoRoot, rel);
    if (!existsSync(abs)) {
        throw new Error(`${envVar} does not exist: ${abs}`);
    }
    return abs;
}

export function resolvePsinodeBin(): string {
    const psinodeBin = resolveBin("PSINODE_BIN", "build/psinode");
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
    resolveBin("PSIBASE_BIN", "build/rust/release/psibase");
}
