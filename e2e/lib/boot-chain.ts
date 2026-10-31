import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveBin, resolvePackagesDir } from "./psinode-bin";
import { waitForChain } from "./node-ready";

const BOOT_API_URL = "http://psibase.localhost/";
const BOOT_TIMEOUT_MS = 120_000;

export type BootChainOptions = {
    socketPath: string;
    producer: string;
    packages?: string[];
};

async function writeAccountPublicKey(dir: string): Promise<string> {
    const { publicKey } = generateKeyPairSync("ec", {
        namedCurve: "P-256",
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyPath = path.join(dir, "account.pub");
    await writeFile(publicKeyPath, publicKey, "utf8");
    return publicKeyPath;
}

/**
 * Boots with an account key so the producer uses auth-sig, matching a
 * production UI boot of ProdDefault (or `packages`).
 */
export async function bootChain(options: BootChainOptions): Promise<void> {
    const psibaseBin = resolveBin("PSIBASE_BIN", "psibase");
    const packages = options.packages ?? ["ProdDefault"];
    const accountKeyPath = await writeAccountPublicKey(
        path.dirname(options.socketPath),
    );

    await new Promise<void>((resolve, reject) => {
        const args = [
            "boot",
            "-p",
            options.producer,
            "--account-key",
            accountKeyPath,
            ...packages,
            ...(process.env.PSIBASE_PACKAGES
                ? ["--package-source", resolvePackagesDir()]
                : []),
            "-a",
            BOOT_API_URL,
            "--proxy",
            `unix:${options.socketPath}`,
        ];
        const child = spawn(psibaseBin, args, {
            stdio: ["ignore", "ignore", "pipe"],
        });

        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(
                new Error(
                    `psibase boot failed (exit ${code}): ${stderr.trim()}`,
                ),
            );
        });
    });

    await waitForChain(options.socketPath, BOOT_TIMEOUT_MS);
}
